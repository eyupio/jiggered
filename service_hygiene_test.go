package main

import (
	"bytes"
	"context"
	"log"
	"strings"
	"testing"
)

func TestServerDoesNotCreateSchemaOutsideMigrations(t *testing.T) {
	e := newTestServer(t)
	if _, err := e.s.db.Exec("DROP TABLE remote_backup_runs"); err != nil {
		t.Fatal(err)
	}
	// Initializing service configuration must not silently repair a missing table.
	if _, err := newServer(e.s.cfg, e.s.db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := e.s.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name='remote_backup_runs'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("server initialization recreated a table outside migrations")
	}
}

func TestBackupHistoryFailureIsReported(t *testing.T) {
	e := newTestServer(t)
	if err := e.s.db.Close(); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	err := e.s.writeBackupHistory(context.Background(), 42, "record completion", "UPDATE remote_backup_runs SET message=? WHERE id=?", "private fixture text", 42)
	if err == nil {
		t.Fatal("closed database write succeeded")
	}
	if !strings.Contains(output.String(), "run 42: record completion:") {
		t.Fatalf("missing operation context: %s", &output)
	}
	if strings.Contains(output.String(), "private fixture text") {
		t.Fatal("query arguments leaked into diagnostics")
	}
}
