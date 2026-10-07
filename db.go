package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// seedAdmin is the account made from APP_USERNAME / APP_PASSWORD(_HASH). It is
// only used while the database has no accounts, and it adopts any data that
// predates accounts.
type seedAdmin struct{ name, hash string }

var errNeedFirstAdmin = errors.New("this database holds data from before Jiggered had accounts; set APP_USERNAME and APP_PASSWORD_HASH (or APP_PASSWORD) so that account can take it over")

// versionAccounts is the schema version that introduced accounts, and with them the need for a first admin.
const versionAccounts = 2

// temp_store(2) keeps SQLite's scratch space in memory: the shipped container has a read-only root and no /tmp, so
// a big upgrade (dropping a 20 MB table) otherwise fails with "unable to open database file". secure_delete(ON)
// overwrites deleted rows, so a deleted account's data doesn't linger in the file.
const dsnPragmas = "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=temp_store(2)&_pragma=secure_delete(ON)&_txlock=immediate"

// sqliteURI turns a file path into the file: URI SQLite wants. A path may hold %, ? and #, which would otherwise
// change which file is opened ("my#data.db" became "my").
func sqliteURI(path string) string {
	return "file:" + strings.NewReplacer("%", "%25", "?", "%3f", "#", "%23").Replace(path)
}

// openRaw opens the database without touching its schema.
func openRaw(path string) (*sql.DB, error) {
	// Everything in it is private. SQLite gives -wal and -shm the mode of the main file, so make that 0600 first.
	if f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600); err == nil {
		f.Close()
		os.Chmod(path, 0o600)
	}
	db, err := sql.Open("sqlite", sqliteURI(path)+dsnPragmas)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := enableWAL(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func enableWAL(db *sql.DB) error {
	deadline := time.Now().Add(5 * time.Second)
	for {
		var mode string
		err := db.QueryRow("PRAGMA journal_mode=WAL").Scan(&mode)
		if err == nil {
			if mode != "wal" {
				return fmt.Errorf("enabling WAL mode: SQLite selected %q", mode)
			}
			return nil
		}
		var sqliteErr interface{ Code() int }
		if !errors.As(err, &sqliteErr) || sqliteErr.Code() != 5 || !time.Now().Before(deadline) {
			return fmt.Errorf("enabling WAL mode: %w", err)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// openDB opens the database and brings its schema up to date.
func openDB(path string, first *seedAdmin) (*sql.DB, error) {
	db, err := openRaw(path)
	if err != nil {
		return nil, err
	}
	if err := migrate(db, path, first); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// migrations run in order, each in its own transaction. Never edit one that
// has shipped; append a new one.
var migrations = []func(tx *sql.Tx, first *seedAdmin) error{migrateBaseline, migrateAccounts, migrateSettings, migrateDocRevs, migrateSecurityAccounts, migrateProductImprovements}

func migrate(db *sql.DB, path string, first *seedAdmin) error {
	var cur int
	if err := db.QueryRow("PRAGMA user_version").Scan(&cur); err != nil {
		return err
	}
	if cur > len(migrations) {
		return fmt.Errorf("database schema is v%d but this build only knows up to v%d; refusing to open it (run a newer Jiggered)", cur, len(migrations))
	}
	if cur == len(migrations) {
		return nil
	}
	// A database from before accounts needs someone to take it over. Say so before taking a snapshot: nothing
	// changes when this is refused, and a container that restarts on a missing APP_USERNAME would otherwise
	// leave a full copy of the database behind on every try.
	if cur < versionAccounts && first == nil {
		n, err := legacyDocs(db)
		if err != nil {
			return err
		}
		if n > 0 {
			return fmt.Errorf("upgrading database to schema v%d: %w", versionAccounts, errNeedFirstAdmin)
		}
	}
	if err := snapshotBeforeMigrating(db, path, cur); err != nil {
		return err
	}
	for v := cur; v < len(migrations); v++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		// Another process (the CLI, say) may have migrated while we waited for the lock.
		var now int
		if err := tx.QueryRow("PRAGMA user_version").Scan(&now); err != nil || now > v {
			tx.Rollback()
			if err != nil {
				return err
			}
			continue
		}
		if err := migrations[v](tx, first); err != nil {
			tx.Rollback()
			return fmt.Errorf("upgrading database to schema v%d: %w", v+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", v+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// legacyDocs counts the docs in a database from before accounts existed: zero if it holds none, or isn't one.
func legacyDocs(db *sql.DB) (int, error) {
	var tables int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'docs'").Scan(&tables); err != nil || tables == 0 {
		return 0, err
	}
	var n int
	err := db.QueryRow("SELECT count(*) FROM docs").Scan(&n)
	return n, err
}

// snapshotBeforeMigrating keeps a copy of any existing database before its
// schema changes, so a bad upgrade is never the only copy of someone's data.
func snapshotBeforeMigrating(db *sql.DB, path string, from int) error {
	var tables int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").Scan(&tables); err != nil {
		return err
	}
	if tables == 0 {
		return nil
	}
	dir := filepath.Join(filepath.Dir(path), "backups")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("creating backup directory: %w", err)
	}
	dest := filepath.Join(dir, fmt.Sprintf("pre-upgrade-v%d-%s.db", from, time.Now().Format("20060102-150405")))
	if err := snapshot(db, dest); err != nil {
		return fmt.Errorf("backing up before upgrade: %w", err)
	}
	log.Printf("saved a copy of the database to %s before upgrading its schema", dest)
	return nil
}

// snapshot writes a consistent copy of a live database. Copying the .db file
// alone is not enough in WAL mode: recent writes live in the -wal file.
func snapshot(db *sql.DB, dest string) error {
	if dest == "" || dest == ":memory:" || strings.HasPrefix(dest, "file:") {
		return fmt.Errorf("%q isn't a file name SQLite would write a file for", dest) // it would "succeed" and write nothing
	}
	if _, err := db.Exec("VACUUM INTO ?", dest); err != nil {
		os.Remove(dest) // a partial copy is worse than none
		return err
	}
	if st, err := os.Stat(dest); err != nil || st.Size() == 0 {
		return fmt.Errorf("the copy at %s wasn't written", dest)
	}
	return os.Chmod(dest, 0o600)
}

// v1: the original single-user schema.
func migrateBaseline(tx *sql.Tx, _ *seedAdmin) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS docs (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);`)
	return err
}

const schemaAccounts = `
CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  disabled             INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  last_login_at        INTEGER
);
CREATE TABLE docs (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  body       TEXT NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 1,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  sid          TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip     TEXT NOT NULL DEFAULT ''
);`

// v2: accounts. Docs and sessions gain an owner; whatever the single-user
// version stored is adopted by the first admin in the same transaction.
func migrateAccounts(tx *sql.Tx, first *seedAdmin) error {
	var docs, sessions int
	if err := tx.QueryRow("SELECT (SELECT count(*) FROM docs), (SELECT count(*) FROM sessions)").Scan(&docs, &sessions); err != nil {
		return err
	}
	if docs > 0 && first == nil {
		return errNeedFirstAdmin
	}
	for _, q := range []string{
		"ALTER TABLE docs RENAME TO docs_v0",
		"ALTER TABLE sessions RENAME TO sessions_v0",
		schemaAccounts,
	} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}
	if first != nil && (docs > 0 || sessions > 0) {
		now := time.Now().Unix()
		res, err := tx.Exec("INSERT INTO users(username, password_hash, role, created_at) VALUES(?, ?, 'admin', ?)", first.name, first.hash, now)
		if err != nil {
			return err
		}
		uid, err := res.LastInsertId()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO docs(user_id, id, body, rev, size, updated_at)
			SELECT ?, id, body, 1, length(CAST(body AS BLOB)), updated_at FROM docs_v0`, uid); err != nil {
			return err
		}
		ttl := int64(sessionTTL / time.Second)
		if _, err := tx.Exec(`INSERT INTO sessions(token_hash, sid, user_id, created_at, last_seen_at, expires_at)
			SELECT token_hash, lower(hex(randomblob(8))), ?, expires_at - ?, expires_at - ?, expires_at FROM sessions_v0 WHERE expires_at > ?`,
			uid, ttl, ttl, now); err != nil {
			return err
		}
		if _, err := tx.Exec("INSERT INTO audit_log(at, actor, action, target, detail) VALUES(?, 'system', 'migrated', ?, ?)",
			now, first.name, fmt.Sprintf("%d existing docs adopted", docs)); err != nil {
			return err
		}
	}
	for _, q := range []string{"DROP TABLE docs_v0", "DROP TABLE sessions_v0"} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}
	return nil
}

