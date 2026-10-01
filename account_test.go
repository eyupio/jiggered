package main

import (
	"strings"
	"testing"
)

func TestSessionListAndRevoke(t *testing.T) {
	e := newTestServer(t)
	phone, pw := e.addUser("alice", roleUser)
	laptop := e.newClient()
	laptop.login("alice", pw, "User-Agent", "Mozilla/5.0 (X11; Linux)\tFirefox/130.0\tinjected")

	var list []sessionOut
	laptop.getJSON("/api/me/sessions", &list)
	if len(list) != 2 {
		t.Fatalf("sessions = %+v", list)
	}
	var cur, other sessionOut
	for _, s := range list {
		if s.Current {
			cur = s
		} else {
			other = s
		}
	}
	if cur.ID == "" || other.ID == "" || cur.ID == other.ID || len(cur.ID) != 16 {
		t.Fatalf("current %+v other %+v", cur, other)
	}
	if cur.UserAgent != "Mozilla/5.0 (X11; Linux)Firefox/130.0injected" {
		t.Errorf("user agent = %q (control characters must be stripped)", cur.UserAgent)
	}
	if cur.IP != "127.0.0.1" || cur.CreatedAt == 0 || cur.LastSeenAt == 0 {
		t.Errorf("current = %+v", cur)
	}
	if strings.Contains(strings.ToLower(laptop.mustBody("GET", "/api/me/sessions")), "token") {
		t.Error("the session list must not expose token material")
	}

	// Sign out the phone from the laptop.
	if st := laptop.do("DELETE", "/api/me/sessions/"+other.ID, nil); st != 204 {
		t.Errorf("revoke = %d", st)
	}
	if st := phone.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("revoked session still works: %d", st)
	}
	if st := laptop.do("GET", "/api/me", nil); st != 200 {
		t.Errorf("the revoking session was signed out too: %d", st)
	}
}

func TestSignOutOtherDevicesAndEverywhere(t *testing.T) {
	e := newTestServer(t)
	a, pw := e.addUser("alice", roleUser)
	b, c := e.newClient(), e.newClient()
	b.mustLogin("alice", pw)
	c.mustLogin("alice", pw)

	resp, body := a.req("POST", "/api/me/sessions/revoke-others", nil)
	if resp.StatusCode != 200 || !strings.Contains(string(body), `"revoked":2`) {
		t.Fatalf("revoke-others = %d %s", resp.StatusCode, body)
	}
	if a.do("GET", "/api/me", nil) != 200 || b.do("GET", "/api/me", nil) != 401 || c.do("GET", "/api/me", nil) != 401 {
		t.Error("revoke-others should keep only the caller")
	}

	resp, _ = a.req("POST", "/api/me/sessions/revoke-all", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("revoke-all = %d", resp.StatusCode)
	}
	cleared := false
	for _, ck := range resp.Cookies() {
		if ck.Name == cookieName && ck.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Error("revoke-all should clear the cookie")
	}
	if st := a.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("after revoke-all: %d", st)
	}
	if loc := e.newClient().login("alice", pw); loc != "/" {
		t.Error("revoking sessions must not stop signing in again")
	}
}

func TestRevokingYourOwnCurrentSession(t *testing.T) {
	e := newTestServer(t)
	a, _ := e.addUser("alice", roleUser)
	var list []sessionOut
	a.getJSON("/api/me/sessions", &list)
	resp, _ := a.req("DELETE", "/api/me/sessions/"+list[0].ID, nil)
	if resp.StatusCode != 204 {
		t.Fatalf("= %d", resp.StatusCode)
	}
	if st := a.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("= %d, want 401", st)
	}
}

func TestDeleteOwnAccount(t *testing.T) {
	e := newTestServer(t)
	alice, pw := e.addUser("alice", roleUser)
	alice.putDoc("d-2026-10-01", `{"status":"red"}`)
	bob, _ := e.addUser("bob", roleUser)
	bob.putDoc("d-2026-10-01", `{"status":"green"}`)

	if st := alice.do("DELETE", "/api/me", map[string]string{"password": "not-my-password"}); st != 403 {
		t.Errorf("wrong password = %d, want 403", st)
	}
	if st := alice.do("DELETE", "/api/me", map[string]string{}); st != 403 {
		t.Errorf("no password = %d, want 403", st)
	}
	if st := alice.do("GET", "/api/me", nil); st != 200 {
		t.Fatal("a refused delete must leave the account alone")
	}
	resp, _ := alice.req("DELETE", "/api/me", map[string]string{"password": pw})
	if resp.StatusCode != 204 {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	if n := countRows(t, e, "SELECT count(*) FROM users WHERE username = 'alice'"); n != 0 {
		t.Error("account still exists")
	}
	if n := countRows(t, e, "SELECT count(*) FROM docs WHERE user_id NOT IN (SELECT id FROM users)"); n != 0 {
		t.Error("orphaned docs")
	}
	if loc := e.newClient().login("alice", pw); loc != "/login?e=bad" {
		t.Errorf("a deleted account can sign in: %q", loc)
	}
	if got := bob.docs(); len(got) != 1 {
		t.Errorf("bob's data changed: %v", got)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'account_deleted' AND actor = 'alice'"); n != 1 {
		t.Error("self-deletion is not audited")
	}
}

func TestOnlyAdminCannotDeleteThemselves(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	if st := admin.do("DELETE", "/api/me", map[string]string{"password": adminPass}); st != 409 {
		t.Errorf("= %d, want 409", st)
	}
	if st := admin.do("GET", "/api/me", nil); st != 200 {
		t.Error("account vanished anyway")
	}
	e.addUser("second", roleAdmin)
	if st := admin.do("DELETE", "/api/me", map[string]string{"password": adminPass}); st != 204 {
		t.Errorf("with another admin around = %d, want 204", st)
	}
}

func TestDeleteAccountGuessesAreLimited(t *testing.T) {
	e := newTestServer(t)
	a, pw := e.addUser("alice", roleUser)
	for i := 0; i < 10; i++ {
		a.do("DELETE", "/api/me", map[string]string{"password": "wrong-guess"})
	}
	if st := a.do("DELETE", "/api/me", map[string]string{"password": pw}); st != 429 {
		t.Errorf("= %d, want 429: a stolen session must not be able to guess the password here", st)
	}
	if st := a.do("GET", "/api/me", nil); st != 200 {
		t.Error("account was deleted while rate limited")
	}
}

func TestCleanText(t *testing.T) {
	for in, want := range map[string]string{
		"plain": "plain", "tab\there": "tabhere", "nul\x00byte": "nulbyte", "del\x7f": "del",
		"ünï ☕": "ünï ☕", "": "",
	} {
		if got := cleanText(in, 100); got != want {
			t.Errorf("cleanText(%q) = %q, want %q", in, got, want)
		}
	}
	if got := cleanText("a☕☕☕", 5); got != "a☕" { // cut inside a rune: drop the broken tail
		t.Errorf("truncation = %q", got)
	}
	if got := cleanText(strings.Repeat("x", 500), 200); len(got) != 200 {
		t.Errorf("len = %d", len(got))
	}
}
