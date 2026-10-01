package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func cli(t *testing.T, stdin string, args ...string) (stdout, stderr string, handled bool, err error) {
	t.Helper()
	var out, errw bytes.Buffer
	handled, err = runCLI(args, strings.NewReader(stdin), &out, &errw)
	return out.String(), errw.String(), handled, err
}

func TestCLIDispatch(t *testing.T) {
	if _, _, handled, err := cli(t, ""); handled || err != nil {
		t.Errorf("no args should fall through to the server: handled=%v err=%v", handled, err)
	}
	out, _, handled, err := cli(t, "", "version")
	if !handled || err != nil || strings.TrimSpace(out) != version {
		t.Errorf("version = %q %v %v", out, handled, err)
	}
	out, _, _, _ = cli(t, "", "--help")
	if !strings.Contains(out, "jiggered user add") || !strings.Contains(out, "jiggered backup") {
		t.Errorf("usage = %q", out)
	}
	if _, _, handled, err := cli(t, "", "frobnicate"); !handled || err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Errorf("unknown command: handled=%v err=%v (must not silently start the server)", handled, err)
	}
}

func TestCLIHash(t *testing.T) {
	out, _, _, err := cli(t, "", "hash", "correct horse")
	if err != nil || bcrypt.CompareHashAndPassword([]byte(strings.TrimSpace(out)), []byte("correct horse")) != nil {
		t.Errorf("hash from argument: %q %v", out, err)
	}
	out, _, _, err = cli(t, "from stdin\r\n", "hash")
	if err != nil || bcrypt.CompareHashAndPassword([]byte(strings.TrimSpace(out)), []byte("from stdin")) != nil {
		t.Errorf("hash from stdin: %q %v", out, err)
	}
	if _, _, _, err := cli(t, "", "hash", "short"); err == nil {
		t.Error("a short password should be refused")
	}
	if _, _, _, err := cli(t, "", "hash", strings.Repeat("x", 80)); err == nil {
		t.Error("a password over 72 bytes should be refused")
	}
}

func TestCLIBackupToFile(t *testing.T) {
	e := newTestServer(t) // keep the server running: its recent writes are in the -wal file
	admin := e.signedInAdmin()
	admin.putDoc("d-2026-10-01", `{"status":"green"}`)
	t.Setenv("APP_DB", e.dbPath)

	dest := filepath.Join(t.TempDir(), "copy.db")
	_, errOut, _, err := cli(t, "", "backup", dest)
	if err != nil || !strings.Contains(errOut, dest) {
		t.Fatalf("backup: %v %q", err, errOut)
	}
	if got := scalar(t, dest, "SELECT count(*) FROM docs"); got != 1 {
		t.Errorf("the copy has %d docs, want 1", got)
	}
	if got := scalar(t, dest, "SELECT count(*) FROM users"); got != 1 {
		t.Errorf("the copy has %d users, want 1", got)
	}
	if _, _, _, err := cli(t, "", "backup", dest); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Errorf("must not overwrite: %v", err)
	}
	if _, _, _, err := cli(t, "", "backup", "a", "b"); err == nil {
		t.Error("two destinations make no sense")
	}
}

func TestCLIBackupWithNoArgumentGoesToTheBackupFolder(t *testing.T) {
	e := newTestServer(t)
	e.signedInAdmin().putDoc("d-2026-10-01", `{"status":"green"}`)
	t.Setenv("APP_DB", e.dbPath)
	_, errOut, _, err := cli(t, "", "backup")
	if err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(backupDir(e.dbPath), "jiggered-*.db"))
	if len(files) != 1 || !strings.Contains(errOut, files[0]) {
		t.Fatalf("backups = %v, message %q", files, errOut)
	}
	if got := scalar(t, files[0], "SELECT count(*) FROM docs"); got != 1 {
		t.Errorf("the default backup has %d docs", got)
	}
}

