package main

import (
	"encoding/json"
	"strings"
	"testing"
)

const marker = "S3CR3T-MARKER-b7c1"

func TestUsersCannotSeeEachOthersLogs(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	bob, _ := e.addUser("bob", roleUser)

	alice.putDoc("d-2026-10-01", `{"status":"red","note":"`+marker+`"}`)
	alice.putDoc("e-1790000000000", `{"notes":"`+marker+`"}`)
	alice.putDoc("settings", `{"budget":12}`)

	if got := bob.docs(); len(got) != 0 {
		t.Fatalf("bob sees alice's docs: %v", got)
	}
	if _, b := bob.req("GET", "/api/export", nil); strings.Contains(string(b), marker) || strings.TrimSpace(string(b)) != "{}" {
		t.Errorf("bob's export = %s", b)
	}

	// The same id is a different doc for each person, with its own revision.
	if st, out := bob.putDoc("d-2026-10-01", `{"status":"green"}`, "If-None-Match", "*"); st != 200 || out["rev"] != float64(1) {
		t.Fatalf("bob creating the same day = %d %v (alice's doc must not make this a conflict)", st, out)
	}
	if got := alice.docs()["d-2026-10-01"]; got.Rev != 1 || !strings.Contains(string(got.Body), marker) {
		t.Errorf("bob's write changed alice's doc: %+v", got)
	}

	// Bob deleting and importing under alice's ids only touches bob's.
	if st := bob.do("DELETE", "/api/docs/e-1790000000000", nil); st != 204 {
		t.Errorf("delete = %d", st)
	}
	postImport(bob, "overwrite", `{"e-1790000000000":{"notes":"bob's"},"settings":{"budget":3}}`)
	a := alice.docs()
	if len(a) != 3 || !strings.Contains(string(a["e-1790000000000"].Body), marker) || string(a["settings"].Body) != `{"budget":12}` {
		t.Errorf("alice's docs after bob deleted/imported = %v", a)
	}
	if got := countRows(t, e, "SELECT count(*) FROM docs WHERE user_id = (SELECT id FROM users WHERE username = 'bob')"); got != 3 {
		t.Errorf("bob has %d docs, want 3", got)
	}
}

func TestAdminCannotReadAnyonesLogs(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	alice, _ := e.addUser("alice", roleUser)
	alice.putDoc("d-2026-10-01", `{"status":"red","note":"`+marker+`"}`)
	alice.putDoc("e-1790000000000", `{"notes":"`+marker+`"}`)
	postImport(alice, "", `{"d-2026-10-02":{"note":"`+marker+`"}}`)
	admin.putDoc("d-2026-10-01", `{"status":"green"}`)

	var users struct {
		Users []struct {
			Username string `json:"username"`
			Docs     int    `json:"docs"`
			Bytes    int    `json:"bytes"`
		} `json:"users"`
	}
	admin.getJSON("/api/admin/users", &users)
	found := false
	for _, u := range users.Users {
		if u.Username == "alice" {
			found = true
			if u.Docs != 3 || u.Bytes == 0 {
				t.Errorf("admin should see counts and sizes: %+v", u)
			}
		}
	}
	if !found {
		t.Fatal("alice missing from the user list")
	}

	for _, p := range []string{"/api/admin/users", "/api/admin/audit?limit=500", "/api/docs", "/api/export", "/api/me", "/api/me/sessions"} {
		resp, b := admin.req("GET", p, nil)
		if resp.StatusCode != 200 {
			t.Errorf("GET %s = %d", p, resp.StatusCode)
		}
		if strings.Contains(string(b), marker) {
			t.Errorf("GET %s leaked the contents of alice's logs: %s", p, b)
		}
	}
	// The admin's own docs endpoint holds only the admin's docs.
	if got := admin.docs(); len(got) != 1 {
		t.Errorf("admin /api/docs = %v, want only the admin's own", got)
	}
	// No admin route takes a user id and returns docs.
	for _, p := range []string{"/api/admin/users/2/docs", "/api/admin/docs", "/api/admin/export", "/api/docs?user=2", "/api/docs/d-2026-10-01?user=2"} {
		resp, b := admin.req("GET", p, nil)
		if strings.Contains(string(b), marker) {
			t.Errorf("GET %s leaked: %s", p, b)
		}
		_ = resp
	}
}

