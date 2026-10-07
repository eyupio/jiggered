package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The activity log is how an admin finds out what happened, so it must not be possible to fill it with noise.

func TestSessionRevokesThatChangeNothingAreNotRecorded(t *testing.T) {
	e := newTestServer(t)
	c, _ := e.addUser("alice", roleUser)
	before := countRows(t, e, "SELECT count(*) FROM audit_log")
	if st := c.do("DELETE", "/api/me/sessions/zzzzzzzzzzzzzzzz", nil); st != 204 {
		t.Fatalf("revoking a session that doesn't exist: %d", st)
	}
	if st := c.do("POST", "/api/me/sessions/revoke-others", nil); st != 200 { // alice has only the one session
		t.Fatalf("revoke-others: %d", st)
	}
	if got := countRows(t, e, "SELECT count(*) FROM audit_log"); got != before {
		t.Errorf("revoking nothing wrote %d row(s) to the activity log; anyone signed in could flood it", got-before)
	}

	other := e.newClient()
	other.mustLogin("alice", "password-alice")
	before = countRows(t, e, "SELECT count(*) FROM audit_log")
	if st := c.do("POST", "/api/me/sessions/revoke-others", nil); st != 200 {
		t.Fatal(st)
	}
	if got := countRows(t, e, "SELECT count(*) FROM audit_log"); got != before+1 {
		t.Errorf("signing another device out should be recorded once, wrote %d rows", got-before)
	}
}

func TestFloodingSelfServiceEventsCannotPushOutAdminOnes(t *testing.T) {
	e := newTestServer(t)
	ctx := t.Context()
	e.s.audit(ctx, "admin", "password_reset", "alice", "signed out everywhere", "")
	e.s.audit(ctx, "cli", "user_created", "bob", "user", "")
	e.s.audit(ctx, "admin", "sessions_revoked", "alice", "", "") // an admin's, though it shares a name with the self-service one
	if _, err := e.s.db.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ?)
		INSERT INTO audit_log(at, actor, action, target, detail, ip)
		SELECT CAST(strftime('%s', 'now') AS INTEGER), 'mallory', 'login', 'mallory', '', '' FROM n`, auditMaxRows+2000); err != nil {
		t.Fatal(err)
	}
	e.s.prune()
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action IN ('password_reset', 'user_created') OR (action = 'sessions_revoked' AND actor = 'admin')"); n != 3 {
		t.Errorf("%d of the 3 admin events survived a flood of sign-ins", n)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'login' AND actor = 'mallory'"); n > auditMaxRows {
		t.Errorf("%d sign-in rows kept, want at most %d", n, auditMaxRows)
	}
}

func TestAdminEventsAreCappedToo(t *testing.T) {
	e := newTestServer(t)
	if _, err := e.s.db.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ?)
		INSERT INTO audit_log(at, actor, action, target, detail, ip)
		SELECT CAST(strftime('%s', 'now') AS INTEGER), 'admin', 'settings_changed', '', '', '' FROM n`, auditMaxRows+500); err != nil {
		t.Fatal(err)
	}
	e.s.prune()
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'settings_changed'"); n != auditMaxRows {
		t.Errorf("%d admin events kept, want exactly %d", n, auditMaxRows)
	}
}

// failingWriter is a browser that goes away after the headers.
type failingWriter struct{ h http.Header }

func (f *failingWriter) Header() http.Header {
	if f.h == nil {
		f.h = http.Header{}
	}
	return f.h
}
func (f *failingWriter) WriteHeader(int)           {}
func (f *failingWriter) Write([]byte) (int, error) { return 0, errors.New("client went away") }

func TestBackupDownloadIsRecordedEvenIfItIsCutShort(t *testing.T) {
	e := newTestServer(t)
	admin, err := e.s.userByName(t.Context(), adminName)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/admin/backup", strings.NewReader(`{"password":"`+adminPass+`"}`))
	r = r.WithContext(context.WithValue(r.Context(), authKey{}, &authInfo{u: admin}))
	e.s.adminBackup(&failingWriter{}, r)
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'backup_downloaded'"); n != 1 {
		t.Errorf("a download that started and was cut short left %d audit rows, want 1: the data had begun to leave", n)
	}
}

func TestAuditLimitIsCappedAt500(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	if _, err := e.s.db.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 700)
		INSERT INTO audit_log(at, actor, action) SELECT 1, 'x', 'filler' FROM n`); err != nil {
		t.Fatal(err)
	}
	for limit, want := range map[string]int{"501": 500, "100000": 500, "500": 500, "5": 5, "0": 100, "-3": 100, "junk": 100} {
		var got []auditOut
		admin.getJSON("/api/admin/audit?limit="+limit, &got)
		if len(got) != want {
			t.Errorf("limit=%s returned %d rows, want %d", limit, len(got), want)
		}
	}
}