func TestCLIBackupToStdout(t *testing.T) {
	e := newTestServer(t)
	e.signedInAdmin().putDoc("d-2026-10-01", `{"status":"green"}`)
	t.Setenv("APP_DB", e.dbPath)

	out, _, _, err := cli(t, "", "backup", "-")
	if err != nil || !strings.HasPrefix(out, "SQLite format 3\x00") {
		t.Fatalf("backup -: %v %q", err, out[:min(20, len(out))])
	}
	dest := filepath.Join(t.TempDir(), "from-stdout.db")
	if err := os.WriteFile(dest, []byte(out), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := scalar(t, dest, "SELECT count(*) FROM docs"); got != 1 {
		t.Errorf("stdout copy has %d docs", got)
	}
	left, _ := filepath.Glob(filepath.Join(backupDir(e.dbPath), ".tmp-*"))
	if len(left) != 0 {
		t.Errorf("left temporary files: %v", left)
	}

	tty, err := os.OpenFile("/dev/null", os.O_WRONLY, 0)
	if err != nil {
		t.Skip("no /dev/null")
	}
	defer tty.Close()
	if err := cmdBackup([]string{"-"}, tty, os.Stderr); err == nil || !strings.Contains(err.Error(), "terminal") {
		t.Errorf("writing a database to a character device must be refused: %v", err)
	}
}

func TestCLIBackupWithoutADatabase(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope.db")
	t.Setenv("APP_DB", missing)
	if _, _, _, err := cli(t, "", "backup", filepath.Join(t.TempDir(), "x.db")); err == nil || !strings.Contains(err.Error(), "no database") {
		t.Errorf("= %v", err)
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Error("a backup must not create an empty database as a side effect")
	}
	if _, _, _, err := cli(t, "", "user", "list"); err == nil || !strings.Contains(err.Error(), "no database") {
		t.Errorf("user list = %v", err)
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Error("nor may the user commands")
	}
}

func TestCLIHealthcheck(t *testing.T) {
	e := newTestServer(t)
	t.Setenv("APP_ADDR", strings.TrimPrefix(e.ts.URL, "http://"))
	if _, _, handled, err := cli(t, "", "healthcheck"); !handled || err != nil {
		t.Fatalf("healthy server: %v", err)
	}
	e.s.db.Close() // /healthz now answers 503
	if _, _, _, err := cli(t, "", "healthcheck"); err == nil {
		t.Error("an unhealthy server must fail the check")
	}
	e.ts.Close()
	if _, _, _, err := cli(t, "", "healthcheck"); err == nil {
		t.Error("no server must fail the check")
	}
}

func TestCLIHealthcheckAddresses(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()
	port := regexp.MustCompile(`:(\d+)$`).FindStringSubmatch(ts.URL)[1]
	for _, addr := range []string{":" + port, "0.0.0.0:" + port, "127.0.0.1:" + port} {
		t.Setenv("APP_ADDR", addr)
		if err := cmdHealthcheck(); err != nil {
			t.Errorf("APP_ADDR=%s: %v", addr, err)
		}
	}
	t.Setenv("APP_ADDR", "garbage")
	if err := cmdHealthcheck(); err == nil {
		t.Error("a malformed address should fail")
	}
}

func TestCLIUserCommands(t *testing.T) {
	e := newTestServer(t)
	ctx := context.Background()
	run := func(args ...string) (string, error) {
		var out bytes.Buffer
		err := e.s.runUserCommand(ctx, args, &out)
		return out.String(), err
	}
	temp := regexp.MustCompile(`[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}`)

	out, err := run("list")
	if err != nil || !strings.Contains(out, "admin") || !strings.Contains(out, "USERNAME") {
		t.Fatalf("list: %q %v", out, err)
	}

	out, err = run("add", "Alice")
	pw := temp.FindString(out)
	if err != nil || pw == "" || !strings.Contains(out, `"alice"`) {
		t.Fatalf("add: %q %v", out, err)
	}
	c := e.newClient()
	c.mustLogin("alice", pw)
	var me map[string]any
	c.getJSON("/api/me", &me)
	if me["role"] != roleUser || me["must_change_password"] != true {
		t.Errorf("alice = %v", me)
	}
	if _, err := run("add", "alice"); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Errorf("duplicate: %v", err)
	}
	if _, err := run("add", "bad name"); err == nil {
		t.Error("invalid name accepted")
	}
	out, _ = run("add", "carol", "--admin")
	if !strings.Contains(out, "Created admin") {
		t.Errorf("--admin: %q", out)
	}

	out, err = run("reset-password", "alice")
	pw2 := temp.FindString(out)
	if err != nil || pw2 == "" || pw2 == pw {
		t.Fatalf("reset: %q %v", out, err)
	}
	if st := c.do("GET", "/api/me", nil); st != 401 {
		t.Error("reset-password should sign the account out everywhere")
	}
	e.newClient().mustLogin("alice", pw2)

	if _, err := run("disable", "alice"); err != nil {
		t.Fatal(err)
	}
	if loc := e.newClient().login("alice", pw2); loc != "/login?e=disabled" {
		t.Errorf("disabled: %q", loc)
	}
	if _, err := run("enable", "alice"); err != nil {
		t.Fatal(err)
	}
	if _, err := run("promote", "alice"); err != nil {
		t.Fatal(err)
	}
	if u, _ := e.s.userByName(ctx, "alice"); u.Role != roleAdmin {
		t.Error("promote")
	}
	if _, err := run("demote", "alice"); err != nil {
		t.Fatal(err)
	}

	// The last active admin is protected from every command that could remove them.
	e.s.setDisabled(ctx, mustUser(t, e, "carol").ID, true)
	for _, cmd := range [][]string{{"demote", "admin"}, {"disable", "admin"}, {"delete", "admin", "--yes"}} {
		if _, err := run(cmd...); err == nil || !strings.Contains(err.Error(), "no active admin") {
			t.Errorf("%v: %v, want the last-admin refusal", cmd, err)
		}
	}

	if _, err := run("delete", "alice"); err == nil || !strings.Contains(err.Error(), "--yes") {
		t.Errorf("delete without --yes: %v", err)
	}
	if _, err := run("delete", "alice", "--yes"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.userByName(ctx, "alice"); err == nil {
		t.Error("alice still exists")
	}

	for _, args := range [][]string{{"disable", "nobody"}, {"disable"}, {"frobnicate", "admin"}} {
		if _, err := run(args...); err == nil {
			t.Errorf("%v should fail", args)
		}
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE actor = 'cli'"); n < 8 {
		t.Errorf("only %d CLI actions in the audit log", n)
	}
}

func mustUser(t *testing.T, e *testEnv, name string) *user {
	t.Helper()
	u, err := e.s.userByName(context.Background(), name)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// The command can recover an instance whose admin is locked out of the web UI.
func TestCLIRecoversALockedOutAdmin(t *testing.T) {
	e := newTestServer(t)
	for i := 0; i < 10; i++ {
		e.newClient().login(adminName, "wrong-wrong")
	}
	var out bytes.Buffer
	if err := e.s.runUserCommand(context.Background(), []string{"reset-password", adminName}, &out); err != nil {
		t.Fatal(err)
	}
	pw := regexp.MustCompile(`[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}`).FindString(out.String())
	e.s.ipLimit.reset("127.0.0.1")
	e.s.userLimit.reset(adminName) // the CLI can't reach the in-memory limiter; a restart clears it, as the README says
	if loc := e.newClient().login(adminName, pw); loc != "/" {
		t.Errorf("recovered login: %q", loc)
	}
}

// cmdUser is the glue between the environment, the database and runUserCommand.
func TestCLIUserCommandEndToEnd(t *testing.T) {
	e := newTestServer(t)
	t.Setenv("APP_DB", e.dbPath)
	t.Setenv("APP_PASSWORD", "")
	t.Setenv("APP_PASSWORD_HASH", "")

	out, _, handled, err := cli(t, "", "user", "add", "dana", "--admin")
	if !handled || err != nil || !strings.Contains(out, "Temporary password: ") {
		t.Fatalf("user add: %q %v", out, err)
	}
	// The running server sees it at once: it is the same database.
	if u, err := e.s.userByName(context.Background(), "dana"); err != nil || u.Role != roleAdmin {
		t.Errorf("dana = %+v %v", u, err)
	}
	out, _, _, err = cli(t, "", "user", "list")
	if err != nil || !strings.Contains(out, "dana") || !strings.Contains(out, "must change password") {
		t.Errorf("user list: %q %v", out, err)
	}
	if _, _, _, err := cli(t, "", "user"); err == nil {
		t.Error("`user` with no subcommand should print usage")
	}
}

func TestCLIRestore(t *testing.T) {
	// A database with some history, backed up; then more happens; then it is restored.
	e := newTestServer(t)
	admin := e.signedInAdmin()
	admin.putDoc("d-2026-10-01", `{"status":"green"}`)
	t.Setenv("APP_DB", e.dbPath)
	good := filepath.Join(t.TempDir(), "good.db")
	if _, _, _, err := cli(t, "", "backup", good); err != nil {
		t.Fatal(err)
	}
	admin.putDoc("d-2026-10-02", `{"status":"red"}`)
	e.ts.Close()
	e.s.db.Close() // the server is stopped, as the command requires

	if _, _, _, err := cli(t, "", "restore", good); err == nil || !strings.Contains(err.Error(), "--yes") {
		t.Errorf("without --yes: %v (it must say what it would do and not do it)", err)
	}
	if got := scalar(t, e.dbPath, "SELECT count(*) FROM docs"); got != 2 {
		t.Fatalf("a refused restore changed the database: %d docs", got)
	}
	// Leftover WAL/SHM files from the old database must not be applied to the restored one.
	os.WriteFile(e.dbPath+"-wal", []byte("stale"), 0o600)
	os.WriteFile(e.dbPath+"-shm", []byte("stale"), 0o600)

	out, errOut, _, err := cli(t, "", "restore", good, "--yes")
	if err != nil || !strings.Contains(out, "Restored") || !strings.Contains(errOut, "pre-restore-") {
		t.Fatalf("restore: %q %q %v", out, errOut, err)
	}
	if got := scalar(t, e.dbPath, "SELECT count(*) FROM docs"); got != 1 {
		t.Errorf("restored database has %d docs, want the backup's 1", got)
	}
	for _, f := range []string{e.dbPath + "-wal", e.dbPath + "-shm", e.dbPath + ".restoring"} {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Errorf("%s should be gone", f)
		}
	}
	kept, _ := filepath.Glob(filepath.Join(backupDir(e.dbPath), "pre-restore-*.db"))
	if len(kept) != 1 || scalar(t, kept[0], "SELECT count(*) FROM docs") != 2 {
		t.Errorf("the replaced database should be kept intact: %v", kept)
	}
	// And the restored database is the real thing: it opens, and the admin can sign in.
	db, err := openDB(e.dbPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := newServer(config{}, db)
	defer db.Close()
	if u, err := s.userByName(t.Context(), adminName); err != nil || u.Role != roleAdmin {
		t.Errorf("admin after restore: %+v %v", u, err)
	}
}

func TestCLIRestoreRefusesBadFiles(t *testing.T) {
	e := newTestServer(t)
	t.Setenv("APP_DB", e.dbPath)
	dir := t.TempDir()
	write := func(name string, data []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	newer := filepath.Join(dir, "newer.db")
	if err := snapshot(e.s.db, newer); err != nil {
		t.Fatal(err)
	}
	if db, _ := openRaw(newer); db != nil {
		db.Exec("PRAGMA user_version = 99")
		db.Close()
	}
	other := filepath.Join(dir, "other.db") // a real SQLite file that isn't ours
	if db, _ := openRaw(other); db != nil {
		db.Exec("CREATE TABLE notes(x)")
		db.Close()
	}
	before := scalar(t, e.dbPath, "SELECT count(*) FROM users")
	for name, c := range map[string]struct{ path, want string }{
		"missing":                 {filepath.Join(dir, "nope.db"), "can't read"},
		"not a database":          {write("junk.db", []byte("this is not sqlite at all, just text that is long enough to look like a file")), "isn't a Jiggered database"},
		"empty file":              {write("empty.db", nil), "isn't a Jiggered database"},
		"from a newer Jiggered":   {newer, "newer Jiggered"},
		"someone else's database": {other, "no docs table"},
	} {
		_, _, _, err := cli(t, "", "restore", c.path, "--yes")
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v, want it to mention %q", name, err, c.want)
		}
	}
	if got := scalar(t, e.dbPath, "SELECT count(*) FROM users"); got != before {
		t.Error("a refused restore must leave the database alone")
	}
	if kept, _ := filepath.Glob(filepath.Join(backupDir(e.dbPath), "pre-restore-*.db")); len(kept) != 0 {
		t.Errorf("nothing was replaced, so nothing should have been set aside: %v", kept)
	}
	for _, args := range [][]string{{"restore"}, {"restore", "a", "b", "c"}, {"restore", "a", "--force"}} {
		if _, _, _, err := cli(t, "", args...); err == nil || !strings.Contains(err.Error(), "usage") {
			t.Errorf("%v: %v, want a usage message", args, err)
		}
	}
	// The user's own file is untouched by validation: no -wal/-shm beside it, same bytes.
	if _, err := os.Stat(newer + "-wal"); !os.IsNotExist(err) {
		t.Error("checking a backup must not create files next to it")
	}
}
