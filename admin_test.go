package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func adminUsers(t *testing.T, admin *client) []userStat {
	t.Helper()
	var out struct {
		Users   []userStat `json:"users"`
		Version string     `json:"version"`
	}
	admin.getJSON("/api/admin/users", &out)
	if out.Version == "" {
		t.Error("user list should say which version is running")
	}
	return out.Users
}

func findUser(t *testing.T, users []userStat, name string) userStat {
	t.Helper()
	for _, u := range users {
		if u.Username == name {
			return u
		}
	}
	t.Fatalf("no user %q in %+v", name, users)
	return userStat{}
}

func TestAdminCreatesUsers(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()

	resp, b := admin.req("POST", "/api/admin/users", map[string]string{"username": "  Bob "})
	if resp.StatusCode != 201 {
		t.Fatalf("create = %d %s", resp.StatusCode, b)
	}
	var out struct {
		User         user   `json:"user"`
		TempPassword string `json:"temp_password"`
	}
	json.Unmarshal(b, &out)
	if out.User.Username != "bob" || out.User.Role != roleUser || !out.User.MustChange {
		t.Errorf("user = %+v", out.User)
	}
	if !regexp.MustCompile(`^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$`).MatchString(out.TempPassword) {
		t.Errorf("temporary password %q", out.TempPassword)
	}
	if strings.Contains(string(b), "password_hash") {
		t.Error("the response must never contain a hash")
	}
	// It is shown once: no endpoint gives it back.
	if _, b := admin.req("GET", "/api/admin/users", nil); strings.Contains(string(b), out.TempPassword) {
		t.Error("temporary password shown again")
	}
	bob := e.newClient()
	bob.mustLogin("bob", out.TempPassword)

	cases := []struct {
		name string
		body any
		want int
	}{
		{"duplicate", map[string]string{"username": "bob"}, 409},
		{"duplicate in another case", map[string]string{"username": "BOB"}, 409},
		{"the bootstrap admin's name", map[string]string{"username": "admin"}, 409},
		{"empty", map[string]string{"username": ""}, 400},
		{"spaces inside", map[string]string{"username": "a b"}, 400},
		{"too long", map[string]string{"username": strings.Repeat("a", 65)}, 400},
		{"bad role", map[string]string{"username": "carol", "role": "root"}, 400},
		{"unknown field", map[string]any{"username": "carol", "password": "x"}, 400},
		{"not json", `nope`, 400},
	}
	for _, c := range cases {
		if st := admin.do("POST", "/api/admin/users", c.body); st != c.want {
			t.Errorf("%s = %d, want %d", c.name, st, c.want)
		}
	}
	createViaAPI(t, admin, "carol", roleAdmin)
	if findUser(t, adminUsers(t, admin), "carol").Role != roleAdmin {
		t.Error("carol should be an admin")
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'user_created' AND actor = 'admin' AND target IN ('bob', 'carol')"); n != 2 {
		t.Errorf("audit has %d creations, want 2", n)
	}
}

func TestAdminUserListShowsCountsNotContents(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	alice, _ := e.addUser("alice", roleUser)
	e.addUser("zed", roleUser)
	alice.putDoc("d-2026-10-01", `{"a":1}`)
	alice.putDoc("d-2026-10-02", `{"a":22}`)
	e.newClient().mustLogin("alice", "password-alice") // a second session

	users := adminUsers(t, admin)
	if len(users) != 3 || users[0].Username != "admin" || users[2].Username != "zed" {
		t.Fatalf("not sorted by name: %+v", users)
	}
	a := findUser(t, users, "alice")
	if a.Docs != 2 || a.Bytes != int64(len(`{"a":1}`)+len(`{"a":22}`)) || a.Sessions != 2 {
		t.Errorf("alice = %+v", a)
	}
	if a.LastLogin == 0 || time.Since(time.Unix(a.LastLogin, 0)) > time.Minute {
		t.Errorf("last sign-in = %d", a.LastLogin)
	}
	if z := findUser(t, users, "zed"); z.Docs != 0 || z.Sessions != 1 {
		t.Errorf("zed = %+v", z)
	}
}

