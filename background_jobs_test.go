package main

import (
	"context"
	"strconv"
	"testing"
	"time"
)

// A server that was stopped mid-send owes the tables a recovery: mail stuck 'sending' goes back to the queue
// (or fails with its payload erased once its retries are spent) and half-finished backup runs are marked so.
func TestRecoverInterruptedWorkResumesMailAndMarksBackups(t *testing.T) {
	e := newTestServer(t)
	now := time.Now().Unix()
	for _, row := range []struct {
		purpose, status string
		attempts        int
	}{
		{"verify", "sending", 2},
		{"reset", "sending", 4},
		{"verify", "queued", 1},
	} {
		if _, err := e.s.db.Exec(`INSERT INTO account_mail_deliveries(purpose,created,expires,next_at,attempts,status,token_hash,payload) VALUES(?,?,?,?,?,?, 'token', 'encrypted payload')`, row.purpose, now, now+3600, now, row.attempts, row.status); err != nil {
			t.Fatal(err)
		}
	}
	e.s.db.Exec(`INSERT INTO remote_backup_runs(started,status) VALUES(?, 'running')`, now)
	e.s.recoverInterruptedWork(context.Background())
	var status, payload, token, message string
	var finished int
	e.s.db.QueryRow(`SELECT status,payload,token_hash FROM account_mail_deliveries WHERE attempts=2`).Scan(&status, &payload, &token)
	if status != "queued" || payload != "encrypted payload" || token != "token" {
		t.Fatalf("an interrupted send did not go back to the queue intact: %q %q %q", status, payload, token)
	}
	e.s.db.QueryRow(`SELECT status,payload,token_hash FROM account_mail_deliveries WHERE attempts=4`).Scan(&status, &payload, &token)
	if status != "failed" || payload != "" || token != "" {
		t.Fatalf("a spent send was not failed with its payload erased: %q %q %q", status, payload, token)
	}
	e.s.db.QueryRow(`SELECT status,payload FROM account_mail_deliveries WHERE attempts=1`).Scan(&status, &payload)
	if status != "queued" || payload != "encrypted payload" {
		t.Fatalf("queued mail was disturbed: %q %q", status, payload)
	}
	e.s.db.QueryRow(`SELECT status,message,finished FROM remote_backup_runs`).Scan(&status, &message, &finished)
	if status != "interrupted" || message == "" || finished == 0 {
		t.Fatalf("a running backup was not marked interrupted: %q %q %d", status, message, finished)
	}
}

func TestPruneExpiresAuthenticationState(t *testing.T) {
	e := newTestServer(t)
	now := time.Now()
	past, future := now.Add(-time.Hour).Unix(), now.Add(time.Hour).Unix()
	for _, q := range []string{
		`INSERT INTO sessions(token_hash,sid,user_id,created_at,last_seen_at,expires_at) VALUES('gone-session','sid-gone',1,0,0,` + stamp(past) + `)`,
		`INSERT INTO sessions(token_hash,sid,user_id,created_at,last_seen_at,expires_at) VALUES('kept-session','sid-kept',1,0,0,` + stamp(future) + `)`,
		`INSERT INTO auth_tokens(token_hash,purpose,payload,expires) VALUES('gone-token','reset','',` + stamp(past) + `)`,
		`INSERT INTO auth_tokens(token_hash,purpose,payload,expires) VALUES('kept-token','reset','',` + stamp(future) + `)`,
		`INSERT INTO login_challenges(token_hash,user_id,password_hash,secret,ua,ip,expires) VALUES('gone-challenge',1,'h','s','','',` + stamp(past) + `)`,
		`INSERT INTO login_challenges(token_hash,user_id,password_hash,secret,ua,ip,expires) VALUES('kept-challenge',1,'h','s','','',` + stamp(future) + `)`,
		`INSERT INTO account_security(user_id,pending_secret,pending_until) VALUES(1,'sealed',` + stamp(past) + `)`,
	} {
		if _, err := e.s.db.Exec(q); err != nil {
			t.Fatal(err, q)
		}
	}
	e.s.prune()
	for _, q := range []string{
		`SELECT count(*) FROM sessions WHERE token_hash='gone-session'`,
		`SELECT count(*) FROM auth_tokens WHERE token_hash='gone-token'`,
		`SELECT count(*) FROM login_challenges WHERE token_hash='gone-challenge'`,
	} {
		if n := countRows(t, e, q); n != 0 {
			t.Errorf("expired state survived: %s = %d", q, n)
		}
	}
	for _, q := range []string{
		`SELECT count(*) FROM sessions WHERE token_hash='kept-session'`,
		`SELECT count(*) FROM auth_tokens WHERE token_hash='kept-token'`,
		`SELECT count(*) FROM login_challenges WHERE token_hash='kept-challenge'`,
	} {
		if n := countRows(t, e, q); n != 1 {
			t.Errorf("live state was pruned: %s = %d", q, n)
		}
	}
	var pending string
	var until int
	e.s.db.QueryRow(`SELECT pending_secret,pending_until FROM account_security WHERE user_id=1`).Scan(&pending, &until)
	if pending != "" || until != 0 {
		t.Fatalf("an expired authenticator setup survived: %q %d", pending, until)
	}
}

// stamp keeps the seeded timestamps in the statements above readable.
func stamp(t int64) string { return strconv.FormatInt(t, 10) }

// The scheduler loop must tidy old rows on its first pass and stop as soon as its context goes away.
func TestServiceSchedulerCleansUpAndStopsOnCancel(t *testing.T) {
	e := newTestServer(t)
	now := time.Now()
	for _, age := range []int{-8, -1} {
		if _, err := e.s.db.Exec(`INSERT INTO account_mail_deliveries(purpose,created,expires,next_at,status,token_hash,payload) VALUES('verify',?,?,?,'accepted','t','p')`,
			now.AddDate(0, 0, age).Unix(), now.Unix(), now.Unix()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.s.db.Exec(`INSERT INTO product_usage(cohort,week,event,count,days) VALUES('c',?,'capture_saved',1,1)`, now.AddDate(0, 0, -91).Format("2006-01-02")); err != nil {
		t.Fatal(err)
	}
	e.s.db.Exec(`INSERT INTO product_usage(cohort,week,event,count,days) VALUES('c',?,'capture_saved',1,1)`, usageWeek(now))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { e.s.serviceScheduler(ctx); close(done) }()
	// Wait for the first pass to tidy the old rows, then take the loop down with the context.
	for i := 0; i < 500; i++ {
		if countRows(t, e, `SELECT count(*) FROM product_usage WHERE week<?`, usageWeek(now)) == 0 &&
			countRows(t, e, `SELECT count(*) FROM account_mail_deliveries WHERE created<?`, now.AddDate(0, 0, -7).Unix()) == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the scheduler did not stop when its context was cancelled")
	}
	e.s.serviceJobs.Wait()
	if n := countRows(t, e, `SELECT count(*) FROM account_mail_deliveries`); n != 1 {
		t.Errorf("recent finished mail was swept: %d", n)
	}
	if n := countRows(t, e, `SELECT count(*) FROM product_usage`); n != 1 {
		t.Errorf("the current usage week was swept: %d", n)
	}
}
