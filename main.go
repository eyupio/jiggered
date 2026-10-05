// Jiggered: a small self-hosted tracker for daily energy check-ins and
// symptom episodes. Password login and SQLite storage. Several people can
// each have a separate account. Admin APIs expose account metadata; admins
// can reset passwords and download backups containing everyone's logs.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"slices"
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

// config holds deployment controls: storage, listening and public-site indexing. Account/proxy variables
// are optional and only seed the database. Older versions needed a username and password here for the first
// admin, and the proxy and cookie settings; they are read once to fill in what the database doesn't have yet.
type config struct {
	publicOrigin string // trusted canonical origin for public pages; never inferred from Host
	publicIndex  bool   // explicit opt-in for the official production site
	addr         string
	dbPath       string
	username     string            // seed: the first admin, while there are no accounts
	passwordHash []byte            // seed: bcrypt
	seeds        map[string]string // seed: instance settings, from APP_SECURE_COOKIE, APP_TRUST_PROXY, APP_PROXY_HOPS
	credErr      error             // what is wrong with APP_PASSWORD(_HASH), if anything: only matters while there are no accounts
}

type server struct {
	publicLimit   *loginLimiter
	recoveryLimit *loginLimiter
	cfg           config
	db            *sql.DB
	ipLimit       *loginLimiter // failed sign-ins per client address
	userLimit     *loginLimiter // failed sign-ins per account, from anywhere
	hashSem       chan struct{}
	dummyHash     []byte // compared against when the username doesn't exist
	backupMu      sync.Mutex
	cache         settingsCache
	serviceMu     sync.Mutex
	serviceJobs   sync.WaitGroup
	mailSem       chan struct{}
	serviceCtx    context.Context
	importMu      sync.Mutex
	imports       map[int64]bool
}

func main() {
	if handled, err := runCLI(os.Args[1:], os.Stdin, os.Stdout, os.Stderr); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		log.Fatal(err)
	}
}

// run opens the database, starts serving and returns once ctx is cancelled (a Ctrl-C or SIGTERM) or the
// listener fails. It only returns after in-flight requests, the scheduler and queued account mail have
// finished, so nothing is left behind — which is also what lets a test drive a whole start/stop cycle.
func run(ctx context.Context) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	db, err := openDB(cfg.dbPath, cfg.seedForOpen())
	if err != nil {
		return fmt.Errorf("open database %s: %w", cfg.dbPath, cfg.explainOpen(err))
	}
	defer db.Close()

	s, err := newServer(cfg, db)
	if err != nil {
		return err
	}
	if err := s.seedSettings(context.Background()); err != nil {
		return err
	}
	if err := s.ensureFirstAdmin(context.Background()); err != nil {
		return err
	}
	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		MaxHeaderBytes:    16 << 10,
		IdleTimeout:       120 * time.Second,
	}

	sweepTempBackups(s.cfg.dbPath)
	go s.maintain(ctx)

	s.serviceCtx = ctx
	schedulerDone := make(chan struct{})
	go func() { defer close(schedulerDone); s.serviceScheduler(ctx) }()
	ln, err := net.Listen("tcp", cfg.addr) // bind first, so "listening" is only ever said when it's true
	if err != nil {
		return err
	}
	serveErr := make(chan error, 1)
	go func() {
		log.Printf("jiggered %s listening on %s", version, ln.Addr()) // the bound address, which is not cfg.addr when it asked for any free port
		serveErr <- srv.Serve(ln)
	}()
	select {
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown did not finish cleanly: %v", err) // requests still running after 10s are cut off
		}
		<-schedulerDone
		s.serviceJobs.Wait()
		<-serveErr
	}
	return nil
}

func newServer(cfg config, db *sql.DB) (*server, error) {
	if err := (&server{cfg: cfg, db: db}).initServices(); err != nil {
		return nil, err
	}
	dummy, err := bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcryptCost)
	if err != nil {
		return nil, err
	}
	return &server{
		cfg:           cfg,
		db:            db,
		ipLimit:       newLoginLimiter(10, 15*time.Minute),
		publicLimit:   newLoginLimiter(10, 15*time.Minute),
		recoveryLimit: newLoginLimiter(3, 15*time.Minute),
		userLimit:     newLoginLimiter(10, 15*time.Minute),
		hashSem:       make(chan struct{}, maxHashing),
		mailSem:       make(chan struct{}, 4),
		dummyHash:     dummy,
	}, nil
}