func TestAdminChangesRoleAndEnabled(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	bob, bobPw := e.addUser("bob", roleUser)
	bobID := findUser(t, adminUsers(t, admin), "bob").ID
	path := "/api/admin/users/" + itoa(bobID)

	if st := admin.do("PATCH", path, map[string]any{"role": "admin"}); st != 200 {
		t.Fatalf("promote = %d", st)
	}
	if st := bob.do("GET", "/api/admin/users", nil); st != 200 {
		t.Errorf("a promoted user can use the admin API: %d", st)
	}
	if st := admin.do("PATCH", path, map[string]any{"role": "user"}); st != 200 {
		t.Fatalf("demote = %d", st)
	}
	if st := bob.do("GET", "/api/admin/users", nil); st != 403 {
		t.Errorf("a demoted user can't: %d", st)
	}

	if st := admin.do("PATCH", path, map[string]any{"disabled": true}); st != 200 {
		t.Fatalf("disable = %d", st)
	}
	if st := bob.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("disabling must end their sessions: %d", st)
	}
	if loc := e.newClient().login("bob", bobPw); loc != "/login?e=disabled" {
		t.Errorf("disabled login: %q", loc)
	}
	if st := admin.do("PATCH", path, map[string]any{"disabled": false}); st != 200 {
		t.Fatalf("enable = %d", st)
	}
	if loc := e.newClient().login("bob", bobPw); loc != "/" {
		t.Errorf("after enabling: %q", loc)
	}

	for name, c := range map[string]struct {
		path string
		body any
		want int
	}{
		"bad role":      {path, map[string]any{"role": "root"}, 400},
		"unknown field": {path, map[string]any{"username": "x"}, 400},
		"no such user":  {"/api/admin/users/9999", map[string]any{"disabled": true}, 404},
		"bad id":        {"/api/admin/users/abc", map[string]any{"disabled": true}, 400},
	} {
		if st := admin.do("PATCH", c.path, c.body); st != c.want {
			t.Errorf("%s = %d, want %d", name, st, c.want)
		}
	}
	for _, action := range []string{"role_changed", "user_disabled", "user_enabled"} {
		if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = ? AND target = 'bob' AND actor = 'admin'", action); n < 1 {
			t.Errorf("audit is missing %s", action)
		}
	}
}

func TestAdminCannotChangeThemselves(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	myID := findUser(t, adminUsers(t, admin), "admin").ID
	base := "/api/admin/users/" + itoa(myID)
	for name, c := range map[string]struct{ method, path string }{
		"demote":          {"PATCH", base},
		"reset password":  {"POST", base + "/reset-password"},
		"revoke sessions": {"POST", base + "/revoke-sessions"},
		"delete":          {"DELETE", base + "?confirm=admin"},
	} {
		var body any
		if c.method == "PATCH" {
			body = map[string]any{"role": "user"}
		} else if c.method == "POST" {
			body = map[string]any{}
		}
		if st := admin.do(c.method, c.path, body); st != 400 {
			t.Errorf("%s on yourself = %d, want 400", name, st)
		}
	}
	if st := admin.do("PATCH", base, map[string]any{"disabled": true}); st != 400 {
		t.Errorf("disable yourself = %d, want 400", st)
	}
	if st := admin.do("GET", "/api/me", nil); st != 200 {
		t.Errorf("still signed in: %d", st)
	}
}

