package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func unpackTestBackup(t *testing.T, path, password string) string {
	t.Helper()
	db, cleanup, err := unpackBackup(path, password)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	return db
}
func TestBackupArchiveEncryptionAndRestore(t *testing.T) {
	e := newTestServer(t)
	e.signedInAdmin().putDoc("d-2026-10-01", `{"status":"green"}`)
	raw, err := snapshotToTemp(e.s.db, e.dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(raw)
	for _, password := range []string{"", "a long backup passphrase"} {
		archive, err := archiveBackup(raw, password)
		if err != nil {
			t.Fatal(err)
		}
		defer os.Remove(archive)
		db := unpackTestBackup(t, archive, password)
		if got := scalar(t, db, "SELECT count(*) FROM docs"); got != 1 {
			t.Fatalf("restored %d docs", got)
		}
		if password != "" {
			if _, clean, err := unpackBackup(archive, "incorrect password"); err == nil {
				clean()
				t.Fatal("wrong password accepted")
			}
			if _, clean, err := unpackBackup(archive, ""); err == nil {
				clean()
				t.Fatal("missing password accepted")
			}
			data, _ := os.ReadFile(archive)
			if bytes.Contains(data, []byte("SQLite format")) {
				t.Fatal("encrypted backup exposed database")
			}
		}
	}
	// The CLI restores the encrypted form, rather than making the operator unpack it manually.
	archive, err := archiveBackup(raw, "a long backup passphrase")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(archive)
	passwordFile := filepath.Join(t.TempDir(), "password")
	os.WriteFile(passwordFile, []byte("a long backup passphrase\n"), 0600)
	destination := filepath.Join(t.TempDir(), "restored.db")
	t.Setenv("APP_DB", destination)
	if _, _, _, err := cli(t, "", "restore", archive, "--password-file", passwordFile, "--yes"); err != nil {
		t.Fatal(err)
	}
	if got := scalar(t, destination, "SELECT count(*) FROM docs"); got != 1 {
		t.Fatal(got)
	}
	if got := scalar(t, destination, "SELECT count(*) FROM sessions"); got != 0 {
		t.Fatal("restored sessions survived")
	}
}
func TestEncryptedArchiveTamperTruncationAndChunking(t *testing.T) {
	plain := bytes.Repeat([]byte("a"), archiveChunk+37)
	var encrypted bytes.Buffer
	if err := encryptBackup(&encrypted, bytes.NewReader(plain), "backup password"); err != nil {
		t.Fatal(err)
	}
	data := encrypted.Bytes()
	var restored bytes.Buffer
	if err := decryptBackup(&restored, bytes.NewReader(data), "backup password"); err != nil || !bytes.Equal(plain, restored.Bytes()) {
		t.Fatal("chunk roundtrip", err)
	}
	flipped := bytes.Clone(data)
	flipped[len(flipped)-1] ^= 1
	for _, bad := range [][]byte{data[:len(data)-1], data[:len(archiveMagic)+20+4], flipped, append(bytes.Clone(data), 1)} {
		if err := decryptBackup(io.Discard, bytes.NewReader(bad), "backup password"); err == nil {
			t.Fatal("damaged archive accepted")
		}
	}
}
func TestArchiveRefusesUnexpectedMembers(t *testing.T) {
	for _, names := range [][]string{{"../jiggered.db"}, {"jiggered.db", "jiggered.db"}, {".jiggered-service-key"}, {"README.txt"}} {
		path := filepath.Join(t.TempDir(), "bad.zip")
		f, _ := os.Create(path)
		z := zip.NewWriter(f)
		for _, name := range names {
			w, _ := z.Create(name)
			w.Write([]byte("data"))
		}
		z.Close()
		f.Close()
		if _, cleanup, err := unpackBackup(path, ""); err == nil {
			cleanup()
			t.Fatal("unexpected members accepted", names)
		}
	}
}
func TestRemoteEncryptionPasswordIsSealedPreservedAndClearable(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	cfg := testServices(t, e)
	cfg.Remote.Encrypt = true
	cfg.Remote.EncryptionPassword = "a remote backup password"
	saveTestServices(t, e, admin, cfg)
	var raw string
	e.s.db.QueryRow(`SELECT value FROM instance_settings WHERE key='remote_services'`).Scan(&raw)
	if strings.Contains(raw, "a remote backup password") {
		t.Fatal("password stored as plaintext")
	}
	loaded, _ := e.s.loadServices(context.Background(), true)
	if loaded.Remote.EncryptionPassword != "a remote backup password" {
		t.Fatal("cannot decrypt saved password")
	}
	var safe struct {
		Settings serviceSettings `json:"settings"`
		Saved    bool            `json:"backup_password_saved"`
	}
	admin.getJSON("/api/admin/services", &safe)
	if !safe.Saved || safe.Settings.Remote.EncryptionPassword != "" {
		t.Fatal("secret exposed or saved flag missing")
	}
	saveTestServices(t, e, admin, safe.Settings)
	loaded, _ = e.s.loadServices(context.Background(), true)
	if loaded.Remote.EncryptionPassword != "a remote backup password" {
		t.Fatal("blank input discarded password")
	}
	// Cannot clear a password while encryption is still enabled.
	safe.Settings = testServices(t, e)
	safe.Settings.Remote.EncryptionPassword = ""
	if status := admin.do("PUT", "/api/admin/services", map[string]any{"settings": safe.Settings, "password": adminPass, "clear_backup": true}); status != 400 {
		t.Fatal(status)
	}
	safe.Settings.Remote.Encrypt = false
	if status := admin.do("PUT", "/api/admin/services", map[string]any{"settings": safe.Settings, "password": adminPass, "clear_backup": true}); status != 200 {
		t.Fatal(status)
	}
	loaded, _ = e.s.loadServices(context.Background(), true)
	if loaded.Remote.EncryptionPassword != "" {
		t.Fatal("clear did not remove password")
	}
	encoded, _ := json.Marshal(safeServices(loaded))
	if bytes.Contains(encoded, []byte("a remote backup password")) {
		t.Fatal("secret leaked")
	}
}
func TestEncryptedAdminDownload(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	response, body := admin.req("POST", "/api/admin/backup", map[string]string{"password": adminPass, "encryption_password": "archive password"})
	if response.StatusCode != 200 || !bytes.HasPrefix(body, []byte(archiveMagic)) || !strings.Contains(response.Header.Get("Content-Disposition"), ".zip.enc") {
		t.Fatal(response.StatusCode, response.Header)
	}
	source := filepath.Join(t.TempDir(), "download.zip.enc")
	os.WriteFile(source, body, 0600)
	db := unpackTestBackup(t, source, "archive password")
	if err := checkBackup(db); err != nil {
		t.Fatal(err)
	}
}

func TestRemoteEncryptedZIPUploadAndDownload(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	storage, mu, objects := fakeS3(t)
	cfg := testServices(t, e)
	cfg.Remote.Enabled = true
	cfg.Remote.Endpoint = storage.URL
	cfg.Remote.AllowHTTP = true
	cfg.Remote.Bucket = "backups"
	cfg.Remote.AccessKey = "test-access"
	cfg.Remote.SecretKey = "test-secret"
	cfg.Remote.Encrypt = true
	cfg.Remote.EncryptionPassword = "remote archive password"
	saveTestServices(t, e, admin, cfg)
	response, body := admin.req("POST", "/api/admin/services/action", map[string]string{"action": "backup", "password": adminPass})
	if response.StatusCode != 202 {
		t.Fatal(response.StatusCode, string(body))
	}
	var key, status string
	for i := 0; i < 200; i++ {
		e.s.db.QueryRow(`SELECT object_key,status FROM remote_backup_runs ORDER BY id DESC LIMIT 1`).Scan(&key, &status)
		if status != "running" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if status != "success" || !strings.HasSuffix(key, ".zip.enc") {
		t.Fatal(status, key)
	}
	mu.Lock()
	uploaded := bytes.Clone(objects[key])
	mu.Unlock()
	if !bytes.HasPrefix(uploaded, []byte(archiveMagic)) {
		t.Fatal("remote upload was not encrypted")
	}
	response, download := admin.req("POST", "/api/admin/services/action", map[string]string{"action": "download", "key": key, "password": adminPass})
	if response.StatusCode != 200 || !bytes.Equal(uploaded, download) {
		t.Fatal("download did not preserve the archive")
	}
	path := filepath.Join(t.TempDir(), "remote.zip.enc")
	os.WriteFile(path, download, 0600)
	if err := checkBackup(unpackTestBackup(t, path, "remote archive password")); err != nil {
		t.Fatal(err)
	}
}
