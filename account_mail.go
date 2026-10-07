package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

type accountMail struct{ To, Subject, Body, Kind, Token string }

// The encrypted payload is erased on acceptance, expiry, exhaustion or supersession.
// SMTP acceptance is not inbox delivery; interrupted sends can be retried at least once.
func (s *server) enqueueAccountMail(to, subject, body, kind, token string) {
	ctx := context.Background()
	payload, err := json.Marshal(accountMail{to, subject, body, kind, token})
	if err != nil {
		return
	}
	encrypted, err := s.cryptSecret(string(payload), true)
	var queued sql.Result
	if err == nil {
		queued, err = s.db.ExecContext(ctx, `INSERT INTO account_mail_deliveries(purpose,created,expires,next_at,token_hash,payload) SELECT ?,?,expires,?,token_hash,? FROM auth_tokens WHERE token_hash=? AND expires>? AND (SELECT count(*) FROM account_mail_deliveries WHERE status IN ('queued','sending'))<1000`, kind, time.Now().Unix(), time.Now().Unix(), encrypted, hashToken(token), time.Now().Unix())
	}
	if err != nil {
		s.audit(ctx, "system", "account_email_failed", "", "Could not persist account email; check storage and credential key.", "")
		return
	}
	if n, e := queued.RowsAffected(); e != nil || n != 1 {
		s.audit(ctx, "system", "account_email_failed", "", "Account email was not queued: pending capacity reached or link superseded. Check delivery backlog and request a new link.", "")
		return
	}
	s.kickAccountMail()
}

func (s *server) kickAccountMail() {
	select {
	case s.mailSem <- struct{}{}:
	default:
		return
	}
	s.serviceJobs.Add(1)
	go func() {
		defer s.serviceJobs.Done()
		defer func() { <-s.mailSem }()
		parent := s.serviceCtx
		if parent == nil {
			parent = context.Background()
		}
		ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
		defer cancel()
		for ctx.Err() == nil {
			if !s.deliverAccountMail(ctx) {
				return
			}
		}
	}()
}

func (s *server) deliverAccountMail(ctx context.Context) bool {
	now := time.Now().Unix()
	_, err := s.db.ExecContext(ctx, `UPDATE account_mail_deliveries SET status='expired',payload='',token_hash='',error_category='Link expired or superseded' WHERE status='queued' AND (expires<=? OR NOT EXISTS(SELECT 1 FROM auth_tokens t WHERE t.token_hash=account_mail_deliveries.token_hash AND t.expires>?))`, now, now)
	if err != nil {
		return false
	}
	var id int64
	var encrypted string
	var attempt int
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false
	}
	err = tx.QueryRowContext(ctx, `SELECT id,payload,attempts FROM account_mail_deliveries WHERE status='queued' AND next_at<=? ORDER BY id LIMIT 1`, now).Scan(&id, &encrypted, &attempt)
	if err != nil {
		tx.Rollback()
		return false
	}
	_, err = tx.ExecContext(ctx, `UPDATE account_mail_deliveries SET status='sending',attempts=attempts+1 WHERE id=?`, id)
	if err != nil {
		tx.Rollback()
		return false
	}
	if tx.Commit() != nil {
		return false
	}
	attempt++
	var mail accountMail
	var purpose string
	plain, err := s.cryptSecret(encrypted, false)
	if err == nil {
		err = json.Unmarshal([]byte(plain), &mail)
	}
	if err == nil {
		var valid int
		err = s.db.QueryRowContext(ctx, `SELECT count(*),COALESCE(max(purpose),'') FROM auth_tokens WHERE token_hash=? AND expires>?`, hashToken(mail.Token), time.Now().Unix()).Scan(&valid, &purpose)
		if err == nil && valid == 0 {
			s.db.ExecContext(ctx, `UPDATE account_mail_deliveries SET status='expired',payload='',token_hash='' WHERE id=?`, id)
			return true
		}
	}
	if err == nil {
		var cfg serviceSettings
		cfg, err = s.loadServices(ctx, true)
		if err == nil && (!cfg.Email.Enabled || (purpose == "reset" && !cfg.Accounts.Recovery) || (purpose == "register" && !cfg.Accounts.Registration)) {
			s.db.ExecContext(ctx, `UPDATE account_mail_deliveries SET status='expired',payload='',token_hash='',error_category='Email delivery disabled' WHERE id=?`, id)
			return true
		}
		if err == nil {
			cfg.Email.To = []string{mail.To}
			label := "Verify email"
			if mail.Kind == "reset" {
				label = "Reset password"
			}
			sendCtx, closeSend := context.WithTimeout(ctx, 25*time.Second)
			err = s.sendBrandedNotification(sendCtx, cfg.Email, mail.Subject, mail.Body, strings.TrimRight(cfg.Accounts.PublicURL, "/")+"/login#"+mail.Kind+"="+mail.Token, label)
			closeSend()
		}
	}
	done, closeDone := context.WithTimeout(context.Background(), 10*time.Second)
	defer closeDone()
	if err == nil {
		s.db.ExecContext(done, `UPDATE account_mail_deliveries SET status='accepted',payload='',token_hash='',error_category='' WHERE id=?`, id)
		s.audit(done, "system", "account_mail_accepted", "", "Account email accepted by SMTP; inbox delivery is not confirmed.", "")
	} else {
		status := "queued"
		if attempt >= 4 {
			status = "failed"
		}
		s.db.ExecContext(done, `UPDATE account_mail_deliveries SET status=?,next_at=?,error_category='SMTP or credential configuration unavailable',payload=CASE WHEN ?='failed' THEN '' ELSE payload END,token_hash=CASE WHEN ?='failed' THEN '' ELSE token_hash END WHERE id=?`, status, time.Now().Add(time.Duration(1<<uint(attempt-1))*time.Minute).Unix(), status, status, id)
		s.audit(done, "system", "account_email_failed", "", "Account email attempt failed; bounded retry while link remains valid.", "")
	}
	return true
}

func (s *server) mailStatus(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT purpose,created,status,attempts,next_at,error_category FROM account_mail_deliveries ORDER BY id DESC LIMIT 25`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var purpose, status, category string
		var created, next int64
		var attempts int
		if err = rows.Scan(&purpose, &created, &status, &attempts, &next, &category); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"purpose": purpose, "created": created, "status": status, "attempts": attempts, "next_at": next, "error_category": category})
	}
	return out, rows.Err()
}