// ensureFirstAdmin creates the first account from the environment, if it was given one and there are none.
// With neither, the server still starts: the person creates the first admin from the command line.
// (Databases from before accounts existed get theirs during the upgrade, see migrateAccounts.)
func (s *server) ensureFirstAdmin(ctx context.Context) error {
	n, err := s.userCount(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		if s.cfg.passwordHash != nil {
			log.Printf("ignoring APP_USERNAME and APP_PASSWORD*: accounts already exist, and the database is the source of truth (manage people in Admin, or with `jiggered user`)")
		}
		return nil
	}
	seed, err := s.cfg.seed()
	if err != nil {
		return err
	}
	if seed == nil {
		log.Printf("no accounts yet. Create the first admin with: jiggered user add NAME --admin (in Docker: docker compose exec jiggered /jiggered user add NAME --admin)")
		return nil
	}
	if _, err := s.createUser(ctx, seed.name, seed.hash, roleAdmin, false); err != nil {
		return err
	}
	s.audit(ctx, "system", "admin_created", seed.name, "from APP_USERNAME", "")
	log.Printf("created the first admin %q from APP_USERNAME", seed.name)
	return nil
}

// maintain tidies up in the background: expired sessions, old audit entries, stale limiter keys. It stops
// with ctx, so a graceful shutdown does not leave it holding the database.
func (s *server) maintain(ctx context.Context) {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		s.prune()
		s.ipLimit.sweep()
		s.userLimit.sweep()
		s.publicLimit.sweep()
		s.recoveryLimit.sweep()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func loadConfig() (config, error) {
	cfg := config{
		addr:     envOr("APP_ADDR", ":8080"),
		dbPath:   envOr("APP_DB", defaultDB),
		username: envOr("APP_USERNAME", "paul"),
		seeds:    map[string]string{},
	}
	if err := cfg.loadPublicConfig(); err != nil {
		return cfg, err
	}
	for _, k := range settingKeys {
		v, ok := seedFromEnv(k, os.Getenv(settingEnv[k]))
		if !ok {
			continue
		}
		if _, err := parseSetting(k, v); err != nil {
			return cfg, fmt.Errorf("%s: %w", settingEnv[k], err)
		}
		cfg.seeds[k] = v
	}
	switch {
	case os.Getenv("APP_PASSWORD_HASH") != "":
		cfg.passwordHash = []byte(os.Getenv("APP_PASSWORD_HASH"))
		if _, err := bcrypt.Cost(cfg.passwordHash); err != nil {
			cfg.credErr = fmt.Errorf("APP_PASSWORD_HASH is not a valid bcrypt hash (make one with `jiggered hash 'password'`): %w", err)
		}
	case os.Getenv("APP_PASSWORD") != "":
		pw := os.Getenv("APP_PASSWORD")
		if err := checkPassword(pw, ""); err != nil {
			cfg.credErr = fmt.Errorf("APP_PASSWORD: %w", err)
		} else if h, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost); err != nil {
			return cfg, err
		} else {
			cfg.passwordHash = h
		}
	}
	return cfg, nil
}

// seed is the first admin described by the environment, or nil if no password was given.
func (c config) seed() (*seedAdmin, error) {
	if c.credErr != nil {
		return nil, c.credErr
	}
	if c.passwordHash == nil {
		return nil, nil
	}
	name := normUsername(c.username)
	if !validUsername(name) {
		return nil, fmt.Errorf("APP_USERNAME %q is not a valid username (letters, digits and . _ @ + -, up to 64 characters)", c.username)
	}
	return &seedAdmin{name: name, hash: string(c.passwordHash)}, nil
}

// seedForOpen is the first admin to hand the database in case it turns out to need one. A problem with the
// variables is not fatal on its own: they are only used while there are no accounts, so an install that has
// moved on must not be stopped by a leftover typo. (If the database does need them, openDB says so.)
func (c config) seedForOpen() *seedAdmin {
	seed, err := c.seed()
	if err != nil {
		log.Printf("ignoring the first-admin variables (%v); they are only needed to create the first account", err)
		return nil
	}
	return seed
}

