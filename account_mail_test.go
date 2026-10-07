package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestAccountMailEncryptedAndSuperseded(t *testing.T) {
	e := newTestServer(t)
	// Hold all worker slots to inspect durable pending state without network delivery.
	for i := 0; i < cap(e.s.mailSem); i++ {
		e.s.mailSem <- struct{}{}
	}
	token := "sensitive-reset-token"
	expires := time.Now().Add(time.Minute).Unix()
	if _, err := e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'reset',1,'old-password',?)`, hashToken(token), expires); err != nil {
		t.Fatal(err)
	}
	e.s.enqueueAccountMail("private@example.com", "Reset", "Body", "reset", token)
	var payload string
	e.s.db.QueryRow(`SELECT payload FROM account_mail_deliveries`).Scan(&payload)
	if payload == "" || strings.Contains(payload, token) || strings.Contains(payload, "private@example.com") {
		t.Fatal("email payload not encrypted")
	}
	e.s.db.Exec(`DELETE FROM auth_tokens WHERE token_hash=?`, hashToken(token))
	e.s.deliverAccountMail(context.Background())
	var status string
	e.s.db.QueryRow(`SELECT status,payload FROM account_mail_deliveries`).Scan(&status, &payload)
	if status != "expired" || payload != "" {
		t.Fatal("superseded link not erased", status)
	}
	for i := 0; i < cap(e.s.mailSem); i++ {
		<-e.s.mailSem
	}
}

func TestAccountMailRetriesAreBoundedAndErasePayload(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	cfg := testServices(t, e)
	cfg.Email = emailSettings{Enabled: true, Host: "127.0.0.1", Port: 1, TLS: "none", From: "jiggered@example.com", To: []string{"operator@example.com"}}
	cfg.Accounts = accountSettings{Recovery: true, PublicURL: "https://jiggered.example.com"}
	saveTestServices(t, e, c, cfg)
	token := "retry-token"
	if _, err := e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'reset',1,'hash',?)`, hashToken(token), time.Now().Add(30*time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	e.s.enqueueAccountMail("private@example.com", "Reset", "Body", "reset", token)
	e.s.serviceJobs.Wait()
	var status, payload string
	var attempts int
	var next int64
	e.s.db.QueryRow(`SELECT status,payload,attempts,next_at FROM account_mail_deliveries`).Scan(&status, &payload, &attempts, &next)
	if status != "queued" || payload == "" || attempts != 1 || next <= time.Now().Unix() {
		t.Fatal("first failure did not back off", status, attempts, next)
	}
	e.s.db.Exec(`UPDATE account_mail_deliveries SET attempts=3,next_at=0`)
	e.s.kickAccountMail()
	e.s.serviceJobs.Wait()
	e.s.db.QueryRow(`SELECT status,payload,attempts FROM account_mail_deliveries`).Scan(&status, &payload, &attempts)
	if status != "failed" || payload != "" || attempts != 4 {
		t.Fatal("exhausted retries retained payload or kept retrying", status, attempts)
	}
}