func TestLastActiveAdminIsProtected(t *testing.T) {
	e := newTestServer(t)
	ctx := t.Context()
	first, _ := e.s.userByName(ctx, "admin")

	for name, err := range map[string]error{
		"demote":  e.s.setRole(ctx, first.ID, roleUser),
		"disable": e.s.setDisabled(ctx, first.ID, true),
		"delete":  e.s.deleteUser(ctx, first.ID),
	} {
		if !errors.Is(err, errLastAdmin) {
			t.Errorf("%s the only admin: %v, want errLastAdmin", name, err)
		}
	}
	if u, _ := e.s.userByName(ctx, "admin"); u == nil || u.Role != roleAdmin || u.Disabled {
		t.Fatalf("the guard let something through: %+v", u)
	}

	// With a second active admin, either can go, but not both.
	e.addUser("second", roleAdmin)
	second, _ := e.s.userByName(ctx, "second")
	if err := e.s.setDisabled(ctx, second.ID, true); err != nil {
		t.Fatalf("disabling one of two admins: %v", err)
	}
	// A disabled admin is not an active admin, so the first is the last again.
	if err := e.s.setRole(ctx, first.ID, roleUser); !errors.Is(err, errLastAdmin) {
		t.Errorf("demoting the only *active* admin: %v, want errLastAdmin", err)
	}
	if err := e.s.setDisabled(ctx, second.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := e.s.setRole(ctx, first.ID, roleUser); err != nil {
		t.Errorf("demoting one of two active admins: %v", err)
	}
	if err := e.s.deleteUser(ctx, second.ID); !errors.Is(err, errLastAdmin) {
		t.Errorf("deleting the remaining admin: %v, want errLastAdmin", err)
	}
	// Disabling and deleting a plain user never trips the guard.
	e.addUser("plain", roleUser)
	plain, _ := e.s.userByName(ctx, "plain")
	if err := e.s.setDisabled(ctx, plain.ID, true); err != nil {
		t.Error(err)
	}
	if err := e.s.deleteUser(ctx, plain.ID); err != nil {
		t.Error(err)
	}
	if err := e.s.setRole(ctx, 9999, roleUser); !errors.Is(err, errNoUser) {
		t.Errorf("unknown id: %v", err)
	}
}

func TestAdminResetsAPassword(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	bob, bobPw := e.addUser("bob", roleUser)
	bobID := findUser(t, adminUsers(t, admin), "bob").ID

	for i := 0; i < 10; i++ { // lock bob out first: a reset should also let him back in
		e.newClient().login("bob", "wrong-wrong")
	}
	resp, b := admin.req("POST", "/api/admin/users/"+itoa(bobID)+"/reset-password", map[string]any{})
	if resp.StatusCode != 200 {
		t.Fatalf("reset = %d %s", resp.StatusCode, b)
	}
	var out struct {
		TempPassword string `json:"temp_password"`
	}
	json.Unmarshal(b, &out)
	if out.TempPassword == "" {
		t.Fatal("no temporary password returned")
	}
	if st := bob.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("reset must sign the account out everywhere: %d", st)
	}
	e.s.ipLimit.reset("127.0.0.1")
	if loc := e.newClient().login("bob", bobPw); loc != "/login?e=bad" {
		t.Errorf("old password still works: %q", loc)
	}
	nb := e.newClient()
	nb.mustLogin("bob", out.TempPassword)
	var me map[string]any
	nb.getJSON("/api/me", &me)
	if me["must_change_password"] != true {
		t.Error("after a reset the person must choose their own password")
	}
	if st := admin.do("POST", "/api/admin/users/9999/reset-password", map[string]any{}); st != 404 {
		t.Errorf("unknown user = %d", st)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'password_reset' AND target = 'bob'"); n != 1 {
		t.Error("reset is not audited")
	}
}

func TestAdminRevokesSessions(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	bob1, bobPw := e.addUser("bob", roleUser)
	bob2 := e.newClient()
	bob2.mustLogin("bob", bobPw)
	bobID := findUser(t, adminUsers(t, admin), "bob").ID

	var out map[string]float64
	resp, b := admin.req("POST", "/api/admin/users/"+itoa(bobID)+"/revoke-sessions", map[string]any{})
	json.Unmarshal(b, &out)
	if resp.StatusCode != 200 || out["revoked"] != 2 {
		t.Fatalf("revoke = %d %s", resp.StatusCode, b)
	}
	for _, c := range []*client{bob1, bob2} {
		if st := c.do("GET", "/api/me", nil); st != 401 {
			t.Errorf("session still valid: %d", st)
		}
	}
	if loc := e.newClient().login("bob", bobPw); loc != "/" {
		t.Errorf("revoking sessions must not block signing in again: %q", loc)
	}
}