func TestSessionsAreScopedToTheirOwner(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	bob, _ := e.addUser("bob", roleUser)
	var aliceSessions []sessionOut
	alice.getJSON("/api/me/sessions", &aliceSessions)
	if len(aliceSessions) != 1 || !aliceSessions[0].Current {
		t.Fatalf("alice's sessions = %+v", aliceSessions)
	}
	var bobSessions []sessionOut
	bob.getJSON("/api/me/sessions", &bobSessions)
	if len(bobSessions) != 1 || bobSessions[0].ID == aliceSessions[0].ID {
		t.Fatalf("bob's sessions = %+v", bobSessions)
	}
	// Alice names bob's session id: nothing happens to it.
	alice.do("DELETE", "/api/me/sessions/"+bobSessions[0].ID, nil)
	if st := bob.do("GET", "/api/me", nil); st != 200 {
		t.Errorf("alice signed bob out: %d", st)
	}
	alice.do("POST", "/api/me/sessions/revoke-others", nil)
	alice.do("POST", "/api/me/sessions/revoke-all", nil)
	if st := bob.do("GET", "/api/me", nil); st != 200 {
		t.Errorf("alice's revoke-all signed bob out: %d", st)
	}
}

func TestEveryAdminRouteIsAdminOnly(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	user, _ := e.addUser("alice", roleUser)
	anon := e.newClient()

	routes := []struct{ method, path string }{
		{"GET", "/api/admin/users"},
		{"POST", "/api/admin/users"},
		{"PATCH", "/api/admin/users/1"},
		{"DELETE", "/api/admin/users/1?confirm=admin"},
		{"POST", "/api/admin/users/1/reset-password"},
		{"POST", "/api/admin/users/1/revoke-sessions"},
		{"POST", "/api/admin/users/alice/two-factor-reset"},
		{"GET", "/api/admin/audit"},
		{"POST", "/api/admin/backup"},
		{"GET", "/api/admin/settings"},
		{"PATCH", "/api/admin/settings"},
		{"GET", "/api/admin/usage"},
		{"PUT", "/api/admin/usage"},
		{"GET", "/api/admin/services"},
		{"PUT", "/api/admin/services"},
		{"POST", "/api/admin/services/action"},
		{"PUT", "/api/admin/defaults"},
	}
	for _, r := range routes {
		body := any(nil)
		if r.method == "POST" || r.method == "PATCH" {
			body = map[string]any{}
		}
		if st := anon.do(r.method, r.path, body); st != 401 {
			t.Errorf("anonymous %s %s = %d, want 401", r.method, r.path, st)
		}
		if st := user.do(r.method, r.path, body); st != 403 {
			t.Errorf("non-admin %s %s = %d, want 403", r.method, r.path, st)
		}
	}
	// Nothing the refused calls attempted took effect.
	if n := countRows(t, e, "SELECT count(*) FROM users"); n != 2 {
		t.Errorf("users = %d", n)
	}
	if st := admin.do("GET", "/api/admin/users", nil); st != 200 {
		t.Errorf("admin = %d", st)
	}
	// Losing the role takes the access away at once.
	u, _ := e.s.userByName(t.Context(), "alice")
	e.s.setRole(t.Context(), u.ID, roleAdmin)
	if st := user.do("GET", "/api/admin/users", nil); st != 200 {
		t.Errorf("promoted user = %d", st)
	}
	e.s.setRole(t.Context(), u.ID, roleUser)
	if st := user.do("GET", "/api/admin/users", nil); st != 403 {
		t.Errorf("demoted user = %d, want 403 immediately", st)
	}
}

func TestDeletingAUserRemovesTheirData(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	alice, _ := e.addUser("alice", roleUser)
	alice.putDoc("d-2026-10-01", `{"status":"red"}`)
	alice.putDoc("e-5", `{}`)
	bob, _ := e.addUser("bob", roleUser)
	bob.putDoc("d-2026-10-01", `{"status":"green"}`)

	var list struct {
		Users []user `json:"users"`
	}
	admin.getJSON("/api/admin/users", &list)
	var aliceID int64
	for _, u := range list.Users {
		if u.Username == "alice" {
			aliceID = u.ID
		}
	}
	if st := admin.do("DELETE", "/api/admin/users/"+itoa(aliceID)+"?confirm=alice", nil); st != 204 {
		t.Fatalf("delete = %d", st)
	}
	if n := countRows(t, e, "SELECT count(*) FROM docs WHERE user_id = ?", aliceID); n != 0 {
		t.Errorf("%d of alice's docs survived her account", n)
	}
	if n := countRows(t, e, "SELECT count(*) FROM sessions WHERE user_id = ?", aliceID); n != 0 {
		t.Errorf("%d of alice's sessions survived her account", n)
	}
	if st := alice.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("deleted user's session = %d, want 401", st)
	}
	if got := bob.docs(); len(got) != 1 {
		t.Errorf("bob's docs changed: %v", got)
	}
	// The audit trail says who it was, even though the account is gone.
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'user_deleted' AND target = 'alice' AND actor = 'admin'"); n != 1 {
		t.Error("deletion is not in the audit log")
	}
	// A new account with the same name starts empty: ids are never reused.
	e.addUser("alice", roleUser)
	c := e.newClient()
	c.mustLogin("alice", "password-alice")
	if got := c.docs(); len(got) != 0 {
		t.Errorf("a re-created account inherited data: %v", got)
	}
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
