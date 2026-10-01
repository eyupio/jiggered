package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// legacyDB writes a database exactly as the single-user version left it (schema
// version 0, docs and sessions without owners) and returns its path.
func legacyDB(t *testing.T, docs map[string]string, sessions map[string]int64) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "jiggered.db")
	db, err := openRaw(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := migrateBaseline(tx, nil); err != nil {
		t.Fatal(err)
	}
	for id, body := range docs {
		if _, err := tx.Exec("INSERT INTO docs(id, body, updated_at) VALUES(?, ?, 1700000000)", id, body); err != nil {
			t.Fatal(err)
		}
	}
	for hash, exp := range sessions {
		if _, err := tx.Exec("INSERT INTO sessions(token_hash, expires_at) VALUES(?, ?)", hash, exp); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return path
}

func seedFor(t *testing.T, name, pw string) *seedAdmin {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	if err != nil {
		t.Fatal(err)
	}
	return &seedAdmin{name: name, hash: string(h)}
}

func scalar(t *testing.T, path, query string, args ...any) int {
	t.Helper()
	db, err := openRaw(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMigrateFreshDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jiggered.db")
	db, err := openDB(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if v := scalar(t, path, "PRAGMA user_version"); v != len(migrations) {
		t.Errorf("user_version = %d, want %d", v, len(migrations))
	}
	if n := scalar(t, path, "SELECT count(*) FROM users"); n != 0 {
		t.Errorf("fresh database has %d users", n)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(path), "backups")); !os.IsNotExist(err) {
		t.Error("a brand-new database should not make a pre-upgrade snapshot")
	}
}

func TestMigrateAdoptsLegacyData(t *testing.T) {
	body1 := `{"date":"2026-09-29","status":"green","entries":[]}`
	body2 := `{"when":"2026-09-30T14:00","notes":"café ☕ résumé"}` // multi-byte: size must count bytes
	future, past := time.Now().Add(48*time.Hour).Unix(), time.Now().Add(-48*time.Hour).Unix()
	path := legacyDB(t,
		map[string]string{"d-2026-09-29": body1, "e-1790000000000": body2},
		map[string]int64{"live-token-hash": future, "stale-token-hash": past})

	db, err := openDB(path, seedFor(t, "paul", "oldpassword1"))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	if got := scalar(t, path, "SELECT count(*) FROM users WHERE username = 'paul' AND role = 'admin' AND must_change_password = 0"); got != 1 {
		t.Fatalf("expected one admin called paul, found %d", got)
	}
	if got := scalar(t, path, "SELECT count(*) FROM docs WHERE user_id = (SELECT id FROM users WHERE username = 'paul') AND rev = 1"); got != 2 {
		t.Errorf("paul owns %d docs, want 2", got)
	}
	if got := scalar(t, path, "SELECT size FROM docs WHERE id = 'e-1790000000000'"); got != len(body2) {
		t.Errorf("size = %d, want %d bytes", got, len(body2))
	}
	if got := scalar(t, path, "SELECT count(*) FROM sessions WHERE token_hash = 'live-token-hash' AND length(sid) = 16"); got != 1 {
		t.Error("the live session should survive, so nobody is signed out by the upgrade")
	}
	if got := scalar(t, path, "SELECT count(*) FROM sessions WHERE token_hash = 'stale-token-hash'"); got != 0 {
		t.Error("an expired session should be dropped")
	}
	if got := scalar(t, path, "SELECT count(*) FROM audit_log WHERE action = 'migrated' AND target = 'paul'"); got != 1 {
		t.Error("the upgrade should be in the audit log")
	}

	// The pre-upgrade snapshot is a complete copy of the legacy database.
	snaps, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "backups", "pre-upgrade-v0-*.db"))
	if len(snaps) != 1 {
		t.Fatalf("want one pre-upgrade snapshot, got %v", snaps)
	}
	if got := scalar(t, snaps[0], "SELECT count(*) FROM docs"); got != 2 {
		t.Errorf("snapshot holds %d docs, want 2", got)
	}
	if got := scalar(t, snaps[0], "PRAGMA user_version"); got != 0 {
		t.Errorf("snapshot user_version = %d, want 0 (untouched legacy copy)", got)
	}
}