// explainOpen adds what is wrong with the first-admin variables to a refusal that asks for them.
func (c config) explainOpen(err error) error {
	if _, serr := c.seed(); serr != nil && errors.Is(err, errNeedFirstAdmin) {
		return fmt.Errorf("%w (and %v)", err, serr)
	}
	return err
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// Files the sign-in page and the home-screen icon need before anyone is signed in.
var publicAssets = []string{"/manifest.webmanifest", "/icon.svg", "/style.css", "/presence.css", "/public-base.css", "/public.css", "/login.js", "/robots.txt", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/favicon.ico"}

func (s *server) routes() http.Handler {
	static, _ := fs.Sub(webFS, "web")
	files := newStatic(static)
	public := newPublicSite(s, files)
	mux := http.NewServeMux()
	auth := func(h http.HandlerFunc) http.Handler { return s.requireAuth(h) }
	admin := func(h http.HandlerFunc) http.Handler { return s.requireAdmin(h) }

	mux.HandleFunc("GET /healthz", s.handleHealth)
	loginPage := func(w http.ResponseWriter, r *http.Request) {
		if s.lookup(r) != nil {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		page, err := fs.ReadFile(static, "login.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if n, err := s.userCount(r.Context()); err == nil && n == 0 {
			// Nobody has an account yet: say how to make the first one.
			page = bytes.Replace(page, []byte(`id="setup" hidden`), []byte(`id="setup"`), 1)
		}
		serveHTML(w, r, files, files.versionPage(page))
	}
	mux.HandleFunc("GET /login", loginPage)
	mux.HandleFunc("GET /register", loginPage)
	public.routes(mux)
	mux.HandleFunc("POST /login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/options", s.publicAuthOptions)
	mux.HandleFunc("POST /api/auth/register", s.registerAccount)
	mux.HandleFunc("POST /api/auth/forgot-password", s.forgotPassword)
	mux.HandleFunc("POST /api/auth/reset-password", s.resetPasswordToken)
	mux.HandleFunc("POST /api/auth/verify", s.verifyEmailToken)
	mux.HandleFunc("POST /api/auth/two-step", s.finishTwoFactor)
	mux.HandleFunc("POST /logout", s.handleLogout)

	for _, p := range publicAssets {
		if p == "/robots.txt" {
			mux.HandleFunc("GET "+p, public.robots)
		} else {
			mux.Handle("GET "+p, files)
		}
	}
	mux.Handle("GET /fonts/", files)
	mux.Handle("GET /shots/", files) // real screenshots shown on the public pages
	mux.Handle("GET /v/{ver}/{file...}", s.versionedAsset(files))
	mux.HandleFunc("GET /sw.js", func(w http.ResponseWriter, r *http.Request) {
		b, err := fs.ReadFile(static, "sw.js")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(files.serviceWorker(b))
	})

	mux.Handle("GET /api/me", auth(s.handleMe))
	mux.Handle("GET /api/me/usage-consent", auth(s.usageConsent))
	mux.Handle("PUT /api/me/usage-consent", auth(s.usageConsent))
	mux.Handle("POST /api/me/usage", auth(s.recordUsage))
	mux.Handle("GET /api/me/security", auth(s.securityStatus))
	mux.Handle("POST /api/me/security/email", auth(s.requestRecoveryEmail))
	mux.Handle("POST /api/me/security/two-factor", auth(s.twoFactorAction))
	mux.Handle("POST /api/admin/users/{name}/two-factor-reset", admin(s.adminResetTwoFactor))
	mux.Handle("DELETE /api/me", auth(s.deleteSelf))
	mux.Handle("POST /api/me/password", auth(s.handleChangePassword))
	mux.Handle("GET /api/me/sessions", auth(s.listSessions))
	mux.Handle("POST /api/me/sessions/revoke-others", auth(s.revokeOtherSessions))
	mux.Handle("POST /api/me/sessions/revoke-all", auth(s.revokeAllSessions))
	mux.Handle("DELETE /api/me/sessions/{sid}", auth(s.revokeSession))

	mux.Handle("GET /api/defaults", auth(s.productGetDefaults))
	mux.Handle("PUT /api/admin/defaults", admin(s.productPutDefaults))
	mux.Handle("GET /api/docs", auth(s.listDocs))
	mux.Handle("PUT /api/docs/{id}", auth(s.putDoc))
	mux.Handle("DELETE /api/docs/{id}", auth(s.deleteDoc))
	mux.Handle("GET /api/export", auth(s.exportDocs))
	mux.Handle("POST /api/import", auth(s.importDocs))
	mux.Handle("POST /api/restore/preview", auth(s.restoreDocs))
	mux.Handle("POST /api/restore", auth(s.restoreDocs))

	mux.Handle("GET /api/admin/users", admin(s.adminListUsers))
	mux.Handle("POST /api/admin/users", admin(s.adminCreateUser))
	mux.Handle("PATCH /api/admin/users/{id}", admin(s.adminUpdateUser))
	mux.Handle("DELETE /api/admin/users/{id}", admin(s.adminDeleteUser))
	mux.Handle("POST /api/admin/users/{id}/reset-password", admin(s.adminResetPassword))
	mux.Handle("POST /api/admin/users/{id}/revoke-sessions", admin(s.adminRevokeSessions))
	mux.Handle("GET /api/admin/audit", admin(s.adminAudit))
	mux.Handle("GET /api/admin/settings", admin(s.adminGetSettings))
	mux.Handle("PATCH /api/admin/settings", admin(s.adminPatchSettings))
	mux.Handle("POST /api/admin/backup", admin(s.adminBackup))
	mux.Handle("GET /api/admin/usage", admin(s.adminUsage))
	mux.Handle("PUT /api/admin/usage", admin(s.adminUsage))
	mux.Handle("GET /api/admin/services", admin(s.adminGetServices))
	mux.Handle("PUT /api/admin/services", admin(s.adminSaveServices))
	mux.Handle("POST /api/admin/services/action", admin(s.adminServiceAction))

	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			if public.redirectAlias(w, r) {
				return
			}
			if !knownPrivateFile(static, r.URL.Path) {
				http.NotFound(w, r)
				return
			}
			s.requireAuth(files).ServeHTTP(w, r)
			return
		}
		if s.lookup(r) == nil {
			public.page(w, r, publicPages[0])
			return
		}
		b, err := fs.ReadFile(static, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Jiggered-App", "1") // offline cache must distinguish the app from the public home page
		serveHTML(w, r, files, files.versionPage(b))
	})

	return securityHeaders(rejectCrossSite(mux))
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	// A reachable file is not enough: with the core table gone every save would fail while this said ok.
	var n int
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM (SELECT 1 FROM docs LIMIT 1)").Scan(&n); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable) // the reason goes to the log, not to the caller
		log.Printf("healthz: %v", err)
		return
	}
	w.Write([]byte("ok"))
}

