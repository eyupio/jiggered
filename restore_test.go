package main

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBackupRefusesDestinationsThatWouldWriteNothing(t *testing.T) {
	e := newTestServer(t)
	t.Setenv("APP_DB", e.dbPath)
	dir := t.TempDir()
	wd, _ := os.Getwd()
	os.Chdir(dir)
	defer os.Chdir(wd)
	for _, dest := range []string{"", ":memory:", "file:x.db?mode=memory", "--yes", "--help"} {
		if _, _, _, err := cli(t, "", "backup", dest); err == nil {
			t.Errorf("backup %q reported success", dest)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("a refused backup created %v", entries)
	}
}

func TestDatabasePathWithSpecialCharactersIsOpenedAsGiven(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"my#data.db", "ji?ggered.db", "a%20b.db"} {
		want := filepath.Join(dir, name)
		db, err := openDB(want, nil)
		if err != nil {
			t.Fatal(err)
		}
		db.Close()
		if _, err := os.Stat(want); err != nil {
			t.Errorf("asked for %q but it wasn't created", name)
		}
	}
}

func TestDatabaseAndBackupsArePrivate(t *testing.T) {
	e := newTestServer(t)
	e.signedInAdmin().putDoc("d-2026-10-01", `{"a":1}`)
	t.Setenv("APP_DB", e.dbPath)
	if _, _, _, err := cli(t, "", "backup"); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(filepath.Dir(e.dbPath), "*"))
	more, _ := filepath.Glob(filepath.Join(backupDir(e.dbPath), "*"))
	for _, f := range append(files, more...) {
		if st, _ := os.Stat(f); !st.IsDir() && st.Mode().Perm()&0o077 != 0 {
			t.Errorf("%s is readable by others (%v)", f, st.Mode().Perm())
		}
	}
}

func TestRestoreRefusesWhileTheServerHasTheDatabaseOpen(t *testing.T) {
	e := newTestServer(t)
	good := filepath.Join(t.TempDir(), "good.db")
	if err := snapshot(e.s.db, good); err != nil {
		t.Fatal(err)
	}
	e.signedInAdmin().putDoc("d-2026-10-01", `{"after":"backup"}`)
	t.Setenv("APP_DB", e.dbPath)
	_, _, _, err := cli(t, "", "restore", good, "--yes")
	if err == nil || !strings.Contains(err.Error(), "in use") {
		t.Fatalf("restore over a running server: %v", err)
	}
	if n := countRows(t, e, "SELECT count(*) FROM docs"); n != 1 {
		t.Errorf("the refused restore changed the database (%d docs)", n)
	}
}

func TestRestoreWorksOverADamagedDatabase(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	good := filepath.Join(t.TempDir(), "good.db")
	snapshot(e.s.db, good)
	for i := 0; i < 400; i++ {
		admin.putDoc("e-"+itoa(int64(1000+i)), `{"pad":"`+strings.Repeat("x", 500)+`"}`)
	}
	e.ts.Close()
	e.s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	e.s.db.Close()
	f, _ := os.OpenFile(e.dbPath, os.O_RDWR, 0)
	f.WriteAt([]byte(strings.Repeat("\xde\xad\xbe\xef", 1024)), 3*4096)
	f.Close()
	t.Setenv("APP_DB", e.dbPath)
	if _, _, _, err := cli(t, "", "restore", good, "--yes"); err != nil {
		t.Fatalf("restoring a good backup over a damaged database: %v", err)
	}
	if kept, _ := filepath.Glob(filepath.Join(backupDir(e.dbPath), "pre-restore-damaged-*")); len(kept) == 0 {
		t.Error("the damaged database wasn't kept")
	}
	if n := scalar(t, e.dbPath, "SELECT count(*) FROM users"); n != 1 {
		t.Errorf("restored database has %d users", n)
	}
}

func TestRestoreRefusesASourceWithItsOwnWAL(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	admin.putDoc("d-2026-10-01", `{"v":1}`)
	e.s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	admin.putDoc("d-2026-10-02", `{"v":2}`)
	raw := t.TempDir()
	for _, suffix := range []string{"", "-wal"} {
		b, err := os.ReadFile(e.dbPath + suffix)
		if err != nil {
			t.Fatal(err)
		}
		os.WriteFile(filepath.Join(raw, "jiggered.db"+suffix), b, 0o600)
	}
	t.Setenv("APP_DB", filepath.Join(t.TempDir(), "jiggered.db"))
	if _, _, _, err := cli(t, "", "restore", filepath.Join(raw, "jiggered.db"), "--yes"); err == nil || !strings.Contains(err.Error(), "-wal") {
		t.Errorf("a source whose recent changes sit in a -wal file must be refused, not half restored: %v", err)
	}
}

func TestRestoreRefusesFoldersAndTriggers(t *testing.T) {
	e := newTestServer(t)
	t.Setenv("APP_DB", filepath.Join(t.TempDir(), "x.db"))
	if _, _, _, err := cli(t, "", "restore", t.TempDir(), "--yes"); err == nil {
		t.Error("a folder was accepted")
	}
	evil := filepath.Join(t.TempDir(), "evil.db")
	snapshot(e.s.db, evil)
	db, _ := openRaw(evil)
	db.Exec("CREATE TRIGGER t AFTER INSERT ON docs BEGIN DELETE FROM users; END")
	db.Close()
	if _, _, _, err := cli(t, "", "restore", evil, "--yes"); err == nil || !strings.Contains(err.Error(), "triggers") {
		t.Errorf("a backup with a trigger: %v", err)
	}
}

func TestLeftoverTempCopiesAreSweptAtStart(t *testing.T) {
	e := newTestServer(t)
	os.MkdirAll(backupDir(e.dbPath), 0o700)
	tmp := filepath.Join(backupDir(e.dbPath), ".tmp-123.db")
	os.WriteFile(tmp, []byte("x"), 0o600)
	sweepTempBackups(e.dbPath)
	if _, err := os.Stat(tmp); err == nil {
		t.Error("a killed backup's temporary copy was left in place")
	}
}

func TestRestoreEndsRevokedSessions(t *testing.T) {
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

func TestRestoreRefusesDocsOnlyDatabase(t *testing.T) {
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

func TestRestoreErasesAdminAudit(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	e.s.audit(t.Context(), "admin", "password_reset", "alice", "KEEP-MARKER", "")
	r, b := alice.req("POST", "/api/restore/preview", `{"e-1":{}}`)
	if r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	var p struct {
		Token string `json:"token"`
	}
	json.Unmarshal(b, &p)
	if st := alice.do("POST", "/api/restore", `{"e-1":{}}`, "If-Match", p.Token); st != 200 {
		t.Fatal(st)
	}
	var classified int
	e.s.db.QueryRow("SELECT count(*) FROM audit_log WHERE action='restore' AND NOT " + auditSelfService).Scan(&classified)
	if classified != 0 {
		t.Fatal(classified)
	}
	// Seed repeat events locally rather than hammering the HTTP server 10,000 times.
	tx, _ := e.s.db.Begin()
	for i := 0; i < auditMaxRows; i++ {
		tx.Exec("INSERT INTO audit_log(at,actor,action,target,detail,ip)VALUES(?,?,?,?,?,?)", time.Now().Unix(), "alice", "restore", "alice", "", "")
	}
	tx.Commit()
	e.s.prune()
	if countRows(t, e, "SELECT count(*) FROM audit_log WHERE detail='KEEP-MARKER'") != 1 {
		t.Fatal("marker retained")
	}
}