func TestAdminDeletesAUser(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	e.addUser("bob", roleUser)
	id := findUser(t, adminUsers(t, admin), "bob").ID
	path := "/api/admin/users/" + itoa(id)

	for name, q := range map[string]string{"no confirmation": "", "wrong name": "?confirm=alice"} {
		if st := admin.do("DELETE", path+q, nil); st != 400 {
			t.Errorf("%s = %d, want 400", name, st)
		}
	}
	if findUser(t, adminUsers(t, admin), "bob").ID != id {
		t.Fatal("bob should still exist")
	}
	if st := admin.do("DELETE", path+"?confirm=BOB", nil); st != 204 {
		t.Errorf("confirmed delete = %d", st)
	}
	if st := admin.do("DELETE", path+"?confirm=bob", nil); st != 404 {
		t.Errorf("deleting twice = %d, want 404", st)
	}
}

func TestAuditLog(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	e.newClient().login(adminName, "wrong-wrong")
	e.newClient().login("ghost", "wrong-wrong")
	createViaAPI(t, admin, "bob", roleUser)

	var entries []auditOut
	admin.getJSON("/api/admin/audit", &entries)
	actions := []string{}
	for _, en := range entries {
		actions = append(actions, en.Action+":"+en.Target)
		if en.At == 0 {
			t.Errorf("entry without a time: %+v", en)
		}
		if strings.Contains(en.Detail+en.Target+en.Actor, "ghost") {
			t.Errorf("a name that doesn't exist was logged (people paste passwords into the username box): %+v", en)
		}
	}
	want := []string{"user_created:bob", "login_failed:admin", "login:admin"}
	for i, w := range want {
		if i >= len(actions) || actions[i] != w {
			t.Fatalf("audit (newest first) = %v, want it to start with %v", actions, want)
		}
	}
	if entries[0].Actor != "admin" || entries[0].IP != "127.0.0.1" {
		t.Errorf("entry = %+v", entries[0])
	}

	// Paging.
	var page1, page2 []auditOut
	admin.getJSON("/api/admin/audit?limit=2", &page1)
	if len(page1) != 2 {
		t.Fatalf("limit=2 gave %d", len(page1))
	}
	admin.getJSON("/api/admin/audit?limit=2&before="+itoa(page1[1].ID), &page2)
	if len(page2) == 0 || page2[0].ID >= page1[1].ID {
		t.Errorf("page 2 = %+v after %+v", page2, page1)
	}
	var capped []auditOut
	admin.getJSON("/api/admin/audit?limit=100000", &capped)
	if len(capped) > 500 {
		t.Error("limit not capped")
	}
}

func TestAuditRetention(t *testing.T) {
	e := newTestServer(t)
	old := time.Now().Add(-auditKeepFor - time.Hour).Unix()
	if _, err := e.s.db.Exec("INSERT INTO audit_log(at, actor, action) VALUES(?, 'x', 'ancient')", old); err != nil {
		t.Fatal(err)
	}
	tx, _ := e.s.db.Begin()
	for i := 0; i < auditMaxRows+50; i++ {
		tx.Exec("INSERT INTO audit_log(at, actor, action) VALUES(?, 'x', 'filler')", time.Now().Unix())
	}
	tx.Commit()
	e.s.prune()
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'ancient'"); n != 0 {
		t.Error("entries older than the retention window should go")
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log"); n != auditMaxRows {
		t.Errorf("audit log holds %d rows after pruning, want %d", n, auditMaxRows)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'filler'"); n != auditMaxRows {
		t.Error("pruning should drop the oldest and keep the newest")
	}
}

