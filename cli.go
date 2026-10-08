package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"text/tabwriter"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const usage = `Jiggered ` + "(no arguments runs the server)" + `

In Docker, put this before every command below:  docker compose exec jiggered /jiggered

Accounts (work on the database directly, so they still work if you are locked out of the web UI):

  jiggered user add <name> [--admin]   create an account with a one-time temporary password
  jiggered user list
  jiggered user reset-password <name>  new temporary password, signs the account out everywhere
  jiggered user reset-two-factor <name> remove authenticator protection after verifying identity
  jiggered user disable <name>         block sign-in and end its sessions
  jiggered user enable <name>
  jiggered user promote <name>         make an admin
  jiggered user demote <name>
  jiggered user delete <name> --yes    delete the account and all its data

Settings, backups and checks:

  jiggered settings [list]             show the instance settings (they live in the database)
  jiggered settings set KEY VALUE      change one: secure_cookie, trust_proxy, proxy_hops, trusted_proxy_cidrs
  jiggered backup [file|-] [--password-file PATH]  save a consistent ZIP backup (no argument: into the data volume's backups folder; "-" writes it to stdout)
  jiggered restore <file> [--password-file PATH] --yes  put a backup in place of the database (stop the server first; what was there is kept)
  jiggered healthcheck                 exit 0 if the running server answers /healthz
  jiggered hash [password]             print a bcrypt hash for APP_PASSWORD_HASH (older setups)
  jiggered version
`

// runCLI runs a subcommand if args name one. handled is false when there is
// nothing to do and the server should start.
func runCLI(args []string, in io.Reader, out, errw io.Writer) (handled bool, err error) {
	if len(args) == 0 {
		return false, nil
	}
	switch args[0] {
	case "hash":
		return true, cmdHash(args[1:], in, out)
	case "backup":
		return true, cmdBackup(args[1:], out, errw)
	case "restore":
		return true, cmdRestore(args[1:], out, errw)
	case "healthcheck":
		return true, cmdHealthcheck()
	case "user":
		return true, cmdUser(args[1:], out)
	case "settings":
		return true, cmdSettings(args[1:], out)
	case "version", "--version", "-v":
		fmt.Fprintln(out, version)
		return true, nil
	case "help", "--help", "-h":
		fmt.Fprint(out, usage)
		return true, nil
	}
	return true, fmt.Errorf("unknown command %q\n\n%s", args[0], usage)
}

// cmdHash prints a bcrypt hash for APP_PASSWORD_HASH. The password comes from
// the argument or, failing that, from stdin.
func cmdHash(args []string, in io.Reader, out io.Writer) error {
	var pw string
	if len(args) > 0 {
		pw = args[0]
	} else {
		b, _ := io.ReadAll(io.LimitReader(in, 1024))
		pw = strings.TrimRight(string(b), "\r\n")
	}
	if err := checkPassword(pw, ""); err != nil {
		return err
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	if err != nil {
		return err
	}
	fmt.Fprintln(out, string(h))
	return nil
}

const defaultDB = "/data/jiggered.db"

// cmdBackup saves a consistent snapshot. Copying jiggered.db by itself is not a
// backup: while the server runs, recent writes sit in the -wal file beside it.
func archiveCLIArgs(args []string, restore bool) (dest, password string, confirmed bool, err error) {
	var passwordFile string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--password-file":
			if passwordFile != "" || i+1 >= len(args) {
				err = errors.New("Use --password-file PATH once.")
				return
			}
			i++
			passwordFile = args[i]
		case "--yes":
			if !restore || confirmed {
				err = errors.New("--yes is only used once for restore.")
				return
			}
			confirmed = true
		default:
			if dest != "" || strings.HasPrefix(args[i], "--") {
				err = errors.New("usage: provide one backup destination or restore source.")
				return
			}
			dest = args[i]
			if dest == "" || dest == ":memory:" || strings.HasPrefix(dest, "file:") {
				err = errors.New("Provide a real backup file path.")
				return
			}
		}
	}
	if restore && dest == "" {
		err = errors.New("usage: jiggered restore FILE [--password-file PATH] --yes")
		return
	}
	if passwordFile != "" {
		var f *os.File
		f, err = os.Open(passwordFile)
		if err != nil {
			return
		}
		defer f.Close()
		var value []byte
		value, err = io.ReadAll(io.LimitReader(f, 1027))
		if err != nil {
			return
		}
		password = strings.TrimSuffix(strings.TrimSuffix(string(value), "\n"), "\r")
		if password == "" {
			err = errors.New("The encryption password file is empty.")
			return
		}
		err = validateBackupPassword(password)
	}
	return
}
func cmdBackup(args []string, out, errw io.Writer) error {
	dest, password, _, err := archiveCLIArgs(args, false)
	if err != nil {
		return err
	}
	dbPath := envOr("APP_DB", defaultDB)
	if _, err := os.Stat(dbPath); err != nil {
		return fmt.Errorf("no database at %s (is APP_DB set?): %w", dbPath, err)
	}
	db, err := openRaw(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()
	if dest == "" {
		dest = filepath.Join(backupDir(dbPath), "jiggered-"+time.Now().Format("20060102-150405")+backupExtension(password))
	}
	if dest == "-" {
		if f, ok := out.(*os.File); ok {
			if st, e := f.Stat(); e == nil && st.Mode()&os.ModeCharDevice != 0 {
				return errors.New("refusing to write a backup to the terminal; redirect stdout to a file")
			}
		}
	}
	if dest != "-" {
		if _, err := os.Stat(dest); err == nil {
			return fmt.Errorf("%s already exists", dest)
		}
	}
	snapshot, err := snapshotToTemp(db, dbPath)
	if err != nil {
		return err
	}
	defer os.Remove(snapshot)
	archive, err := archiveBackup(snapshot, password)
	if err != nil {
		return err
	}
	defer os.Remove(archive)
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	if dest == "-" {
		_, err = io.Copy(out, f)
		return err
	}
	target, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(target, f)
	if closeErr := target.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(dest)
		return err
	}
	fmt.Fprintf(errw, "saved a consistent ZIP backup to %s\n", dest)
	return nil
}

