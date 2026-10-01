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

  jiggered hash [password]             print a bcrypt hash for APP_PASSWORD_HASH
  jiggered backup [file|-]             save a consistent copy of the database (no argument: into the data volume's backups folder; "-" writes it to stdout)
  jiggered restore <file> --yes        put a backup in place of the database (stop the server first; what was there is kept)
  jiggered healthcheck                 exit 0 if the running server answers /healthz
  jiggered settings                    show the instance settings (they live in the database)
  jiggered settings set KEY VALUE      change one: secure_cookie, trust_proxy, proxy_hops
  jiggered version

Accounts (work on the database directly, so they still work if you are locked out of the web UI):

  jiggered user list
  jiggered user add <name> [--admin]   create an account with a one-time temporary password
  jiggered user reset-password <name>  new temporary password, signs the account out everywhere
  jiggered user disable <name>         block sign-in and end its sessions
  jiggered user enable <name>
  jiggered user promote <name>         make an admin
  jiggered user demote <name>
  jiggered user delete <name> --yes    delete the account and all its data
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
func cmdBackup(args []string, out, errw io.Writer) error {
	if len(args) > 1 || (len(args) == 1 && args[0] != "-" && strings.HasPrefix(args[0], "-")) {
		return errors.New("usage: jiggered backup [file|-]")
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

	dest := ""
	if len(args) == 1 {
		dest = args[0]
	} else {
		if err := os.MkdirAll(backupDir(dbPath), 0o700); err != nil {
			return err
		}
		dest = filepath.Join(backupDir(dbPath), "jiggered-"+time.Now().Format("20060102-150405")+".db")
	}
	if dest != "-" {
		if _, err := os.Stat(dest); err == nil {
			return fmt.Errorf("%s already exists", dest)
		}
		if err := snapshot(db, dest); err != nil {
			return err
		}
		fmt.Fprintf(errw, "saved a consistent copy of the database to %s\n", dest)
		return nil
	}
	if f, ok := out.(*os.File); ok {
		if st, err := f.Stat(); err == nil && st.Mode()&os.ModeCharDevice != 0 {
			return errors.New("refusing to write a database to the terminal; redirect stdout to a file")
		}
	}
	tmp, err := snapshotToTemp(db, dbPath)
	if err != nil {
		return err
	}
	defer os.Remove(tmp)
	f, err := os.Open(tmp)
	if err != nil {
		return err
	}
	defer f.Close()
	os.Remove(tmp) // a closed pipe (| head) must not leave a whole copy behind
	_, err = io.Copy(out, f)
	return err
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
	var version, tables int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > len(migrations) {
		return fmt.Errorf("%s comes from a newer Jiggered (schema v%d, this one knows v%d); restore it with that version", path, version, len(migrations))
	}
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'docs'").Scan(&tables); err != nil || tables == 0 {
		return fmt.Errorf("%s isn't a Jiggered database (it has no docs table)", path)
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
	if len(args) < 1 || len(args) > 2 || (len(args) == 2 && args[1] != "--yes") {
		return errors.New("usage: jiggered restore <backup file> --yes")
	}
	src, dst := args[0], envOr("APP_DB", defaultDB)
	if err := checkBackup(src); err != nil {
		return err
	}
	if len(args) != 2 {
		return fmt.Errorf("%s is a sound backup. This would replace the database at %s. Stop the server first, then run this again with --yes", src, dst)
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
	os.Remove(dst + "-wal")
	os.Remove(dst + "-shm")
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return err
	}
	fmt.Fprintf(out, "Restored %s from %s. Start the server again.\n", dst, src)
	return nil
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

// cmdSettings shows or changes the instance settings. A running server notices within a couple of seconds.
func cmdSettings(args []string, out io.Writer) error {
	if len(args) != 0 && !(len(args) == 3 && args[0] == "set") {
		return errors.New("usage: jiggered settings | jiggered settings set KEY VALUE")
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	if _, err := os.Stat(cfg.dbPath); err != nil {
		return fmt.Errorf("no database at %s (is APP_DB set?): %w", cfg.dbPath, err)
	}
	seed, err := cfg.seed()
	if err != nil {
		return err
	}
	db, err := openDB(cfg.dbPath, seed)
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
		return fmt.Errorf("usage: jiggered user list|add|reset-password|disable|enable|promote|demote|delete\n\n%s", usage)
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	if _, err := os.Stat(cfg.dbPath); err != nil {
		return fmt.Errorf("no database at %s (is APP_DB set?): %w", cfg.dbPath, err)
	}
	seed, err := cfg.seed()
	if err != nil {
		return err
	}
	db, err := openDB(cfg.dbPath, seed)
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

	if len(rest) < 1 {
		return fmt.Errorf("usage: jiggered user %s <username>", cmd)
	}
	name, flags := normUsername(rest[0]), rest[1:]

	if cmd == "add" {
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

	t, err := s.userByName(ctx, name)
	if errors.Is(err, errNoUser) {
		return fmt.Errorf("no user called %q", name)
	}
	if err != nil {
		return err
	}
	note := func(err error) error {
		if errors.Is(err, errLastAdmin) {
			return errors.New("that would leave no active admin; make someone else an admin first")
		}
		return err
	}
	switch cmd {
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
		fmt.Fprintf(out, "New temporary password for %q: %s\nThey were signed out everywhere and choose a new password at next sign-in.\n", t.Username, pw)
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
