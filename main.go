// Jiggered: a small self-hosted tracker for daily energy check-ins and
// symptom episodes. Password login and SQLite storage. Several people can
// each have an account; an admin manages the accounts but never sees what
// anyone has logged.
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

//go:embed web
var webFS embed.FS

// version is stamped in at build time: -ldflags "-X main.version=...".
var version = "dev"

const (
	cookieName  = "jiggered_session"
	sessionTTL  = 30 * 24 * time.Hour
	maxBodySize = 256 << 10
)

type config struct {
	addr         string
	dbPath       string
	username     string // first admin; only used while no accounts exist
	passwordHash []byte // bcrypt; same
	secureCookie bool
	trustProxy   bool
	proxyHops    int
}

type server struct {
	cfg       config
	db        *sql.DB
	ipLimit   *loginLimiter // failed sign-ins per client address
	userLimit *loginLimiter // failed sign-ins per account, from anywhere
	hashSem   chan struct{}
	dummyHash []byte // compared against when the username doesn't exist
	backupMu  sync.Mutex
}

func main() {
	if handled, err := runCLI(os.Args[1:], os.Stdin, os.Stdout, os.Stderr); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	seed, err := cfg.seed()
	if err != nil {
		log.Fatal(err)
	}
	db, err := openDB(cfg.dbPath, seed)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	s, err := newServer(cfg, db)
	if err != nil {
		log.Fatal(err)
	}
	if err := s.ensureFirstAdmin(context.Background()); err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go s.maintain()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("jiggered %s listening on %s", version, cfg.addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func newServer(cfg config, db *sql.DB) (*server, error) {
	dummy, err := bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcryptCost)
	if err != nil {
		return nil, err
	}
	return &server{
		cfg:       cfg,
		db:        db,
		ipLimit:   newLoginLimiter(10, 15*time.Minute),
		userLimit: newLoginLimiter(10, 15*time.Minute),
		hashSem:   make(chan struct{}, maxHashing),
		dummyHash: dummy,
	}, nil
}

// ensureFirstAdmin creates the first account from the environment when there are none yet.
// (Databases from before accounts existed get theirs during the upgrade, see migrateAccounts.)
func (s *server) ensureFirstAdmin(ctx context.Context) error {
	n, err := s.userCount(ctx)
	if err != nil || n > 0 {
		return err
	}
	seed, err := s.cfg.seed()
	if err != nil {
		return err
	}
	if seed == nil {
		return errors.New("no accounts exist yet: set APP_PASSWORD_HASH (recommended) or APP_PASSWORD to create the first admin")
	}
	if _, err := s.createUser(ctx, seed.name, seed.hash, roleAdmin, false); err != nil {
		return err
	}
	s.audit(ctx, "system", "admin_created", seed.name, "from APP_USERNAME", "")
	log.Printf("created the first admin %q", seed.name)
	return nil
}

// maintain tidies up in the background: expired sessions, old audit entries, stale limiter keys.
func (s *server) maintain() {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		s.prune()
		s.ipLimit.sweep()
		s.userLimit.sweep()
		<-t.C
	}
}

func loadConfig() (config, error) {
	cfg := config{
		addr:         envOr("APP_ADDR", ":8080"),
		dbPath:       envOr("APP_DB", defaultDB),
		username:     envOr("APP_USERNAME", "paul"),
		secureCookie: os.Getenv("APP_SECURE_COOKIE") != "false",
		trustProxy:   os.Getenv("APP_TRUST_PROXY") == "true",
		proxyHops:    1,
	}
	if v := os.Getenv("APP_PROXY_HOPS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 10 {
			return cfg, errors.New("APP_PROXY_HOPS must be a number from 1 to 10")
		}
		cfg.proxyHops = n
	}
	// The password is only needed to create the first admin, so it is optional here.
	switch {
	case os.Getenv("APP_PASSWORD_HASH") != "":
		cfg.passwordHash = []byte(os.Getenv("APP_PASSWORD_HASH"))
		if _, err := bcrypt.Cost(cfg.passwordHash); err != nil {
			return cfg, fmt.Errorf("APP_PASSWORD_HASH is not a valid bcrypt hash: %w", err)
		}
	case os.Getenv("APP_PASSWORD") != "":
		pw := os.Getenv("APP_PASSWORD")
		if err := checkPassword(pw, ""); err != nil {
			return cfg, fmt.Errorf("APP_PASSWORD: %w", err)
		}
		h, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
		if err != nil {
			return cfg, err
		}
		cfg.passwordHash = h
	}
	return cfg, nil
}