// checkBackup says whether path is a sound Jiggered database that this version can use. It opens the
// file read-only and immutable so the person's backup is never touched, not even by a -wal file.
func checkBackup(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("can't read %s: %w", path, err)
	}
	db, err := sql.Open("sqlite", sqliteURI(path)+"?mode=ro&immutable=1")
	if err != nil {
		return err
	}
	defer db.Close()
	var verdict string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&verdict); err != nil {
		return fmt.Errorf("%s isn't a Jiggered database: %w", path, err)
	}
	if verdict != "ok" {
		return fmt.Errorf("%s is damaged (%s)", path, verdict)
	}
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > len(migrations) {
		return fmt.Errorf("%s comes from a newer Jiggered (schema v%d, this one knows v%d); restore it with that version", path, version, len(migrations))
	}
	// Each migration only adds to what the one before left, so a database at version v must have all of these. A
	// file missing one would restore "successfully" and then fail to start.
	need := []string{"docs", "sessions"}
	if version >= 2 {
		need = append(need, "users", "audit_log")
	}
	if version >= 3 {
		need = append(need, "instance_settings")
	}
	if version >= 4 {
		need = append(need, "doc_revs")
	}
	if version >= 5 {
		need = append(need, "account_security", "recovery_codes", "auth_tokens", "login_challenges", "remote_backup_runs")
	}
	if version >= 6 {
		need = append(need, "account_mail_deliveries", "usage_consent", "product_usage")
	}
	for _, name := range need {
		var n int
		if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?", name).Scan(&n); err != nil || n == 0 {
			if name == "docs" {
				return fmt.Errorf("%s isn't a Jiggered database (it has no docs table)", path)
			}
			return fmt.Errorf("%s isn't a usable Jiggered database (schema v%d, but it has no %s table)", path, version, name)
		}
	}
	var extra int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type IN ('trigger', 'view') OR sql LIKE 'CREATE VIRTUAL%'").Scan(&extra); err != nil || extra > 0 {
		return fmt.Errorf("%s has triggers, views or virtual tables, which a Jiggered backup never has", path)
	}
	return nil
}

