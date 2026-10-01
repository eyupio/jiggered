// Jiggered: a small self-hosted tracker for daily energy check-ins
// and symptom episodes. Single user, password login, SQLite storage.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

//go:embed web
var webFS embed.FS

const (
	cookieName  = "jiggered_session"
	sessionTTL  = 30 * 24 * time.Hour
	maxBodySize = 256 << 10
)

var docIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type config struct {
	addr         string
	dbPath       string
	username     string
	passwordHash []byte // bcrypt
	secureCookie bool
	trustProxy   bool
}

type server struct {
	cfg     config
	db      *sql.DB
	limiter *loginLimiter
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "hash" {
		hashCommand()
		return
	}
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	db, err := openDB(cfg.dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	s := &server{cfg: cfg, db: db, limiter: newLoginLimiter(5, 15*time.Minute)}
	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go s.pruneSessions()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("jiggered listening on %s", cfg.addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// hashCommand prints a bcrypt hash for APP_PASSWORD_HASH.
// Usage: jiggered hash 'your password'   (or pipe it on stdin)
func hashCommand() {
	var pw string
	if len(os.Args) > 2 {
		pw = os.Args[2]
	} else {
		b, _ := io.ReadAll(io.LimitReader(os.Stdin, 1024))
		pw = strings.TrimRight(string(b), "\r\n")
	}
	if len(pw) < 8 {
		log.Fatal("password must be at least 8 characters")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(h))
}

func loadConfig() (config, error) {
	cfg := config{
		addr:         envOr("APP_ADDR", ":8080"),
		dbPath:       envOr("APP_DB", "/data/jiggered.db"),
		username:     envOr("APP_USERNAME", "paul"),
		secureCookie: os.Getenv("APP_SECURE_COOKIE") != "false",
		trustProxy:   os.Getenv("APP_TRUST_PROXY") == "true",
	}
	switch {
	case os.Getenv("APP_PASSWORD_HASH") != "":
		cfg.passwordHash = []byte(os.Getenv("APP_PASSWORD_HASH"))
		if _, err := bcrypt.Cost(cfg.passwordHash); err != nil {
			return cfg, fmt.Errorf("APP_PASSWORD_HASH is not a valid bcrypt hash: %w", err)
		}
	case os.Getenv("APP_PASSWORD") != "":
		pw := os.Getenv("APP_PASSWORD")
		if len(pw) < 8 {
			return cfg, errors.New("APP_PASSWORD must be at least 8 characters")
		}
		h, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
		if err != nil {
			return cfg, err
		}
		cfg.passwordHash = h
	default:
		return cfg, errors.New("set APP_PASSWORD_HASH (recommended) or APP_PASSWORD")
	}
	return cfg, nil
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func openDB(path string) (*sql.DB, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	schema := `
CREATE TABLE IF NOT EXISTS docs (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);`
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return db, nil
}

func (s *server) routes() http.Handler {
	static, _ := fs.Sub(webFS, "web")
	files := http.FileServer(http.FS(static))
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		if s.authed(r) {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		serveFile(w, r, static, "login.html")
	})
	mux.HandleFunc("POST /login", s.handleLogin)
	mux.HandleFunc("POST /logout", s.handleLogout)

	// Public assets needed by the login page and home-screen icon.
	for _, p := range []string{"/manifest.webmanifest", "/icon.svg", "/style.css", "/login.js", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/favicon.ico"} {
		mux.Handle("GET "+p, files)
	}

	mux.Handle("GET /api/docs", s.requireAuth(http.HandlerFunc(s.listDocs)))
	mux.Handle("PUT /api/docs/{id}", s.requireAuth(http.HandlerFunc(s.putDoc)))
	mux.Handle("DELETE /api/docs/{id}", s.requireAuth(http.HandlerFunc(s.deleteDoc)))
	mux.Handle("GET /api/export", s.requireAuth(http.HandlerFunc(s.exportDocs)))

	mux.Handle("GET /", s.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			files.ServeHTTP(w, r)
			return
		}
		serveFile(w, r, static, "index.html")
	})))

	return securityHeaders(mux)
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

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
		next.ServeHTTP(w, r)
	})
}

// ---- auth ----

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

func (s *server) authed(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil || len(c.Value) != 64 {
		return false
	}
	var exp int64
	err = s.db.QueryRowContext(r.Context(), "SELECT expires_at FROM sessions WHERE token_hash = ?", hashToken(c.Value)).Scan(&exp)
	return err == nil && time.Now().Unix() < exp
}

func (s *server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authed(r) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.Error(w, "signed out", http.StatusUnauthorized)
				return
			}
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		// Writes must come from our own page (custom header can't be sent cross-site without CORS).
		if r.Method != http.MethodGet && r.Header.Get("X-Requested-With") != "jiggered" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) clientIP(r *http.Request) string {
	if s.cfg.trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	if !s.limiter.allow(ip) {
		http.Redirect(w, r, "/login?e=locked", http.StatusSeeOther)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/login?e=bad", http.StatusSeeOther)
		return
	}
	userOK := subtle.ConstantTimeCompare([]byte(r.PostFormValue("username")), []byte(s.cfg.username)) == 1
	pwErr := bcrypt.CompareHashAndPassword(s.cfg.passwordHash, []byte(r.PostFormValue("password")))
	if !userOK || pwErr != nil {
		s.limiter.fail(ip)
		log.Printf("failed login from %s", ip)
		http.Redirect(w, r, "/login?e=bad", http.StatusSeeOther)
		return
	}
	s.limiter.reset(ip)

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	token := hex.EncodeToString(raw)
	exp := time.Now().Add(sessionTTL)
	if _, err := s.db.ExecContext(r.Context(), "INSERT INTO sessions(token_hash, expires_at) VALUES(?, ?)", hashToken(token), exp.Unix()); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", Expires: exp,
		HttpOnly: true, Secure: s.cfg.secureCookie, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash = ?", hashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.secureCookie, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func (s *server) pruneSessions() {
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		s.db.Exec("DELETE FROM sessions WHERE expires_at < ?", time.Now().Unix())
		<-t.C
	}
}

// loginLimiter allows `max` failures per IP per window.
type loginLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	fails  map[string][]time.Time
}

func newLoginLimiter(max int, window time.Duration) *loginLimiter {
	return &loginLimiter{max: max, window: window, fails: map[string][]time.Time{}}
}

func (l *loginLimiter) recent(ip string) []time.Time {
	cut := time.Now().Add(-l.window)
	kept := l.fails[ip][:0]
	for _, t := range l.fails[ip] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.fails, ip)
		return nil
	}
	l.fails[ip] = kept
	return kept
}

func (l *loginLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.recent(ip)) < l.max
}

func (l *loginLimiter) fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fails[ip] = append(l.recent(ip), time.Now())
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, ip)
}

// ---- docs API ----

func (s *server) listDocs(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, body FROM docs")
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var id, body string
		if err := rows.Scan(&id, &body); err == nil {
			out[id] = json.RawMessage(body)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}

func (s *server) exportDocs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="jiggered-%s.json"`, time.Now().Format("2006-01-02")))
	s.listDocs(w, r)
}

func (s *server) putDoc(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !docIDPattern.MatchString(id) {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodySize))
	if err != nil {
		http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		return
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		http.Error(w, "body must be a JSON object", http.StatusBadRequest)
		return
	}
	_, err = s.db.ExecContext(r.Context(),
		`INSERT INTO docs(id, body, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
		id, string(body), time.Now().Unix())
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteDoc(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !docIDPattern.MatchString(id) {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM docs WHERE id = ?", id); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
