package main

import (
	"io/fs"
	"net/http"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestHealthz(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	resp, b := c.req("GET", "/healthz", nil)
	if resp.StatusCode != 200 || string(b) != "ok" {
		t.Fatalf("= %d %q", resp.StatusCode, b)
	}
	e.s.db.Close()
	if st := c.do("GET", "/healthz", nil); st != 503 {
		t.Errorf("with the database gone = %d, want 503", st)
	}
}

func TestSecurityHeaders(t *testing.T) {
	e := newTestServer(t)
	resp, _ := e.newClient().req("GET", "/login", nil)
	h := resp.Header
	if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("X-Frame-Options") != "DENY" || h.Get("Referrer-Policy") != "same-origin" {
		t.Errorf("headers = %v", h)
	}
	csp := h.Get("Content-Security-Policy")
	for _, want := range []string{"default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "worker-src 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP lacks %q: %s", want, csp)
		}
	}
	if strings.Contains(csp, "unsafe") {
		t.Errorf("CSP allows unsafe sources: %s", csp)
	}
}

func TestStaticFilesAreRevalidated(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	resp, _ := c.req("GET", "/style.css", nil)
	etag := resp.Header.Get("ETag")
	if resp.StatusCode != 200 || etag == "" || resp.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("style.css = %d etag=%q cc=%q", resp.StatusCode, etag, resp.Header.Get("Cache-Control"))
	}
	resp, b := c.req("GET", "/style.css", nil, "If-None-Match", etag)
	if resp.StatusCode != 304 || len(b) != 0 {
		t.Errorf("revalidation = %d with %d bytes, want an empty 304", resp.StatusCode, len(b))
	}
	if resp, _ := c.req("GET", "/style.css", nil, "If-None-Match", `"something-else"`); resp.StatusCode != 200 {
		t.Errorf("a stale etag = %d, want 200", resp.StatusCode)
	}
	for _, p := range []string{"/fonts/", "/fonts"} {
		if st := c.do("GET", p, nil); st == 200 {
			t.Errorf("GET %s = 200: no directory listings", p)
		}
	}
}

