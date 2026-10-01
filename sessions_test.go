package main

import "testing"

// A sign-in reads the account, spends ~300ms on bcrypt, and only then creates the session. A password change or
// a disable that lands in between has already deleted the sessions, so the late one must not be created.

func TestPasswordChangeBeatsASignInThatWasAlreadyUnderway(t *testing.T) {
	e := newTestServer(t)
	e.addUser("bob", roleUser)
	ctx := t.Context()
	u, hash, err := e.s.loginUser(ctx, "bob") // what the sign-in read before its bcrypt
	if err != nil || u == nil {
		t.Fatal(err)
	}
	fresh, _ := e.s.hashPassword("a-new-password")
	if err := e.s.setPassword(ctx, u.ID, fresh, false, ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.s.newSession(ctx, u.ID, hash, "203.0.113.1", "test"); err == nil {
		t.Error("a sign-in that checked the old password still got a session after the password was changed")
	}
	if n := countRows(t, e, "SELECT count(*) FROM sessions WHERE user_id = ?", u.ID); n != 0 {
		t.Errorf("%d session(s) exist for an account whose password changed", n)
	}
	if _, _, err := e.s.newSession(ctx, u.ID, []byte(fresh), "203.0.113.1", "test"); err != nil {
		t.Errorf("a sign-in that checked the current password must work: %v", err)
	}
}

func TestDisablingBeatsASignInThatWasAlreadyUnderway(t *testing.T) {
	e := newTestServer(t)
	e.addUser("bob", roleUser)
	ctx := t.Context()
	u, hash, err := e.s.loginUser(ctx, "bob")
	if err != nil || u == nil {
		t.Fatal(err)
	}
	if err := e.s.setDisabled(ctx, u.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.s.newSession(ctx, u.ID, hash, "203.0.113.1", "test"); err == nil {
		t.Error("a sign-in that began before the account was disabled still got a session")
	}
	if err := e.s.setDisabled(ctx, u.ID, false); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, e, "SELECT count(*) FROM sessions WHERE user_id = ?", u.ID); n != 0 {
		t.Errorf("%d session(s) came back when the account was re-enabled", n)
	}
}

func TestEachAccountKeepsOnlyItsNewestSessions(t *testing.T) {
	e := newTestServer(t)
	oldest, _ := e.addUser("alice", roleUser)
	var newest *client
	for i := 0; i < maxSessionsPerUser+5; i++ {
		newest = e.newClient()
		newest.mustLogin("alice", "password-alice")
	}
	if n := countRows(t, e, "SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'alice'"); n != maxSessionsPerUser {
		t.Errorf("alice has %d sessions, want the newest %d", n, maxSessionsPerUser)
	}
	if st := oldest.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("the oldest session should have been signed out: %d", st)
	}
	if st := newest.do("GET", "/api/me", nil); st != 200 {
		t.Errorf("the newest session must work: %d", st)
	}
}
