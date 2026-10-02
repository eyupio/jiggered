package main

import (
 "context"
 "database/sql"
 "encoding/json"
 "net/http"
 "strings"
 "time"
)

func migrateProductImprovements(tx *sql.Tx, first *seedAdmin) error {
 _, err := tx.Exec(`
 ALTER TABLE remote_backup_runs ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE remote_backup_runs ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE remote_backup_runs ADD COLUMN verification_required INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE remote_backup_runs ADD COLUMN retained INTEGER NOT NULL DEFAULT 0;
 UPDATE remote_backup_runs SET uploaded=1,retained=1 WHERE status='success';
 UPDATE remote_backup_runs SET verified=1,verification_required=1 WHERE status='success' AND message='Backup uploaded and SHA-256 verified.';
 CREATE TABLE account_mail_deliveries(id INTEGER PRIMARY KEY AUTOINCREMENT,purpose TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'queued',token_hash TEXT NOT NULL,payload TEXT NOT NULL,error_category TEXT NOT NULL DEFAULT '');
 CREATE INDEX account_mail_due ON account_mail_deliveries(status,next_at);
 CREATE TABLE usage_consent(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,seed TEXT NOT NULL);
 CREATE TABLE product_usage(cohort TEXT NOT NULL,week TEXT NOT NULL,event TEXT NOT NULL,count INTEGER NOT NULL,days INTEGER NOT NULL,PRIMARY KEY(cohort,week,event));
 `)
 return err
}

type accountMail struct { To, Subject, Body, Kind, Token string }

// The encrypted payload is erased on acceptance, expiry, exhaustion or supersession.
// SMTP acceptance is not inbox delivery; interrupted sends can be retried at least once.
func (s *server) enqueueAccountMail(to, subject, body, kind, token string) {
 ctx := context.Background()
 payload, err := json.Marshal(accountMail{to,subject,body,kind,token})
 if err != nil { return }
 encrypted, err := s.cryptSecret(string(payload),true)
 if err == nil {
  _, err = s.db.ExecContext(ctx, `INSERT INTO account_mail_deliveries(purpose,created,expires,next_at,token_hash,payload) SELECT ?,?,?,?,token_hash,? FROM auth_tokens WHERE token_hash=? AND expires>? AND (SELECT count(*) FROM account_mail_deliveries WHERE status IN ('queued','sending'))<1000`, kind,time.Now().Unix(),time.Now().Add(30*time.Minute).Unix(),time.Now().Unix(),encrypted,hashToken(token),time.Now().Unix())
 }
 if err != nil { s.audit(ctx,"system","account_email_failed","","Could not persist account email; check storage and credential key.",""); return }
 s.kickAccountMail()
}
func (s *server) kickAccountMail() {
 select { case s.mailSem <- struct{}{}: default: return }
 s.serviceJobs.Add(1)
 go func() {
  defer s.serviceJobs.Done(); defer func(){ <-s.mailSem }()
  parent := s.serviceCtx; if parent==nil { parent=context.Background() }
  ctx,cancel := context.WithTimeout(parent,2*time.Minute); defer cancel()
  for ctx.Err()==nil { if !s.deliverAccountMail(ctx) { return } }
 }()
}
func (s *server) deliverAccountMail(ctx context.Context) bool {
 now := time.Now().Unix()
 _, err := s.db.ExecContext(ctx,`UPDATE account_mail_deliveries SET status='expired',payload='',token_hash='',error_category='Link expired or superseded' WHERE status='queued' AND (expires<=? OR NOT EXISTS(SELECT 1 FROM auth_tokens t WHERE t.token_hash=account_mail_deliveries.token_hash AND t.expires>?))`,now,now)
 if err!=nil { return false }
 var id int64; var encrypted string; var attempt int
 tx,err := s.db.BeginTx(ctx,nil); if err!=nil {return false}
 err=tx.QueryRowContext(ctx,`SELECT id,payload,attempts FROM account_mail_deliveries WHERE status='queued' AND next_at<=? ORDER BY id LIMIT 1`,now).Scan(&id,&encrypted,&attempt)
 if err!=nil {tx.Rollback();return false}
 _,err=tx.ExecContext(ctx,`UPDATE account_mail_deliveries SET status='sending',attempts=attempts+1 WHERE id=?`,id)
 if err!=nil {tx.Rollback();return false}; if tx.Commit()!=nil {return false}
 attempt++
 var mail accountMail
 plain,err := s.cryptSecret(encrypted,false)
 if err==nil {err=json.Unmarshal([]byte(plain),&mail)}
 if err==nil {
  var valid int
  err=s.db.QueryRowContext(ctx,`SELECT count(*) FROM auth_tokens WHERE token_hash=? AND expires>?`,hashToken(mail.Token),time.Now().Unix()).Scan(&valid)
  if err==nil && valid==0 {s.db.ExecContext(ctx,`UPDATE account_mail_deliveries SET status='expired',payload='',token_hash='' WHERE id=?`,id);return true}
 }
 if err==nil {
  var cfg serviceSettings
  cfg,err=s.loadServices(ctx,true)
  if err==nil && !cfg.Email.Enabled {s.db.ExecContext(ctx,`UPDATE account_mail_deliveries SET status='expired',payload='',token_hash='',error_category='Email delivery disabled' WHERE id=?`,id);return true}
  if err==nil {
   cfg.Email.To=[]string{mail.To}; label:="Verify email"; if mail.Kind=="reset" {label="Reset password"}
   sendCtx,closeSend:=context.WithTimeout(ctx,25*time.Second)
   err=s.sendBrandedNotification(sendCtx,cfg.Email,mail.Subject,mail.Body,strings.TrimRight(cfg.Accounts.PublicURL,"/")+"/login#"+mail.Kind+"="+mail.Token,label)
   closeSend()
  }
 }
 done,closeDone:=context.WithTimeout(context.Background(),10*time.Second);defer closeDone()
 if err==nil {
  s.db.ExecContext(done,`UPDATE account_mail_deliveries SET status='accepted',payload='',token_hash='',error_category='' WHERE id=?`,id)
  s.audit(done,"system","account_mail_accepted","","Account email accepted by SMTP; inbox delivery is not confirmed.","")
 } else {
  status:="queued"; if attempt>=4 {status="failed"}
  s.db.ExecContext(done,`UPDATE account_mail_deliveries SET status=?,next_at=?,error_category='SMTP or credential configuration unavailable',payload=CASE WHEN ?='failed' THEN '' ELSE payload END,token_hash=CASE WHEN ?='failed' THEN '' ELSE token_hash END WHERE id=?`,status,time.Now().Add(time.Duration(1<<uint(attempt-1))*time.Minute).Unix(),status,status,id)
  s.audit(done,"system","account_email_failed","","Account email attempt failed; bounded retry while link remains valid.","")
 }
 return true
}
func (s *server) mailStatus(ctx context.Context) ([]map[string]any,error) {
 rows,err:=s.db.QueryContext(ctx,`SELECT purpose,created,status,attempts,next_at,error_category FROM account_mail_deliveries ORDER BY id DESC LIMIT 25`);if err!=nil{return nil,err};defer rows.Close()
 out:=[]map[string]any{}
 for rows.Next(){ var purpose,status,category string;var created,next int64;var attempts int
  if err=rows.Scan(&purpose,&created,&status,&attempts,&next,&category);err!=nil{return nil,err}
  out=append(out,map[string]any{"purpose":purpose,"created":created,"status":status,"attempts":attempts,"next_at":next,"error_category":category})
 }
 return out,rows.Err()
}