func TestPublicAndPrivateAssets(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	for _, p := range publicAssets {
		_, err := fs.Stat(webFS, "web"+p)
		st := anon.do("GET", p, nil)
		switch {
		case err == nil && st != 200:
			t.Errorf("public asset %s = %d without signing in", p, st)
		case err != nil && st == 303:
			t.Errorf("%s doesn't exist but redirects to login instead of 404", p)
		}
	}
	// The app itself is behind the login; the login page must not need it.
	if st := anon.do("GET", "/app.js", nil); st != 303 {
		t.Errorf("/app.js signed out = %d, want a redirect", st)
	}
	login := e.newClient().mustBody("GET", "/login")
	for _, src := range []string{"/app.js", "/sync.js", "/admin.js"} {
		if strings.Contains(login, src) {
			t.Errorf("login page loads %s, which needs a session", src)
		}
	}
	c := e.signedInAdmin()
	if resp, _ := c.req("GET", "/", nil); resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("index = %d cc=%q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
	if resp, _ := c.req("GET", "/does-not-exist.js", nil); resp.StatusCode != 404 {
		t.Errorf("missing file = %d", resp.StatusCode)
	}
}

func TestEnsureFirstAdmin(t *testing.T) {
	db, err := openDB(t.TempDir()+"/j.db", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, err := newServer(config{}, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ensureFirstAdmin(t.Context()); err == nil || !strings.Contains(err.Error(), "APP_PASSWORD_HASH") {
		t.Errorf("with no accounts and no password: %v", err)
	}
	h, _ := bcrypt.GenerateFromPassword([]byte("firstpass1"), bcryptCost)
	s.cfg = config{username: "  Paul ", passwordHash: h}
	if err := s.ensureFirstAdmin(t.Context()); err != nil {
		t.Fatal(err)
	}
	u, err := s.userByName(t.Context(), "paul")
	if err != nil || u.Role != roleAdmin || u.MustChange {
		t.Fatalf("first admin = %+v %v", u, err)
	}
	// Now that accounts exist, the environment is ignored, whatever it says.
	s.cfg = config{username: "someone-else", passwordHash: nil}
	if err := s.ensureFirstAdmin(t.Context()); err != nil {
		t.Errorf("second call: %v", err)
	}
	if n, _ := s.userCount(t.Context()); n != 1 {
		t.Errorf("%d users", n)
	}
	s.cfg = config{username: "bad name", passwordHash: h}
	db.Exec("DELETE FROM users")
	if err := s.ensureFirstAdmin(t.Context()); err == nil || !strings.Contains(err.Error(), "APP_USERNAME") {
		t.Errorf("invalid APP_USERNAME: %v", err)
	}
}

func TestLoadConfig(t *testing.T) {
	clear := func() {
		for _, k := range []string{"APP_ADDR", "APP_DB", "APP_USERNAME", "APP_PASSWORD", "APP_PASSWORD_HASH", "APP_SECURE_COOKIE", "APP_TRUST_PROXY", "APP_PROXY_HOPS"} {
			t.Setenv(k, "")
		}
	}
	clear()
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("no env at all must be fine now (the password only seeds the first admin): %v", err)
	}
	if cfg.addr != ":8080" || cfg.dbPath != "/data/jiggered.db" || cfg.username != "paul" || !cfg.secureCookie || cfg.trustProxy || cfg.proxyHops != 1 || cfg.passwordHash != nil {
		t.Errorf("defaults = %+v", cfg)
	}
	if seed, err := cfg.seed(); seed != nil || err != nil {
		t.Errorf("no password means no seed: %v %v", seed, err)
	}

	t.Setenv("APP_PASSWORD", "plainpass1")
	t.Setenv("APP_USERNAME", "Alice")
	t.Setenv("APP_SECURE_COOKIE", "false")
	t.Setenv("APP_TRUST_PROXY", "true")
	t.Setenv("APP_PROXY_HOPS", "2")
	cfg, err = loadConfig()
	if err != nil || cfg.secureCookie || !cfg.trustProxy || cfg.proxyHops != 2 {
		t.Fatalf("%+v %v", cfg, err)
	}
	if bcrypt.CompareHashAndPassword(cfg.passwordHash, []byte("plainpass1")) != nil {
		t.Error("APP_PASSWORD should be hashed")
	}
	if seed, _ := cfg.seed(); seed == nil || seed.name != "alice" {
		t.Errorf("seed = %+v", seed)
	}

	h, _ := bcrypt.GenerateFromPassword([]byte("hashedpass1"), bcryptCost)
	t.Setenv("APP_PASSWORD_HASH", string(h)) // wins over APP_PASSWORD
	cfg, _ = loadConfig()
	if bcrypt.CompareHashAndPassword(cfg.passwordHash, []byte("hashedpass1")) != nil {
		t.Error("APP_PASSWORD_HASH should win")
	}

	for name, env := range map[string][2]string{
		"short password":  {"APP_PASSWORD", "short"},
		"bad hash":        {"APP_PASSWORD_HASH", "not-a-bcrypt-hash"},
		"hops not number": {"APP_PROXY_HOPS", "many"},
		"hops zero":       {"APP_PROXY_HOPS", "0"},
		"hops too many":   {"APP_PROXY_HOPS", "11"},
	} {
		clear()
		t.Setenv(env[0], env[1])
		if _, err := loadConfig(); err == nil {
			t.Errorf("%s: no error", name)
		}
	}

	clear()
	t.Setenv("APP_PASSWORD", "plainpass1")
	t.Setenv("APP_USERNAME", "no good")
	cfg, _ = loadConfig()
	if _, err := cfg.seed(); err == nil {
		t.Error("an invalid APP_USERNAME should be refused when it is needed")
	}
}

func TestOnlyDeclaredMethodsAreRouted(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	for method, paths := range map[string][]string{
		"PATCH":  {"/api/docs/d-2026-10-01", "/api/me"},
		"POST":   {"/api/docs/d-2026-10-01", "/api/export"},
		"DELETE": {"/api/docs", "/api/export"},
		"PUT":    {"/api/docs", "/api/me"},
	} {
		for _, p := range paths {
			if st := c.do(method, p, map[string]any{}); st != http.StatusMethodNotAllowed {
				t.Errorf("%s %s = %d, want 405", method, p, st)
			}
		}
	}
}