// cmdRestore puts a backup in place of the database. Stop the server first. Whatever is there now is kept
// in the backups folder, so a restore can itself be undone.
func cmdRestore(args []string, out, errw io.Writer) error {
	original, password, confirmed, err := archiveCLIArgs(args, true)
	if err != nil {
		return err
	}
	dst := envOr("APP_DB", defaultDB)
	src, cleanup, err := unpackBackup(original, password, backupDir(dst))
	if err != nil {
		return err
	}
	defer cleanup()
	if err := checkBackup(src); err != nil {
		return err
	}
	if !confirmed {
		return fmt.Errorf("%s is a sound backup. This would replace the database at %s. Stop the server first, then run this again with --yes", original, dst)
	}
	if real, err := filepath.EvalSymlinks(dst); err == nil {
		dst = real // a symlinked APP_DB: replace what it points at, not the link
	}
	if st, err := os.Stat(src); err == nil && st.IsDir() {
		return fmt.Errorf("%s is a folder, not a backup file", src)
	}
	if st, err := os.Stat(src + "-wal"); err == nil && st.Size() > 0 {
		return fmt.Errorf("%s has a -wal file beside it holding recent changes that a restore would silently drop; make backups with `jiggered backup`, or copy the -wal and -shm files too and open the copy once first", src)
	}
	if _, err := os.Stat(dst); err == nil {
		if err := refuseIfInUse(dst); err != nil {
			return err
		}
		if err := os.MkdirAll(backupDir(dst), 0o700); err != nil {
			return err
		}
		stamp := time.Now().Format("20060102-150405")
		kept := filepath.Join(backupDir(dst), "pre-restore-"+stamp+".db")
		db, err := openRaw(dst)
		if err == nil {
			err = snapshot(db, kept)
			db.Close()
		}
		if err != nil {
			// Most likely the database is damaged, which is the main reason to restore: a clean copy can't be made,
			// so keep the files themselves.
			kept = filepath.Join(backupDir(dst), "pre-restore-damaged-"+stamp+".db")
			if rerr := os.Rename(dst, kept); rerr != nil {
				return fmt.Errorf("keeping the current database before replacing it: %w", err)
			}
			os.Rename(dst+"-wal", kept+"-wal")
			os.Rename(dst+"-shm", kept+"-shm")
		}
		fmt.Fprintf(errw, "kept the current database in %s\n", kept)
	}
	// Copy next to the target and rename into place, so an interruption can't leave half a database,
	// and drop the old -wal and -shm files: they belong to the database being replaced.
	tmp := dst + ".restoring"
	if err := copyFile(src, tmp); err != nil {
		os.Remove(tmp)
		return err
	}
	// Sign-ins belong to the moment the backup was taken: a session revoked since then would come back to life.
	// Everyone signs in again; passwords, roles and disabled accounts are as they were in the backup.
	if err := clearSessions(tmp); err != nil {
		os.Remove(tmp)
		os.Remove(tmp + "-wal")
		os.Remove(tmp + "-shm")
		return fmt.Errorf("preparing the restored copy: %w", err)
	}
	os.Remove(dst + "-wal")
	os.Remove(dst + "-shm")
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return err
	}
	fmt.Fprintf(out, "Restored %s from %s. Start the server again.\n", dst, src)
	return nil
}

// clearSessions ends every sign-in recorded in the database file at path.
func clearSessions(path string) error {
	db, err := openRaw(path)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err := db.Exec("DELETE FROM sessions"); err != nil {
		return err
	}
	var schema int
	if err = db.QueryRow("PRAGMA user_version").Scan(&schema); err != nil {
		return err
	}
	if schema >= 5 {
		for _, q := range []string{"DELETE FROM auth_tokens", "DELETE FROM login_challenges", "UPDATE account_security SET pending_secret='',pending_until=0"} {
			if _, err = db.Exec(q); err != nil {
				return err
			}
		}
	}
	if schema >= 6 {
		if _, err = db.Exec("DELETE FROM account_mail_deliveries"); err != nil {
			return err
		}
	}
	_, err = db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}

