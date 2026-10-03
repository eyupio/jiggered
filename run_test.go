package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// lockedBuffer collects the log the way the testing package collects t.Log: one writer at a time.
type lockedBuffer struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// A whole start/stop cycle through run: the server starts on a free port with no accounts, answers a health
// check, and returns cleanly once the context is cancelled — with the database closed and nothing left running.
func TestRunServesUntilCancelledAndShutsDownCleanly(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APP_DB", filepath.Join(dir, "jiggered.db"))
	t.Setenv("APP_ADDR", "127.0.0.1:0")
	t.Setenv("APP_SECURE_COOKIE", "false")
	os.Unsetenv("APP_USERNAME")
	os.Unsetenv("APP_PASSWORD")
	os.Unsetenv("APP_PASSWORD_HASH")
	var logs lockedBuffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(io.Discard) })

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx) }()

	base := ""
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
		if i := strings.Index(logs.String(), "listening on "); i >= 0 {
			addr := strings.TrimSpace(strings.SplitN(logs.String()[i+len("listening on "):], "\n", 2)[0])
			base = "http://" + addr
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if base == "" {
		t.Fatal("the server never said it was listening")
	}
	resp, err := http.Get(base + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(body) != "ok" {
		t.Fatalf("healthz = %d %q", resp.StatusCode, body)
	}
	if !strings.Contains(logs.String(), "no accounts yet") {
		t.Error("a configured server should say how to make the first account")
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run returned %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run did not return after the context was cancelled")
	}
	// The database was closed on the way out: it opens again straight away.
	db, err := openRaw(filepath.Join(dir, "jiggered.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
}