// Consent holds a random seed; event rows contain only rotating weekly pseudonyms.
// Admins receive cohort aggregates, never person-level event rows. No health data is accepted.
func usageWeek(now time.Time) string {now=now.UTC();day:=(int(now.Weekday())+6)%7;return now.AddDate(0,0,-day).Format("2006-01-02")}
func eraseUsage(ctx context.Context,tx *sql.Tx,userID int64) error {
 var seed string
 err:=tx.QueryRowContext(ctx,`SELECT seed FROM usage_consent WHERE user_id=?`,userID).Scan(&seed)
 if err==sql.ErrNoRows{return nil};if err!=nil{return err}
 for i:=0;i<15;i++ {week:=usageWeek(time.Now().AddDate(0,0,-7*i));if _,err=tx.ExecContext(ctx,`DELETE FROM product_usage WHERE cohort=?`,hashToken(seed+week));err!=nil{return err}}
 _,err=tx.ExecContext(ctx,`DELETE FROM usage_consent WHERE user_id=?`,userID);return err
}
func (s *server) usageEnabled(ctx context.Context) (bool,error) {
 var value string;err:=s.db.QueryRowContext(ctx,`SELECT value FROM instance_settings WHERE key='product_usage_enabled'`).Scan(&value)
 if err==sql.ErrNoRows{return false,nil};return value=="true",err
}
func (s *server) usageConsent(w http.ResponseWriter,r *http.Request) {
 enabled,err:=s.usageEnabled(r.Context());if err!=nil{serverError(w,r,err);return}
 uid:=authOf(r).u.ID
 if r.Method=="PUT" {
  var in struct {Enabled bool `json:"enabled"`};if !readJSON(w,r,&in){return}
  if in.Enabled && !enabled {jsonError(w,409,"Usage measurement is disabled for this instance.");return}
  err=s.withUserTx(r.Context(),uid,func(tx *sql.Tx,u *user) error {
   if !in.Enabled {return eraseUsage(r.Context(),tx,uid)}
   seed,e:=randomHex(32);if e!=nil{return e}
   _,e=tx.ExecContext(r.Context(),`INSERT OR IGNORE INTO usage_consent(user_id,seed) VALUES(?,?)`,uid,seed);return e
  });if err!=nil{serverError(w,r,err);return}
 }
 var n int;err=s.db.QueryRowContext(r.Context(),`SELECT count(*) FROM usage_consent WHERE user_id=?`,uid).Scan(&n);if err!=nil{serverError(w,r,err);return}
 writeJSON(w,200,map[string]any{"available":enabled,"enabled":n>0})
}
func (s *server) recordUsage(w http.ResponseWriter,r *http.Request) {
 var in struct {Event string `json:"event"`};if !readJSON(w,r,&in){return}
 switch in.Event {case "capture_saved","history_viewed","export_created","settings_saved","save_failed":default:jsonError(w,400,"Unknown task event.");return}
 enabled,err:=s.usageEnabled(r.Context());if err!=nil{serverError(w,r,err);return};if !enabled{w.WriteHeader(204);return}
 var seed string
 err=s.db.QueryRowContext(r.Context(),`SELECT seed FROM usage_consent WHERE user_id=?`,authOf(r).u.ID).Scan(&seed)
 if err==sql.ErrNoRows {w.WriteHeader(204);return};if err!=nil{serverError(w,r,err);return}
 now:=time.Now().UTC();week:=usageWeek(now)
 // Gate consent and instance setting in the same write: disabling cannot race a queued event.
 _,err=s.db.ExecContext(r.Context(),`INSERT INTO product_usage(cohort,week,event,count,days) SELECT ?,?,?,1,? FROM usage_consent WHERE user_id=? AND seed=? AND EXISTS(SELECT 1 FROM instance_settings WHERE key='product_usage_enabled' AND value='true') ON CONFLICT(cohort,week,event) DO UPDATE SET count=MIN(count+1,100),days=days|excluded.days`,hashToken(seed+week),week,in.Event,1<<uint(now.Weekday()),authOf(r).u.ID,seed)
 if err!=nil{serverError(w,r,err);return};w.WriteHeader(204)
}
func (s *server) adminUsage(w http.ResponseWriter,r *http.Request) {
 if r.Method!="GET" {
  var in struct {Enabled bool `json:"enabled"`;Password string `json:"password"`;Clear bool `json:"clear"`}
  if !readJSON(w,r,&in)||!s.verifyOwnPassword(w,r,authOf(r).u,in.Password){return}
  err:=s.withUserTx(r.Context(),authOf(r).u.ID,func(tx *sql.Tx,u *user) error {
   value:="false";if in.Enabled{value="true"}
   if _,e:=tx.ExecContext(r.Context(),`INSERT INTO instance_settings(key,value,updated_at) VALUES('product_usage_enabled',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,value,time.Now().Unix());e!=nil{return e}
   if in.Clear {_,e:=tx.ExecContext(r.Context(),`DELETE FROM product_usage`);return e};return nil
  });if err!=nil{serverError(w,r,err);return}
  s.audit(r.Context(),authOf(r).u.Username,"usage_settings_changed","","Optional local usage measurement settings changed.",s.clientIP(r))
 }
 enabled,err:=s.usageEnabled(r.Context());if err!=nil{serverError(w,r,err);return}
 rows,err:=s.db.QueryContext(r.Context(),`SELECT week,event,count(DISTINCT cohort),sum(count) FROM product_usage WHERE week>=? GROUP BY week,event HAVING count(DISTINCT cohort)>=5 ORDER BY week DESC,event`,time.Now().AddDate(0,0,-84).Format("2006-01-02"));if err!=nil{serverError(w,r,err);return};defer rows.Close()
 out:=[]map[string]any{};for rows.Next(){var week,event string;var people,total int;if err=rows.Scan(&week,&event,&people,&total);err!=nil{serverError(w,r,err);return};out=append(out,map[string]any{"week":week,"event":event,"participants":people,"tasks":total})}
 if err=rows.Err();err!=nil{serverError(w,r,err);return}
 writeJSON(w,200,map[string]any{"enabled":enabled,"rows":out})
}
