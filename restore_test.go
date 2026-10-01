package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
