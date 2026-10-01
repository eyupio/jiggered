package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// backupDir sits next to the database, so it lives on the same volume.
func backupDir(dbPath string) string { return filepath.Join(filepath.Dir(dbPath), "backups") }

// snapshotToTemp writes a snapshot to a throwaway file in the backup directory
// (the only place besides the data volume that is writable in the container)
// and returns its path. The caller removes it.
func snapshotToTemp(db *sql.DB, dbPath string) (string, error) {
	dir := backupDir(dbPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	tmp := filepath.Join(dir, fmt.Sprintf(".tmp-%d.db", time.Now().UnixNano()))
	if err := snapshot(db, tmp); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return tmp, nil
}

// adminBackup streams a consistent copy of the whole database. It contains
// everyone's data, which is why only admins can ask for it and each download
// is logged.
func (s *server) adminBackup(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	if !s.backupMu.TryLock() {
		jsonError(w, http.StatusTooManyRequests, "A backup is already running.")
		return
	}
	defer s.backupMu.Unlock()

	tmp, err := snapshotToTemp(s.db, s.cfg.dbPath)
	if err != nil {
		log.Printf("backup: %v", err)
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer os.Remove(tmp)
	f, err := os.Open(tmp)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="jiggered-backup-%s.db"`, time.Now().Format("2006-01-02-150405")))
	w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	w.Header().Set("Cache-Control", "no-store")
	http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Minute))
	// Recorded before the first byte goes out: a download that is cut short has still handed over part of everyone's
	// data, and must not leave no trace.
	s.audit(r.Context(), a.u.Username, "backup_downloaded", "", "whole database", s.clientIP(r))
	if _, err := io.Copy(w, f); err != nil {
		log.Printf("backup: sending: %v", err)
	}
}