func TestBackupDownload(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	alice, _ := e.addUser("alice", roleUser)
	alice.putDoc("d-2026-10-01", `{"status":"red"}`)

	user := alice
	if st := user.do("POST", "/api/admin/backup", nil); st != 403 {
		t.Errorf("non-admin backup = %d, want 403", st)
	}
	if st := admin.do("GET", "/api/admin/backup", nil); st == 200 {
		t.Errorf("GET backup = %d: it has side effects, so it is POST only", st)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'backup_downloaded'"); n != 0 {
		t.Error("a refused backup request was treated as a download")
	}
	resp, body := admin.req("POST", "/api/admin/backup", map[string]any{"password": adminPass})
	if resp.StatusCode != 200 {
		t.Fatalf("backup = %d %s", resp.StatusCode, body)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Disposition"), `attachment; filename="jiggered-backup-`) || resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("headers = %v", resp.Header)
	}
	if !bytes.HasPrefix(body, []byte("SQLite format 3\x00")) {
		t.Fatalf("not a SQLite file: %q", body[:min(16, len(body))])
	}
	restored := filepath.Join(t.TempDir(), "restored.db")
	if err := os.WriteFile(restored, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if got := scalar(t, restored, "SELECT count(*) FROM users"); got != 2 {
		t.Errorf("backup has %d users, want 2", got)
	}
	if got := scalar(t, restored, "SELECT count(*) FROM docs WHERE id = 'd-2026-10-01'"); got != 1 {
		t.Error("the backup is the whole database, including everyone's data (the UI says so)")
	}
	if got := scalar(t, restored, "PRAGMA user_version"); got != len(migrations) {
		t.Errorf("backup schema version = %d", got)
	}
	// A restored backup opens and works.
	db, err := openDB(restored, nil)
	if err != nil {
		t.Fatalf("restored backup doesn't open: %v", err)
	}
	db.Close()

	left, _ := filepath.Glob(filepath.Join(backupDir(e.dbPath), ".tmp-*"))
	if len(left) != 0 {
		t.Errorf("temporary snapshots left behind: %v", left)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'backup_downloaded' AND actor = 'admin'"); n != 1 {
		t.Error("the download is not audited")
	}
}

func TestBackupNeedsThePasswordEveryTime(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	backups := func() int {
		return countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'backup_downloaded'")
	}

	if st := admin.do("POST", "/api/admin/backup", nil); st != 400 {
		t.Errorf("no body = %d, want 400", st)
	}
	if st := admin.do("POST", "/api/admin/backup", map[string]any{}); st != 403 {
		t.Errorf("no password = %d, want 403", st)
	}
	resp, body := admin.req("POST", "/api/admin/backup", map[string]any{"password": "not-the-password"})
	if resp.StatusCode != 403 || bytes.HasPrefix(body, []byte("SQLite format 3")) {
		t.Fatalf("wrong password = %d, want 403 and no database", resp.StatusCode)
	}
	if n := backups(); n != 0 {
		t.Errorf("a refused request was recorded as a download (%d)", n)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'password_check_failed'"); n != 2 {
		t.Errorf("failed checks recorded = %d, want 2", n)
	}
	// The right password works, and works again only by giving it again: nothing is remembered between downloads.
	for i := 0; i < 2; i++ {
		if st := admin.do("POST", "/api/admin/backup", map[string]any{"password": adminPass}); st != 200 {
			t.Fatalf("download %d with the password = %d", i+1, st)
		}
	}
	if st := admin.do("POST", "/api/admin/backup", map[string]any{}); st != 403 {
		t.Errorf("a download after earlier ones, with no password = %d, want 403", st)
	}
	if n := backups(); n != 2 {
		t.Errorf("downloads recorded = %d, want 2", n)
	}
}

func TestBackupPasswordGuessesAreRateLimited(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	var last int
	for i := 0; i < 15; i++ {
		last = admin.do("POST", "/api/admin/backup", map[string]any{"password": "guess"})
	}
	if last != 429 {
		t.Errorf("after many wrong passwords = %d, want 429", last)
	}
	if st := admin.do("POST", "/api/admin/backup", map[string]any{"password": adminPass}); st == 200 {
		t.Error("the lockout should also stop the right password until the window passes")
	}
}