func TestMigrateLegacyDataNeedsAFirstAdmin(t *testing.T) {
	path := legacyDB(t, map[string]string{"d-2026-09-29": `{"date":"2026-09-29"}`}, nil)
	if _, err := openDB(path, nil); !errors.Is(err, errNeedFirstAdmin) {
		t.Fatalf("want errNeedFirstAdmin, got %v", err)
	}
	// Nothing was lost or half-changed: the legacy table is still intact...
	if got := scalar(t, path, "SELECT count(*) FROM docs WHERE id = 'd-2026-09-29'"); got != 1 {
		t.Fatal("legacy doc went missing after a refused upgrade")
	}
	// ...and supplying the account lets the same database upgrade.
	db, err := openDB(path, seedFor(t, "paul", "oldpassword1"))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if got := scalar(t, path, "SELECT count(*) FROM docs d JOIN users u ON u.id = d.user_id WHERE u.username = 'paul'"); got != 1 {
		t.Error("doc was not adopted on the second try")
	}
}

func TestMigrateLegacySessionsOnlyDoesNotNeedAnAdmin(t *testing.T) {
	path := legacyDB(t, nil, map[string]int64{"x": time.Now().Add(time.Hour).Unix()})
	db, err := openDB(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if got := scalar(t, path, "SELECT count(*) FROM sessions"); got != 0 {
		t.Error("sessions with no owner should be dropped")
	}
}

func TestMigrateIsIdempotent(t *testing.T) {
	path := legacyDB(t, map[string]string{"d-2026-09-29": `{"date":"2026-09-29"}`}, nil)
	seed := seedFor(t, "paul", "oldpassword1")
	for i := 0; i < 3; i++ {
		db, err := openDB(path, seed)
		if err != nil {
			t.Fatalf("open #%d: %v", i, err)
		}
		db.Close()
	}
	snaps, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "backups", "*.db"))
	if len(snaps) != 1 {
		t.Errorf("re-opening should not snapshot again; have %d snapshots", len(snaps))
	}
	if got := scalar(t, path, "SELECT count(*) FROM docs"); got != 1 {
		t.Errorf("docs = %d after re-opening", got)
	}
	if got := scalar(t, path, "SELECT count(*) FROM users"); got != 1 {
		t.Errorf("users = %d after re-opening", got)
	}
}

func TestMigrateRefusesANewerSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jiggered.db")
	db, err := openDB(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("PRAGMA user_version = 99"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	_, err = openDB(path, nil)
	if err == nil || !strings.Contains(err.Error(), "refusing") {
		t.Fatalf("a database from a newer version must be refused, got %v", err)
	}
}

// The backup bug: with the server running, recent writes live in the -wal file,
// so copying jiggered.db alone loses them. snapshot() must not.
func TestSnapshotIncludesRecentWritesAndKeepsSchemaVersion(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	for _, id := range []string{"d-2026-09-01", "d-2026-09-02", "d-2026-09-03"} {
		if st, _ := admin.putDoc(id, `{"status":"green"}`); st != 200 {
			t.Fatalf("PUT %s: %d", id, st)
		}
	}
	dest := filepath.Join(t.TempDir(), "copy.db")
	if err := snapshot(e.s.db, dest); err != nil {
		t.Fatal(err)
	}
	if got := scalar(t, dest, "SELECT count(*) FROM docs"); got != 3 {
		t.Errorf("snapshot has %d docs, want 3", got)
	}
	if got := scalar(t, dest, "SELECT count(*) FROM users"); got != 1 {
		t.Errorf("snapshot has %d users, want 1", got)
	}
	if got := scalar(t, dest, "PRAGMA user_version"); got != len(migrations) {
		t.Errorf("snapshot user_version = %d, want %d, or a restored backup would be re-migrated", got, len(migrations))
	}
	if err := snapshot(e.s.db, dest); err == nil {
		t.Error("snapshot must not overwrite an existing file")
	}
}