// v3: instance settings (secure cookies, reverse proxy) move from the environment into the database.
func migrateSettings(tx *sql.Tx, _ *seedAdmin) error {
	_, err := tx.Exec(`CREATE TABLE instance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`)
	return err
}

// v4: the last revision of a deleted document survives the delete, so recreating it carries on counting instead of
// starting again at 1, where a device still holding the old revision 1 could overwrite the replacement.
func migrateDocRevs(tx *sql.Tx, _ *seedAdmin) error {
	_, err := tx.Exec(`CREATE TABLE doc_revs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id      TEXT NOT NULL,
  rev     INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID`)
	return err
}

func migrateProductImprovements(tx *sql.Tx, first *seedAdmin) error {
	_, err := tx.Exec(`
 ALTER TABLE remote_backup_runs ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE remote_backup_runs ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE remote_backup_runs ADD COLUMN verification_required INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE remote_backup_runs ADD COLUMN retained INTEGER NOT NULL DEFAULT 0;
 UPDATE remote_backup_runs SET uploaded=1,retained=1 WHERE status='success';
 UPDATE remote_backup_runs SET verified=1,verification_required=1 WHERE status='success' AND message='Backup uploaded and SHA-256 verified.';
 CREATE TABLE account_mail_deliveries(id INTEGER PRIMARY KEY AUTOINCREMENT,purpose TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'queued',token_hash TEXT NOT NULL,payload TEXT NOT NULL,error_category TEXT NOT NULL DEFAULT '');
 CREATE INDEX account_mail_due ON account_mail_deliveries(status,next_at);
 CREATE TABLE usage_consent(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,seed TEXT NOT NULL);
 CREATE TABLE product_usage(cohort TEXT NOT NULL,week TEXT NOT NULL,event TEXT NOT NULL,count INTEGER NOT NULL,days INTEGER NOT NULL,PRIMARY KEY(cohort,week,event));
 `)
	return err
}
