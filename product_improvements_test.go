package main
import("context";"strings";"testing";"time")

func TestUsageConsentSuppressionAndDeletion(t *testing.T){
 e:=newTestServer(t);c:=e.newClient();c.login(adminName,adminPass)
 c.do("POST","/api/me/usage",map[string]string{"event":"capture_saved"})
 var n int;e.s.db.QueryRow(`SELECT count(*) FROM product_usage`).Scan(&n);if n!=0{t.Fatal("default measurement collected data")}
 if st:=c.do("PUT","/api/admin/usage",map[string]any{"enabled":true,"password":adminPass});st!=200{t.Fatal(st)}
 if st:=c.do("PUT","/api/me/usage-consent",map[string]bool{"enabled":true});st!=200{t.Fatal(st)}
 if st:=c.do("POST","/api/me/usage",map[string]string{"event":"capture_saved"});st!=204{t.Fatal(st)}
 if st:=c.do("POST","/api/me/usage",map[string]string{"event":"private_note"});st!=400{t.Fatal("unbounded event accepted",st)}
 if st:=c.do("POST","/api/me/usage",map[string]string{"event":"capture_saved","notes":"secret"});st!=400{t.Fatal("extra content accepted",st)}
 e.s.db.QueryRow(`SELECT count(*) FROM product_usage`).Scan(&n);if n!=1{t.Fatal("consented event missing",n)}
 body:=c.mustBody("GET","/api/admin/usage");if strings.Contains(body,"capture_saved"){t.Fatal("small cohort exposed",body)}
 if st:=c.do("PUT","/api/me/usage-consent",map[string]bool{"enabled":false});st!=200{t.Fatal(st)}
 e.s.db.QueryRow(`SELECT count(*) FROM product_usage`).Scan(&n);if n!=0{t.Fatal("disable did not erase",n)}
}
func TestCancelFactorSetupPreservesEnabledFactor(t *testing.T){
 e:=newTestServer(t);c:=e.newClient();c.login(adminName,adminPass)
 enableTestFactor(t,e,c)
 if st:=c.do("POST","/api/me/security/two-factor",map[string]string{"action":"cancel","password":adminPass});st!=200{t.Fatal(st)}
 var enabled int;var pending string;e.s.db.QueryRow(`SELECT enabled,pending_secret FROM account_security WHERE user_id=1`).Scan(&enabled,&pending)
 if enabled!=1||pending!=""{t.Fatal("cancel changed protection or kept pending secret",enabled,pending)}
}
func TestAccountMailEncryptedAndSuperseded(t *testing.T){
 e:=newTestServer(t)
 // Hold all worker slots to inspect durable pending state without network delivery.
 for i:=0;i<cap(e.s.mailSem);i++{e.s.mailSem<-struct{}{}}
 token:="sensitive-reset-token";expires:=time.Now().Add(time.Minute).Unix()
 if _,err:=e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'reset',1,'old-password',?)`,hashToken(token),expires);err!=nil{t.Fatal(err)}
 e.s.enqueueAccountMail("private@example.com","Reset","Body","reset",token)
 var payload string;e.s.db.QueryRow(`SELECT payload FROM account_mail_deliveries`).Scan(&payload)
 if payload==""||strings.Contains(payload,token)||strings.Contains(payload,"private@example.com"){t.Fatal("email payload not encrypted")}
 e.s.db.Exec(`DELETE FROM auth_tokens WHERE token_hash=?`,hashToken(token))
 e.s.deliverAccountMail(context.Background())
 var status string;e.s.db.QueryRow(`SELECT status,payload FROM account_mail_deliveries`).Scan(&status,&payload)
 if status!="expired"||payload!=""{t.Fatal("superseded link not erased",status)}
 for i:=0;i<cap(e.s.mailSem);i++{<-e.s.mailSem}
}
func TestUsableBackupSurvivesLaterFailure(t *testing.T){
 e:=newTestServer(t);c:=e.newClient();c.login(adminName,adminPass)
 e.s.db.Exec(`INSERT INTO remote_backup_runs(id,started,finished,status,uploaded,verified,verification_required,retained) VALUES(1,100,101,'warning',1,1,1,0),(2,200,201,'failed',1,0,1,0)`)
 var result struct {Usable int64 `json:"last_usable"`;Verified int64 `json:"last_verified"`;Runs []backupRun `json:"runs"`}
 c.getJSON("/api/admin/services",&result)
 if result.Usable!=101||result.Verified!=101||len(result.Runs)!=2||result.Runs[0].Status!="failed"{t.Fatalf("backup history=%+v",result)}
}
