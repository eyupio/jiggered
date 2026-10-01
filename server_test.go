package main

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"regexp"
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

func TestHealthzFailsWhenTheCoreTableIsMissing(t *testing.T) {
	e := newTestServer(t)
	if _, err := e.s.db.Exec("DROP TABLE docs"); err != nil {
		t.Fatal(err)
	}
	resp, b := e.newClient().req("GET", "/healthz", nil)
	if resp.StatusCode != 503 || strings.Contains(string(b), "docs") {
		t.Errorf("= %d %q, want 503 without the SQL error in the body", resp.StatusCode, b)
	}
}

func TestPagesAreNotIndexable(t *testing.T) {
	e := newTestServer(t)
	resp, _ := e.newClient().req("GET", "/login", nil)
	if got := resp.Header.Get("X-Robots-Tag"); !strings.Contains(got, "noindex") {
		t.Errorf("X-Robots-Tag = %q", got)
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
	// Nothing in the environment is fine: the server starts with no accounts and the first admin is made
	// from the command line.
	if err := s.ensureFirstAdmin(t.Context()); err != nil {
		t.Fatalf("no accounts and no seed must not stop the server: %v", err)
	}
	if n, _ := s.userCount(t.Context()); n != 0 {
		t.Fatalf("%d users from nothing", n)
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
	s.cfg = config{username: "someone-else", passwordHash: h}
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
		t.Fatalf("no environment at all must be fine: %v", err)
	}
	if cfg.addr != ":8080" || cfg.dbPath != "/data/jiggered.db" || cfg.username != "paul" || cfg.passwordHash != nil || len(cfg.seeds) != 0 {
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
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"secure_cookie": "false", "trust_proxy": "true", "proxy_hops": "2"}
	for k, v := range want {
		if cfg.seeds[k] != v {
			t.Errorf("seed %s = %q, want %q", k, cfg.seeds[k], v)
		}
	}
	if bcrypt.CompareHashAndPassword(cfg.passwordHash, []byte("plainpass1")) != nil {
		t.Error("APP_PASSWORD should be hashed")
	}
	if seed, _ := cfg.seed(); seed == nil || seed.name != "alice" {
		t.Errorf("seed = %+v", seed)
	}
	// Booleans are read the usual ways and in any case; anything else keeps the safe default
	// (secure cookies on, proxy not trusted).
	for _, c := range []struct{ secure, trust, wantSecure, wantTrust string }{
		{"False", "True", "false", "true"}, {"0", "1", "false", "true"}, {"no", "yes", "false", "true"}, {"off", "on", "false", "true"},
		{"garbage", "garbage", "true", "false"}, {" FALSE ", " TRUE ", "false", "true"},
	} {
		t.Setenv("APP_SECURE_COOKIE", c.secure)
		t.Setenv("APP_TRUST_PROXY", c.trust)
		cfg, _ = loadConfig()
		if cfg.seeds["secure_cookie"] != c.wantSecure || cfg.seeds["trust_proxy"] != c.wantTrust {
			t.Errorf("APP_SECURE_COOKIE=%q APP_TRUST_PROXY=%q: seeds = %v", c.secure, c.trust, cfg.seeds)
		}
	}

	h, _ := bcrypt.GenerateFromPassword([]byte("hashedpass1"), bcryptCost)
	t.Setenv("APP_PASSWORD_HASH", string(h)) // wins over APP_PASSWORD
	cfg, _ = loadConfig()
	if bcrypt.CompareHashAndPassword(cfg.passwordHash, []byte("hashedpass1")) != nil {
		t.Error("APP_PASSWORD_HASH should win")
	}

	for name, env := range map[string][2]string{
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

	// A bad password or hash isn't an error until something needs it: only the first account does.
	for name, env := range map[string][2]string{"short password": {"APP_PASSWORD", "short"}, "bad hash": {"APP_PASSWORD_HASH", "not-a-bcrypt-hash"}} {
		clear()
		t.Setenv(env[0], env[1])
		cfg, err := loadConfig()
		if err != nil {
			t.Errorf("%s: loadConfig failed, but a leftover variable must not stop an install that has accounts: %v", name, err)
		}
		if _, err := cfg.seed(); err == nil {
			t.Errorf("%s: should be refused when it is needed to create the first account", name)
		}
		if cfg.seedForOpen() != nil {
			t.Errorf("%s: seedForOpen should hand over nothing", name)
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

// Fonts are served from here, not Google, and the login page needs them before anyone is signed in.
func TestFontsAreSelfHostedAndPublic(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	resp, b := anon.req("GET", "/fonts/atkinson-400-latin.woff2", nil)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "font/woff2" || len(b) < 1000 || string(b[:4]) != "wOF2" {
		t.Fatalf("font = %d %q %d bytes", resp.StatusCode, resp.Header.Get("Content-Type"), len(b))
	}
	for _, page := range []string{"/login", "/style.css"} {
		body := anon.mustBody("GET", page)
		if strings.Contains(body, "googleapis") || strings.Contains(body, "gstatic") {
			t.Errorf("%s still refers to Google Fonts", page)
		}
	}
	if csp := anon.mustHeader("GET", "/login", "Content-Security-Policy"); strings.Contains(csp, "google") || strings.Contains(csp, "gstatic") {
		t.Errorf("CSP still allows Google: %s", csp)
	}
	// Every face the stylesheet declares exists.
	css := anon.mustBody("GET", "/style.css")
	faces := regexp.MustCompile(`url\((/fonts/[^)]+)\)`).FindAllStringSubmatch(css, -1)
	if len(faces) != 5 {
		t.Errorf("stylesheet declares %d font files, want 5", len(faces))
	}
	for _, f := range faces {
		if st := anon.do("GET", f[1], nil); st != 200 {
			t.Errorf("%s = %d", f[1], st)
		}
	}
	if _, err := fs.Stat(webFS, "web/fonts/LICENSE.txt"); err != nil {
		t.Error("the fonts' licence must ship with them")
	}
}

// If someone adds a module and forgets to list it in the service worker, the app would not open offline.
func TestServiceWorkerCachesEveryFileTheAppNeeds(t *testing.T) {
	sw, err := fs.ReadFile(webFS, "web/sw.js")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)const SHELL = \[(.*?)\];`).FindSubmatch(sw)
	if block == nil {
		t.Fatal("no SHELL list in sw.js")
	}
	listed := map[string]bool{}
	for _, m := range regexp.MustCompile(`"(/[^"]*)"`).FindAllSubmatch(block[1], -1) {
		listed[string(m[1])] = true
	}
	for path := range listed {
		file := "web" + path
		if path == "/" {
			file = "web/index.html"
		}
		if _, err := fs.Stat(webFS, file); err != nil {
			t.Errorf("sw.js lists %s, which doesn't exist", path)
		}
	}
	entries, _ := fs.ReadDir(webFS, "web")
	for _, en := range entries {
		name := en.Name()
		app := strings.HasSuffix(name, ".js") && name != "sw.js" && name != "login.js"
		if app || name == "style.css" || name == "manifest.webmanifest" || name == "icon.svg" {
			if !listed["/"+name] {
				t.Errorf("/%s ships with the app but isn't in the service worker's list, so the app wouldn't open offline", name)
			}
		}
	}
	fonts, _ := fs.ReadDir(webFS, "web/fonts")
	for _, f := range fonts {
		if strings.HasSuffix(f.Name(), ".woff2") && !listed["/fonts/"+f.Name()] {
			t.Errorf("font %s isn't in the service worker's list", f.Name())
		}
	}
	// It must never be allowed to hold anyone's data.
	if !strings.Contains(string(sw), `url.pathname.startsWith("/api/")`) {
		t.Error("sw.js must keep /api/ out of its cache")
	}
}

func TestServiceWorkerIsServedForTheWholeSite(t *testing.T) {
	e := newTestServer(t)
	resp, _ := e.newClient().req("GET", "/sw.js", nil)
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "javascript") || resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("/sw.js = %d %q cc=%q (it must be revalidated so updates are noticed)", resp.StatusCode, resp.Header.Get("Content-Type"), resp.Header.Get("Cache-Control"))
	}
}

func TestAnInstallWithAccountsIgnoresLeftoverBadCredentials(t *testing.T) {
	e := newTestServer(t) // has the admin already
	cfg := e.s.cfg
	cfg.credErr = errors.New("APP_PASSWORD: Password must be at least 8 characters.")
	cfg.passwordHash = nil
	e.s.cfg = cfg
	if err := e.s.ensureFirstAdmin(t.Context()); err != nil {
		t.Errorf("accounts exist, so a bad leftover password must not matter: %v", err)
	}
	// ...but a legacy database that needs the first admin says what's wrong with the variables.
	path := legacyDB(t, map[string]string{"d-2026-09-29": `{"date":"2026-09-29"}`}, nil)
	_, err := openDB(path, cfg.seedForOpen())
	if err = cfg.explainOpen(err); !strings.Contains(fmt.Sprint(err), "at least 8 characters") {
		t.Errorf("the refusal should explain the bad variable: %v", err)
	}
}
