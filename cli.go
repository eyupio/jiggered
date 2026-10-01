package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"slices"
	"strings"
	"text/tabwriter"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const usage = `Jiggered ` + "(no arguments runs the server)" + `

  jiggered hash [password]             print a bcrypt hash for APP_PASSWORD_HASH
  jiggered backup <file>|-             save a consistent copy of the database ("-" writes it to stdout)
  jiggered healthcheck                 exit 0 if the running server answers /healthz
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
	case "healthcheck":
		return true, cmdHealthcheck()
	case "user":
		return true, cmdUser(args[1:], out)
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
	if len(args) != 1 {
		return errors.New("usage: jiggered backup <file>|-")
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

	if args[0] != "-" {
		if _, err := os.Stat(args[0]); err == nil {
			return fmt.Errorf("%s already exists", args[0])
		}
		if err := snapshot(db, args[0]); err != nil {
			return err
		}
		fmt.Fprintf(errw, "saved a consistent copy of the database to %s\n", args[0])
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
	_, err = io.Copy(out, f)
	return err
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