// seed is the first admin described by the environment, or nil if no password was given.
func (c config) seed() (*seedAdmin, error) {
	if c.passwordHash == nil {
		return nil, nil
	}
	name := normUsername(c.username)
	if !validUsername(name) {
		return nil, fmt.Errorf("APP_USERNAME %q is not a valid username (letters, digits and . _ @ + -, up to 64 characters)", c.username)
	}
	return &seedAdmin{name: name, hash: string(c.passwordHash)}, nil
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// Files the sign-in page and the home-screen icon need before anyone is signed in.
var publicAssets = []string{"/manifest.webmanifest", "/icon.svg", "/style.css", "/login.js", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/favicon.ico", "/sw.js"}

func (s *server) routes() http.Handler {
	static, _ := fs.Sub(webFS, "web")
	files := newStatic(static)
	mux := http.NewServeMux()
	auth := func(h http.HandlerFunc) http.Handler { return s.requireAuth(h) }
	admin := func(h http.HandlerFunc) http.Handler { return s.requireAdmin(h) }

	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		if s.lookup(r) != nil {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		serveFile(w, r, static, "login.html")
	})
	mux.HandleFunc("POST /login", s.handleLogin)
	mux.HandleFunc("POST /logout", s.handleLogout)

	for _, p := range publicAssets {
		mux.Handle("GET "+p, files)
	}
	mux.Handle("GET /fonts/", files)

	mux.Handle("GET /api/me", auth(s.handleMe))
	mux.Handle("DELETE /api/me", auth(s.deleteSelf))
	mux.Handle("POST /api/me/password", auth(s.handleChangePassword))
	mux.Handle("GET /api/me/sessions", auth(s.listSessions))
	mux.Handle("POST /api/me/sessions/revoke-others", auth(s.revokeOtherSessions))
	mux.Handle("POST /api/me/sessions/revoke-all", auth(s.revokeAllSessions))
	mux.Handle("DELETE /api/me/sessions/{sid}", auth(s.revokeSession))

	mux.Handle("GET /api/docs", auth(s.listDocs))
	mux.Handle("PUT /api/docs/{id}", auth(s.putDoc))
	mux.Handle("DELETE /api/docs/{id}", auth(s.deleteDoc))
	mux.Handle("GET /api/export", auth(s.exportDocs))
	mux.Handle("POST /api/import", auth(s.importDocs))

	mux.Handle("GET /api/admin/users", admin(s.adminListUsers))
	mux.Handle("POST /api/admin/users", admin(s.adminCreateUser))
	mux.Handle("PATCH /api/admin/users/{id}", admin(s.adminUpdateUser))
	mux.Handle("DELETE /api/admin/users/{id}", admin(s.adminDeleteUser))
	mux.Handle("POST /api/admin/users/{id}/reset-password", admin(s.adminResetPassword))
	mux.Handle("POST /api/admin/users/{id}/revoke-sessions", admin(s.adminRevokeSessions))
	mux.Handle("GET /api/admin/audit", admin(s.adminAudit))
	mux.Handle("POST /api/admin/backup", admin(s.adminBackup))

	mux.Handle("GET /", auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			files.ServeHTTP(w, r)
			return
		}
		serveFile(w, r, static, "index.html")
	}))

	return securityHeaders(rejectCrossSite(mux))
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ok"))
}

func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) {
	b, err := fs.ReadFile(fsys, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

// static serves the embedded web files. Each gets an ETag and no-cache, so
// browsers revalidate (a cheap 304) instead of running a stale copy after an upgrade.
type static struct {
	files http.Handler
	etags map[string]string
}

func newStatic(fsys fs.FS) *static {
	st := &static{files: http.FileServer(http.FS(fsys)), etags: map[string]string{}}
	fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if b, err := fs.ReadFile(fsys, p); err == nil {
			sum := sha256.Sum256(b)
			st.etags["/"+p] = `"` + hex.EncodeToString(sum[:8]) + `"`
		}
		return nil
	})
	return st
}

func (st *static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/") && r.URL.Path != "/" {
		http.NotFound(w, r) // no directory listings
		return
	}
	if e, ok := st.etags[r.URL.Path]; ok {
		w.Header().Set("ETag", e)
	}
	w.Header().Set("Cache-Control", "no-cache")
	st.files.ServeHTTP(w, r)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
		next.ServeHTTP(w, r)
	})
}

// rejectCrossSite refuses state-changing requests that a browser says came from
// another site. SameSite cookies don't stop "login CSRF" (an attacker signing
// you in to their account so what you log lands there), and now that accounts
// differ, that matters. Browsers that don't send the header are covered by the
// SameSite cookie and the X-Requested-With check on the API.
func rejectCrossSite(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			if v := r.Header.Get("Sec-Fetch-Site"); v != "" && v != "same-origin" && v != "none" {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// jsonError sends a message the page can show to the person.
func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// readJSON decodes a small request body, rejecting unknown fields.
func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		jsonError(w, http.StatusBadRequest, "That request wasn't understood.")
		return false
	}
	return true
}