// refuseIfInUse stops a restore while the server (or anything else) has the database open: the server would carry
// on with the old file, unlinked, accept writes into it, and lose them at its next start. Leaving WAL mode needs
// the database to itself, so it fails at once if anything else holds it.
func refuseIfInUse(path string) error {
	db, err := sql.Open("sqlite", sqliteURI(path)+"?_pragma=busy_timeout(0)")
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var mode string
	if err := db.QueryRow("PRAGMA journal_mode=DELETE").Scan(&mode); err != nil {
		if strings.Contains(err.Error(), "locked") || strings.Contains(err.Error(), "busy") {
			return errors.New("the database is in use: Jiggered seems to be running. Stop it first (docker compose stop jiggered), then restore")
		}
		return nil // damaged or unreadable: it can't be in healthy use, and a restore is what is wanted
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, in); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// cmdHealthcheck is what the container's HEALTHCHECK runs: the image has no shell or curl.
func cmdHealthcheck() error {
	host, port, err := net.SplitHostPort(envOr("APP_ADDR", ":8080"))
	if err != nil {
		return err
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz answered %s", resp.Status)
	}
	return nil
}

// openExistingDB loads the configuration and opens the database a command-line tool works on. It never creates one:
// a missing file usually means APP_DB points somewhere else.
func openExistingDB() (config, *sql.DB, error) {
	cfg, err := loadConfig()
	if err != nil {
		return cfg, nil, err
	}
	if _, err := os.Stat(cfg.dbPath); err != nil {
		return cfg, nil, fmt.Errorf("no database at %s (is APP_DB set?): %w", cfg.dbPath, err)
	}
	db, err := openDB(cfg.dbPath, cfg.seedForOpen())
	if err != nil {
		return cfg, nil, cfg.explainOpen(err)
	}
	return cfg, db, nil
}

// cmdSettings shows or changes the instance settings. A running server notices within a couple of seconds.
func cmdSettings(args []string, out io.Writer) error {
	if len(args) == 1 && args[0] == "list" { // the same as no argument, spelled like "user list"
		args = nil
	}
	if len(args) != 0 && !(len(args) == 3 && args[0] == "set") {
		return errors.New("usage: jiggered settings | jiggered settings set KEY VALUE")
	}
	cfg, db, err := openExistingDB()
	if err != nil {
		return err
	}
	defer db.Close()
	s := &server{cfg: cfg, db: db}
	ctx := context.Background()
	if len(args) == 3 {
		before, _, err := s.storedSettings(ctx)
		if err != nil {
			return err
		}
		canon, err := s.setSetting(ctx, args[1], args[2])
		if err != nil {
			return err
		}
		s.audit(ctx, "cli", "settings_changed", "", fmt.Sprintf("%s: %s -> %s", args[1], before[args[1]], canon), "")
		fmt.Fprintf(out, "%s is now %s. A running server picks it up within a couple of seconds.\n", args[1], canon)
		return nil
	}
	values, explicit, err := s.storedSettings(ctx)
	if err != nil {
		return err
	}
	tw := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	for _, k := range settingKeys {
		note := "(default)"
		if explicit[k] {
			note = ""
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\n", k, values[k], note)
	}
	return tw.Flush()
}

func cmdUser(args []string, out io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: jiggered user list|add|reset-password|reset-two-factor|disable|enable|promote|demote|delete\n\n%s", usage)
	}
	cfg, db, err := openExistingDB()
	if err != nil {
		return err
	}
	defer db.Close()
	s := &server{cfg: cfg, db: db, hashSem: make(chan struct{}, maxHashing)}
	return s.runUserCommand(context.Background(), args, out)
}

func (s *server) runUserCommand(ctx context.Context, args []string, out io.Writer) error {
	cmd, rest := args[0], args[1:]
	if cmd == "list" {
		return s.listUsersCommand(ctx, out)
	}

	if len(rest) < 1 {
		return fmt.Errorf("usage: jiggered user %s <username>", cmd)
	}
	name, flags := normUsername(rest[0]), rest[1:]

	if cmd == "add" {
		return s.addUserCommand(ctx, name, flags, out)
	}

	t, err := s.userByName(ctx, name)
	if errors.Is(err, errNoUser) {
		return fmt.Errorf("no user called %q", name)
	}
	if err != nil {
		return err
	}
	return s.changeUserCommand(ctx, cmd, t, flags, out)
}

// listUsersCommand prints one row per account.
func (s *server) listUsersCommand(ctx context.Context, out io.Writer) error {
	users, err := s.listUsers(ctx)
	if err != nil {
		return err
	}
	tw := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "ID\tUSERNAME\tROLE\tSTATUS\tLAST SIGN-IN\tENTRIES")
	for _, u := range users {
		status, last := "active", "never"
		if u.Disabled {
			status = "disabled"
		} else if u.MustChange {
			status = "must change password"
		}
		if u.LastLogin > 0 {
			last = time.Unix(u.LastLogin, 0).Format("2006-01-02 15:04")
		}
		fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%d\n", u.ID, u.Username, u.Role, status, last, u.Docs)
	}
	return tw.Flush()
}