func serveHTML(w http.ResponseWriter, r *http.Request, files *static, page []byte) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Add("Vary", "Accept-Encoding")
	if acceptsGzip(r) {
		tag := pageTag(page)
		if gz := files.gz.get("page:"+tag, func() ([]byte, error) { return page, nil }); gz != nil {
			serveCompressed(w, r, "text/html; charset=utf-8", "", gz)
			return
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(page)
}

// static serves the embedded web files. Each gets an ETag and no-cache, so
// browsers revalidate (a cheap 304) instead of running a stale copy after an upgrade.
type static struct {
	files   http.Handler
	fsys    fs.FS
	etags   map[string]string
	version string // identifies this build's files; see versionPage
	gz      gzipCache
}

func newStatic(fsys fs.FS) *static {
	st := &static{files: http.FileServer(http.FS(fsys)), fsys: fsys, etags: map[string]string{}}
	all := sha256.New()
	fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if b, err := fs.ReadFile(fsys, p); err == nil {
			sum := sha256.Sum256(b)
			st.etags["/"+p] = `"` + hex.EncodeToString(sum[:8]) + `"`
			all.Write([]byte(p + "\x00"))
			all.Write(sum[:])
		}
		return nil
	})
	st.version = hex.EncodeToString(all.Sum(nil)[:6])
	return st
}

// The files a page loads, and the pages that load them, are named with this build's version
// (/v/<version>/app.js). A changed file therefore always has a new URL, so nothing between the browser and this
// server (a CDN with a four-hour default, a browser's own rules) can run an old script against a new page.
var versionedFiles = []string{"/style.css", "/presence.css", "/public-base.css", "/public.css", "/dashboard.css", "/tools.css", "/app.js", "/login.js", "/early-nav.js"}

func (st *static) versionPage(page []byte) []byte {
	for _, f := range versionedFiles {
		page = bytes.ReplaceAll(page, []byte(`"`+f+`"`), []byte(`"/v/`+st.version+f+`"`))
	}
	return page
}

