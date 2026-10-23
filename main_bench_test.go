package main

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func BenchmarkServiceWorker(b *testing.B) {
	st := newStatic(fstest.MapFS{"app.js": {Data: []byte("x")}})
	sw := []byte(`const CACHE = "jiggered-app-v1";
const SHELL = ["/", "/app.js", "/style.css", "/tokens.css", "/login.js", "/tools.css"];
`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		st.serviceWorker(sw)
	}
}

func BenchmarkSnapshotTag(b *testing.B) {
	db, err := openDB(filepath.Join(b.TempDir(), "jiggered.db"), nil)
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (1, 'u', 'x', 'user', 0)"); err != nil {
		b.Fatal(err)
	}
	seed, err := db.Begin()
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < 1500; i++ {
		if _, err := seed.Exec("INSERT INTO docs (user_id, id, body, rev, size, updated_at) VALUES (1, ?, '{}', 3, 2, 1700000000)", fmt.Sprintf("d-2026-01-%04d", i)); err != nil {
			b.Fatal(err)
		}
	}
	if err := seed.Commit(); err != nil {
		b.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		b.Fatal(err)
	}
	defer tx.Rollback()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, err := snapshotTag(context.Background(), tx, 1); err != nil {
			b.Fatal(err)
		}
	}
}