// addUserCommand creates an account with a temporary password the person changes at first sign-in.
func (s *server) addUserCommand(ctx context.Context, name string, flags []string, out io.Writer) error {
	if reservedUsernames[name] {
		return fmt.Errorf("%q is reserved (the activity log uses it for the app and the command line); choose another name", name)
	}
	if !validUsername(name) {
		return errors.New("usernames use letters, digits and . _ @ + - (up to 64 characters)")
	}
	role := roleUser
	if slices.Contains(flags, "--admin") {
		role = roleAdmin
	}
	pw, err := tempPassword()
	if err != nil {
		return err
	}
	hash, err := s.hashPassword(pw)
	if err != nil {
		return err
	}
	if _, err := s.createUser(ctx, name, hash, role, true); err != nil {
		if errors.Is(err, errUserExists) {
			return fmt.Errorf("user %q already exists", name)
		}
		return err
	}
	s.audit(ctx, "cli", "user_created", name, role, "")
	fmt.Fprintf(out, "Created %s %q.\nTemporary password: %s\nThey choose a new one the first time they sign in.\n", role, name, pw)
	return nil
}

// changeUserCommand applies one of the commands that act on an existing account.
func (s *server) changeUserCommand(ctx context.Context, cmd string, t *user, flags []string, out io.Writer) error {
	var err error
	note := func(err error) error {
		if errors.Is(err, errLastAdmin) {
			return errors.New("that would leave no active admin; make someone else an admin first")
		}
		return err
	}
	switch cmd {
	case "reset-two-factor":
		err = s.withUserTx(ctx, t.ID, func(tx *sql.Tx, _ *user) error {
			for _, q := range []string{`UPDATE account_security SET secret='',enabled=0,last_step=-1,pending_secret='',pending_until=0 WHERE user_id=?`, `DELETE FROM recovery_codes WHERE user_id=?`, `DELETE FROM login_challenges WHERE user_id=?`, `DELETE FROM sessions WHERE user_id=?`} {
				if _, err := tx.ExecContext(ctx, q, t.ID); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		s.audit(ctx, "cli", "two_factor_admin_reset", t.Username, "all sessions revoked", "")
		fmt.Fprintf(out, "Two-step verification reset for %s. All devices were signed out.\n", t.Username)
		return nil
	case "reset-password":
		pw, err := tempPassword()
		if err != nil {
			return err
		}
		hash, err := s.hashPassword(pw)
		if err != nil {
			return err
		}
		if err := s.setPassword(ctx, t.ID, hash, true, ""); err != nil {
			return err
		}
		s.audit(ctx, "cli", "password_reset", t.Username, "signed out everywhere", "")
		fmt.Fprintf(out, "New temporary password for %q: %s\nThey were signed out everywhere and choose a new password at next sign-in.\nIf wrong guesses had locked them out, restart the server too (docker compose restart jiggered); lockouts live in its memory.\n", t.Username, pw)
	case "disable":
		if err := note(s.setDisabled(ctx, t.ID, true)); err != nil {
			return err
		}
		s.audit(ctx, "cli", "user_disabled", t.Username, "", "")
		fmt.Fprintf(out, "Disabled %q and ended their sessions.\n", t.Username)
	case "enable":
		if err := s.setDisabled(ctx, t.ID, false); err != nil {
			return err
		}
		s.audit(ctx, "cli", "user_enabled", t.Username, "", "")
		fmt.Fprintf(out, "Enabled %q.\n", t.Username)
	case "promote", "demote":
		role := map[string]string{"promote": roleAdmin, "demote": roleUser}[cmd]
		if err := note(s.setRole(ctx, t.ID, role)); err != nil {
			return err
		}
		s.audit(ctx, "cli", "role_changed", t.Username, t.Role+" -> "+role, "")
		fmt.Fprintf(out, "%q is now %s.\n", t.Username, role)
	case "delete":
		if !slices.Contains(flags, "--yes") {
			return fmt.Errorf("this deletes %q and everything they logged; add --yes to go ahead", t.Username)
		}
		if err := note(s.deleteUser(ctx, t.ID)); err != nil {
			return err
		}
		s.audit(ctx, "cli", "user_deleted", t.Username, "account and all its data", "")
		fmt.Fprintf(out, "Deleted %q and all their data.\n", t.Username)
	default:
		return fmt.Errorf("unknown user command %q\n\n%s", cmd, usage)
	}
	return nil
}