// serviceWorker points the worker's list of files, and its cache, at this build's versioned URLs, so every
// release gives it new bytes and the browser installs it.
func (st *static) serviceWorker(sw []byte) []byte {
	block := regexp.MustCompile(`(?s)const SHELL = \[.*?\];`)
	sw = block.ReplaceAllFunc(sw, func(b []byte) []byte {
		return regexp.MustCompile(`"/([a-z0-9-]+\.(?:js|css))"`).ReplaceAll(b, []byte(`"/v/`+st.version+`/$1"`))
	})
	return bytes.Replace(sw, []byte(`"jiggered-app-v1"`), []byte(`"jiggered-app-`+st.version+`"`), 1)
}

// versionedAsset serves /v/<version>/<file>. Public files (what the sign-in page needs) need no sign-in; the rest
// is gated like the unversioned path. Under the current version a file never changes, so it may be kept for a
// year; under any other version (a page left open across an upgrade) it is served, but never kept.
func (s *server) versionedAsset(files *static) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		file := "/" + r.PathValue("file")
		if path.Clean(file) != file || strings.Contains(file, "..") {
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(files.fsys, strings.TrimPrefix(file, "/"))
		if err != nil || info.IsDir() || file == "/landing.html" || strings.HasPrefix(file, "/public/") {
			http.NotFound(w, r)
			return
		}
		if !slices.Contains(publicAssets, file) && file != "/login.js" && !strings.HasPrefix(file, "/fonts/") && s.lookup(r) == nil {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = file
		cc := "no-store"
		if r.PathValue("ver") == files.version {
			cc = "public, max-age=31536000, immutable"
		}
		files.serve(w, r2, cc)
	})
}

func (st *static) ServeHTTP(w http.ResponseWriter, r *http.Request) { st.serve(w, r, "no-cache") }

func (st *static) serve(w http.ResponseWriter, r *http.Request, cacheControl string) {
	// Never anything but a clean path: an encoded ".." would otherwise be resolved by the file server after the
	// router had already decided who may fetch it.
	if p := r.URL.Path; (strings.HasSuffix(p, "/") && p != "/") || (p != "/" && path.Clean(p) != p) {
		http.NotFound(w, r) // no directory listings
		return
	}
	if e, ok := st.etags[r.URL.Path]; ok {
		w.Header().Set("ETag", e)
	}
	w.Header().Set("Cache-Control", cacheControl)
	if compressibleFile(r.URL.Path) {
		w.Header().Add("Vary", "Accept-Encoding") // the answer depends on it, so nothing in between may mix the two
		if _, known := st.etags[r.URL.Path]; known && acceptsGzip(r) && (r.Method == http.MethodGet || r.Method == http.MethodHead) && r.Header.Get("Range") == "" {
			name := strings.TrimPrefix(r.URL.Path, "/")
			if gz := st.gz.get(r.URL.Path, func() ([]byte, error) { return fs.ReadFile(st.fsys, name) }); gz != nil {
				serveCompressed(w, r, contentTypeOf(name), st.etags[r.URL.Path], gz)
				return
			}
		}
	}
	if strings.HasSuffix(r.URL.Path, ".webmanifest") {
		w.Header().Set("Content-Type", "application/manifest+json")
	}
	st.files.ServeHTTP(w, r)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Robots-Tag", "noindex, nofollow") // public landing handlers opt in; personal logs stay private
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
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
// serverError answers 500 and logs why. The person gets nothing they could act on, but whoever runs the server
// gets the reason (a full disk, a damaged database) instead of silence.
func serverError(w http.ResponseWriter, r *http.Request, err error) {
	if !errors.Is(err, context.Canceled) { // the client went away; nobody to tell and nothing to fix
		log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
	}
	http.Error(w, "server error", http.StatusInternalServerError)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// readJSON decodes a small request body, rejecting unknown fields.
func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil || dec.Decode(&struct{}{}) != io.EOF { // one JSON value, nothing after it
		jsonError(w, http.StatusBadRequest, "That request wasn't understood.")
		return false
	}
	return true
}

// sweepTempBackups removes half-finished copies a killed backup left in the backups folder; they are whole copies
// of the database and nothing else ever deletes them.
func sweepTempBackups(dbPath string) {
	old, _ := filepath.Glob(filepath.Join(backupDir(dbPath), ".tmp-*"))
	for _, f := range old {
		os.Remove(f)
	}
}
