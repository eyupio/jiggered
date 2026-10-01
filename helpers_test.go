package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestMain(m *testing.M) {
	bcryptCost = bcrypt.MinCost // real cost is ~250ms a hash
	log.SetOutput(io.Discard)
	os.Exit(m.Run())
}

const (
	adminName = "admin"
	adminPass = "adminpass1"
)

type testEnv struct {
	t      *testing.T
	s      *server
	ts     *httptest.Server
	dbPath string
}

// newTestServer starts the whole app on a temp database with one admin ("admin").
func newTestServer(t *testing.T, tweak ...func(*config)) *testEnv {
	t.Helper()
	dir := t.TempDir()
	hash, err := bcrypt.GenerateFromPassword([]byte(adminPass), bcryptCost)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config{
		addr: "127.0.0.1:0", dbPath: filepath.Join(dir, "jiggered.db"),
		username: adminName, passwordHash: hash, proxyHops: 1,
	}
	for _, f := range tweak {
		f(&cfg)
	}
	seed, err := cfg.seed()
	if err != nil {
		t.Fatal(err)
	}
	db, err := openDB(cfg.dbPath, seed)
	if err != nil {
		t.Fatal(err)
	}
	s, err := newServer(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ensureFirstAdmin(t.Context()); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routes())
	t.Cleanup(func() { ts.Close(); db.Close() })
	return &testEnv{t: t, s: s, ts: ts, dbPath: cfg.dbPath}
}

type client struct {
	t    *testing.T
	base string
	hc   *http.Client
}

// newClient is a browser: its own cookie jar, and it does not follow redirects.
func (e *testEnv) newClient() *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: e.t, base: e.ts.URL, hc: &http.Client{
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// req sends a request the way the page does (with the X-Requested-With header on writes).
// Extra args are header name, value pairs; an empty value removes the header.
func (c *client) req(method, path string, body any, headers ...string) (*http.Response, []byte) {
	c.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	case []byte:
		rd = bytes.NewReader(b)
	default:
		j, err := json.Marshal(b)
		if err != nil {
			c.t.Fatal(err)
		}
		rd = bytes.NewReader(j)
	}
	r, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		c.t.Fatal(err)
	}
	if method != http.MethodGet && method != http.MethodHead {
		r.Header.Set("X-Requested-With", "jiggered")
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i+1] == "" {
			r.Header.Del(headers[i])
		} else {
			r.Header.Set(headers[i], headers[i+1])
		}
	}
	resp, err := c.hc.Do(r)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, b
}

// do is req for tests that only care about the status.
func (c *client) do(method, path string, body any, headers ...string) int {
	c.t.Helper()
	resp, _ := c.req(method, path, body, headers...)
	return resp.StatusCode
}

// getJSON GETs path, expects 200 and decodes into out.
func (c *client) getJSON(path string, out any) {
	c.t.Helper()
	resp, b := c.req("GET", path, nil)
	if resp.StatusCode != 200 {
		c.t.Fatalf("GET %s: %d %s", path, resp.StatusCode, b)
	}
	if err := json.Unmarshal(b, out); err != nil {
		c.t.Fatalf("GET %s: %v in %s", path, err, b)
	}
}

// login posts the sign-in form and returns where it redirected to.
func (c *client) login(name, pw string, headers ...string) string {
	c.t.Helper()
	form := url.Values{"username": {name}, "password": {pw}}
	r, _ := http.NewRequest("POST", c.base+"/login", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	resp, err := c.hc.Do(r)
	if err != nil {
		c.t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden {
		return "403"
	}
	return resp.Header.Get("Location")
}

func (c *client) mustLogin(name, pw string) {
	c.t.Helper()
	if loc := c.login(name, pw); loc != "/" {
		c.t.Fatalf("login as %q: redirected to %q", name, loc)
	}
}

// signedInAdmin is a client signed in as the bootstrap admin.
func (e *testEnv) signedInAdmin() *client {
	c := e.newClient()
	c.mustLogin(adminName, adminPass)
	return c
}

var userSeq atomic.Int64

// addUser makes an account directly in the database and returns a client signed in as it.
func (e *testEnv) addUser(name, role string) (*client, string) {
	e.t.Helper()
	pw := "password-" + name
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.s.createUser(e.t.Context(), name, string(hash), role, false); err != nil {
		e.t.Fatal(err)
	}
	c := e.newClient()
	c.mustLogin(name, pw)
	return c, pw
}

func (c *client) putDoc(id string, body any, headers ...string) (int, map[string]any) {
	c.t.Helper()
	resp, b := c.req("PUT", "/api/docs/"+id, body, headers...)
	var out map[string]any
	json.Unmarshal(b, &out)
	return resp.StatusCode, out
}

type listed map[string]struct {
	Rev  int64           `json:"rev"`
	Body json.RawMessage `json:"body"`
}

func (c *client) docs() listed {
	c.t.Helper()
	var out listed
	c.getJSON("/api/docs", &out)
	return out
}

func countRows(t *testing.T, e *testEnv, query string, args ...any) int {
	t.Helper()
	var n int
	if err := e.s.db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (c *client) mustBody(method, path string) string {
	c.t.Helper()
	_, b := c.req(method, path, nil)
	return string(b)
}
