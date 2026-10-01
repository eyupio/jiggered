package main

import (
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// These tests reproduce defects found in the October 2026 audit. Each one names the change that fixes it and is
// skipped until then, so the suite stays green while the failing behaviour is on record. Run them as they are with
// JIGGERED_AUDIT=1 go test -run Audit ./... and expect failures; the fixing change deletes its pending() call.
func pending(t *testing.T, fix string) {
	t.Helper()
	if os.Getenv("JIGGERED_AUDIT") == "" {
		t.Skip("known defect, fixed by " + fix)
	}
}

func TestAuditStaleDeleteKeepsNewerDoc(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	id := "d-2026-10-01"
	c.putDoc(id, `{"status":"amber"}`)
	c.putDoc(id, `{"status":"green"}`) // rev 2, which the stale client has not seen
	if st := c.do("DELETE", "/api/docs/"+id, nil, "If-Match", `"1"`); st != 409 {
		t.Errorf("delete at a stale rev = %d, want 409", st)
	}
	if got := c.docs()[id]; got.Rev != 2 {
		t.Errorf("the newer doc was lost: %+v", got)
	}
}

func TestAuditRevisionsSurviveDeleteAndRecreate(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	id := "d-2026-10-01"
	c.putDoc(id, `{"status":"amber"}`) // rev 1: what a second device still holds
	c.do("DELETE", "/api/docs/"+id, nil)
	if _, out := c.putDoc(id, `{"status":"red"}`); out["rev"] == float64(1) {
		t.Fatalf("recreated doc reused rev 1: %v", out)
	}
	if st, _ := c.putDoc(id, `{"status":"stale"}`, "If-Match", `"1"`); st != 409 {
		t.Errorf("a write holding the pre-delete rev = %d, want 409", st)
	}
	if got := c.docs()[id]; string(got.Body) != `{"status":"red"}` {
		t.Errorf("the recreated doc was overwritten: %s", got.Body)
	}
}

func TestAuditRestoreEndsRevokedSessions(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	backup := filepath.Join(t.TempDir(), "backup.db")
	if err := snapshot(e.s.db, backup); err != nil { // the cookie is valid in this copy
		t.Fatal(err)
	}
	u, _ := url.Parse(c.base)
	saved := c.hc.Jar.Cookies(u) // logout expires the cookie in the jar; keep it to replay the revoked token
	if st := c.do("POST", "/logout", nil); st >= 400 {
		t.Fatalf("logout = %d", st)
	}
	c.hc.Jar.SetCookies(u, saved)
	if st := c.do("GET", "/api/me", nil); st != 401 {
		t.Fatalf("revoked cookie = %d, want 401", st)
	}
	e.ts.Close()
	e.s.db.Close()
	t.Setenv("APP_DB", e.dbPath)
	if _, _, _, err := cli(t, "", "restore", backup, "--yes"); err != nil {
		t.Fatal(err)
	}
	db, err := openDB(e.dbPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	s, err := newServer(config{addr: "127.0.0.1:0", dbPath: e.dbPath, seeds: map[string]string{"secure_cookie": "false"}}, db)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	t.Cleanup(ts.Close)
	c.base = ts.URL
	if st := c.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("a session revoked before the restore works again afterwards: %d", st)
	}
}

func TestAuditRestoreRefusesDocsOnlyDatabase(t *testing.T) {
	e := newTestServer(t)
	e.signedInAdmin().putDoc("d-2026-10-01", `{"a":1}`)
	bad := filepath.Join(t.TempDir(), "docs-only.db")
	db, err := openRaw(bad)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE docs(user_id INTEGER, id TEXT, body TEXT, rev INTEGER, size INTEGER, updated_at INTEGER)"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	e.ts.Close()
	e.s.db.Close()
	t.Setenv("APP_DB", e.dbPath)
	if _, _, _, err := cli(t, "", "restore", bad, "--yes"); err == nil {
		t.Fatal("restore accepted a database with no users table")
	}
	if n := scalar(t, e.dbPath, "SELECT count(*) FROM users"); n != 1 {
		t.Errorf("the refused restore changed the live database (%d users)", n)
	}
}

func TestAuditRejectedSettingsPatchChangesNothing(t *testing.T) {
	pending(t, "atomic settings patch")
	e := newTestServer(t)
	c := e.signedInAdmin()
	before := e.s.settings().strings()
	if st := c.do("PATCH", "/api/admin/settings", map[string]any{"trust_proxy": true, "proxy_hops": 99}); st != 400 {
		t.Fatalf("patch with an invalid field = %d, want 400", st)
	}
	if after := e.s.settings().strings(); after["trust_proxy"] != before["trust_proxy"] {
		t.Errorf("a refused patch still changed trust_proxy: %q -> %q", before["trust_proxy"], after["trust_proxy"])
	}
}
