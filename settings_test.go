package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestParseSetting(t *testing.T) {
	good := map[[2]string]string{
		{"secure_cookie", "true"}: "true", {"secure_cookie", " FALSE "}: "false", {"secure_cookie", "1"}: "true", {"secure_cookie", "0"}: "false",
		{"trust_proxy", "True"}: "true", {"trust_proxy", "f"}: "false",
		{"proxy_hops", "1"}: "1", {"proxy_hops", " 10 "}: "10", {"proxy_hops", "03"}: "3",
	}
	for in, want := range good {
		if got, err := parseSetting(in[0], in[1]); err != nil || got != want {
			t.Errorf("parseSetting(%q, %q) = %q, %v; want %q", in[0], in[1], got, err, want)
		}
	}
	for _, in := range [][2]string{
		{"secure_cookie", "maybe"}, {"secure_cookie", ""}, {"trust_proxy", "yes"}, {"trust_proxy", "on"},
		{"proxy_hops", "0"}, {"proxy_hops", "11"}, {"proxy_hops", "-1"}, {"proxy_hops", "two"}, {"proxy_hops", ""}, {"proxy_hops", "1.5"},
		{"nonsense", "true"}, {"", "true"}, {"APP_TRUST_PROXY", "true"},
	} {
		if got, err := parseSetting(in[0], in[1]); err == nil {
			t.Errorf("parseSetting(%q, %q) = %q, want an error", in[0], in[1], got)
		}
	}
	if _, err := parseSetting("nonsense", "x"); !strings.Contains(err.Error(), "secure_cookie, trust_proxy, proxy_hops") {
		t.Errorf("an unknown key should list the real ones: %v", err)
	}
}

func TestSettingsStartAtTheSafeDefaults(t *testing.T) {
	db, err := openDB(t.TempDir()+"/j.db", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, _ := newServer(config{}, db)
	if got := s.settings(); got != (instanceSettings{SecureCookie: true, TrustProxy: false, ProxyHops: 1}) {
		t.Errorf("defaults = %+v: cookies must need HTTPS, and no proxy header is believed", got)
	}
	values, explicit, err := s.storedSettings(t.Context())
	if err != nil || len(explicit) != 0 || values["secure_cookie"] != "true" || values["trust_proxy"] != "false" || values["proxy_hops"] != "1" {
		t.Errorf("stored = %v %v %v", values, explicit, err)
	}
}

func TestSettingsRoundTripAndTheDatabaseIsTheSource(t *testing.T) {
	e := newTestServer(t)
	e.set("trust_proxy", "true")
	e.set("trusted_proxy_cidrs", "127.0.0.1/32,10.0.0.0/8,198.51.100.1/32")
	e.set("proxy_hops", " 3 ")
	if got := e.s.settings(); !got.TrustProxy || got.ProxyHops != 3 || got.SecureCookie {
		t.Errorf("settings = %+v", got)
	}
	if _, err := e.s.setSetting(t.Context(), "proxy_hops", "99"); err == nil {
		t.Error("an invalid value must be refused")
	}
	if _, err := e.s.setSetting(t.Context(), "colour", "blue"); err == nil {
		t.Error("an unknown setting must be refused")
	}
	if got := e.s.settings().ProxyHops; got != 3 {
		t.Errorf("a refused change altered the setting: %d", got)
	}
	// What is in the database is what the server uses, wherever it came from.
	if _, err := e.s.db.Exec("UPDATE instance_settings SET value = 'false' WHERE key = 'trust_proxy'"); err != nil {
		t.Fatal(err)
	}
	e.s.forgetSettings()
	if e.s.settings().TrustProxy {
		t.Error("the server ignored the database")
	}
	// A damaged value falls back to the safe default instead of breaking anything.
	e.s.db.Exec("UPDATE instance_settings SET value = 'banana' WHERE key = 'proxy_hops'")
	e.s.db.Exec("UPDATE instance_settings SET value = '' WHERE key = 'secure_cookie'")
	e.s.forgetSettings()
	if got := e.s.settings(); got.ProxyHops != 1 || got.SecureCookie {
		t.Errorf("damaged settings = %+v", got)
	}
}

func TestSettingsReachARunningServerWithoutARestart(t *testing.T) {
	e := newTestServer(t)
	if e.s.settings().TrustProxy {
		t.Fatal("precondition")
	}
	// Another process (the CLI) writes to the same database; this server doesn't know it did.
	if _, err := e.s.db.Exec("INSERT OR REPLACE INTO instance_settings(key, value, updated_at) VALUES('trust_proxy', 'true', 1)"); err != nil {
		t.Fatal(err)
	}
	if e.s.settings().TrustProxy {
		t.Error("within the cache window the old value is still used (that is what keeps this cheap)")
	}
	e.s.cache.mu.Lock()
	e.s.cache.at = time.Now().Add(-time.Minute)
	e.s.cache.mu.Unlock()
	if !e.s.settings().TrustProxy {
		t.Error("after the window the server should have picked the change up")
	}
	// A change made through this server shows at once.
	e.set("trust_proxy", "false")
	if e.s.settings().TrustProxy {
		t.Error("setSetting should take effect immediately")
	}
}

func TestSettingsSurviveTheDatabaseBeingBusyOrBroken(t *testing.T) {
	e := newTestServer(t)
	e.set("trust_proxy", "true")
	e.set("trusted_proxy_cidrs", "127.0.0.1/32,10.0.0.0/8,198.51.100.1/32")
	e.s.settings() // cached
	e.s.db.Close()
	e.s.cache.mu.Lock()
	e.s.cache.at = time.Now().Add(-time.Minute) // stale, and the database is gone
	e.s.cache.mu.Unlock()
	start := time.Now()
	if got := e.s.settings(); !got.TrustProxy {
		t.Errorf("with the database unreadable, the last good values should be kept: %+v", got)
	}
	if time.Since(start) > 3*time.Second {
		t.Error("reading settings must not hang")
	}
	fresh := serverWithSettings(settingDefaults)
	fresh.cache.ok = false
	fresh.db = e.s.db
	if got := fresh.settings(); got != settingDefaults {
		t.Errorf("never loaded and unreadable should give the safe defaults, got %+v", got)
	}
}

func TestEnvironmentSeedsTheDatabaseOnceAndTheDatabaseWins(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	defer log.SetOutput(discard{})

	e := newTestServer(t, func(c *config) {
		c.seeds = map[string]string{"secure_cookie": "false", "trust_proxy": "true", "proxy_hops": "2"}
	})
	if got := e.s.settings(); got.SecureCookie || !got.TrustProxy || got.ProxyHops != 2 {
		t.Fatalf("seeded settings = %+v", got)
	}
	for _, want := range []string{"copied APP_TRUST_PROXY=true into the database", "copied APP_PROXY_HOPS=2", "you can remove APP_SECURE_COOKIE"} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("the log should say %q, got:\n%s", want, logs.String())
		}
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'settings_imported'"); n != 3 {
		t.Errorf("%d imports in the audit log, want 3", n)
	}

	// An admin changes their mind. The old environment is still there on the next start, and loses.
	e.set("trust_proxy", "false")
	logs.Reset()
	if err := e.s.seedSettings(t.Context()); err != nil {
		t.Fatal(err)
	}
	if e.s.settings().TrustProxy {
		t.Error("the environment overrode the database")
	}
	if !strings.Contains(logs.String(), "ignoring APP_TRUST_PROXY=true: the database already says trust_proxy = false") {
		t.Errorf("a disagreement should be explained, got:\n%s", logs.String())
	}
	if strings.Contains(logs.String(), "APP_PROXY_HOPS") {
		t.Errorf("an environment value that agrees with the database needs no comment:\n%s", logs.String())
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'settings_imported'"); n != 3 {
		t.Errorf("a second start must not import again (%d)", n)
	}
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

func TestCookieSecurityFollowsTheDatabase(t *testing.T) {
	e := newTestServer(t)
	secure := func() bool {
		resp := e.rawLogin(adminName, adminPass)
		for _, c := range resp.Cookies() {
			if c.Name == cookieName {
				return c.Secure
			}
		}
		t.Fatal("no session cookie")
		return false
	}
	if secure() {
		t.Error("the test server is seeded for plain http")
	}
	e.set("secure_cookie", "true")
	if !secure() {
		t.Error("turning it on in the database should apply to the next sign-in without a restart")
	}
	e.set("secure_cookie", "false")
	if secure() {
		t.Error("and turning it off")
	}
	// Signing out clears the cookie with the same flag.
	e.set("secure_cookie", "true")
	c := e.newClient()
	e.set("secure_cookie", "false")
	c.mustLogin(adminName, adminPass)
	e.set("secure_cookie", "true")
	resp, _ := c.req("POST", "/logout", nil)
	for _, ck := range resp.Cookies() {
		if ck.Name == cookieName && (!ck.Secure || ck.MaxAge >= 0) {
			t.Errorf("logout cookie = %+v", ck)
		}
	}
}

// rawLogin signs in and returns the response itself, for looking at the cookie.
func (e *testEnv) rawLogin(user, pw string) *http.Response {
	e.t.Helper()
	req, _ := http.NewRequest("POST", e.ts.URL+"/login", strings.NewReader("username="+user+"&password="+pw))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func TestProxySettingsFollowTheDatabase(t *testing.T) {
	e := newTestServer(t)
	seen := func(xff string) string {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = "10.0.0.5:1234"
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		return e.s.clientIP(r)
	}
	if got := seen("203.0.113.9"); got != "10.0.0.5" {
		t.Errorf("by default the header is not believed: %s", got)
	}
	e.set("trust_proxy", "true")
	e.set("trusted_proxy_cidrs", "127.0.0.1/32,10.0.0.0/8,198.51.100.1/32")
	if got := seen("6.6.6.6, 203.0.113.9"); got != "203.0.113.9" {
		t.Errorf("trusted, one hop: %s", got)
	}
	e.set("proxy_hops", "2")
	if got := seen("203.0.113.9, 198.51.100.1"); got != "203.0.113.9" {
		t.Errorf("trusted, two hops: %s", got)
	}
	e.set("trust_proxy", "false")
	if got := seen("203.0.113.9, 198.51.100.1"); got != "10.0.0.5" {
		t.Errorf("trust switched off again: %s", got)
	}
}

func TestAdminSettingsAPI(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	user, _ := e.addUser("alice", roleUser)

	var got struct {
		SecureCookie bool `json:"secure_cookie"`
		TrustProxy   bool `json:"trust_proxy"`
		ProxyHops    int  `json:"proxy_hops"`
		Seen         struct {
			RemoteAddr   string `json:"remote_addr"`
			ForwardedFor string `json:"forwarded_for"`
			ClientIP     string `json:"client_ip"`
		} `json:"seen"`
	}
	fetch := func(method string, body any, headers ...string) int {
		resp, b := admin.req(method, "/api/admin/settings", body, headers...)
		got.Seen.ForwardedFor = ""
		json.Unmarshal(b, &got)
		return resp.StatusCode
	}
	if st := fetch("GET", nil, "X-Forwarded-For", "203.0.113.9"); st != 200 {
		t.Fatalf("GET = %d", st)
	}
	if got.SecureCookie || got.TrustProxy || got.ProxyHops != 1 || got.Seen.RemoteAddr != "127.0.0.1" || got.Seen.ForwardedFor != "203.0.113.9" || got.Seen.ClientIP != "127.0.0.1" {
		t.Errorf("before: %+v", got)
	}

	// Turning the proxy setting on is visible straight away in what the admin is told they look like.
	if st := fetch("PATCH", map[string]any{"trust_proxy": true, "trusted_proxy_cidrs": "127.0.0.1/32"}, "X-Forwarded-For", "203.0.113.9"); st != 200 || !got.TrustProxy || got.Seen.ClientIP != "203.0.113.9" {
		t.Errorf("PATCH trust_proxy = %d %+v", st, got)
	}
	if st := fetch("PATCH", map[string]any{"proxy_hops": 2}); st != 200 || got.ProxyHops != 2 || !got.TrustProxy {
		t.Errorf("PATCH proxy_hops = %d %+v", st, got)
	}
	if st := fetch("PATCH", map[string]any{"trust_proxy": false, "proxy_hops": 1}); st != 200 || got.TrustProxy || got.ProxyHops != 1 {
		t.Errorf("PATCH both = %d %+v", st, got)
	}
	var entries []auditOut
	admin.getJSON("/api/admin/audit?limit=20", &entries)
	var changes []string
	for _, en := range entries {
		if en.Action == "settings_changed" {
			changes = append(changes, en.Detail+" by "+en.Actor)
		}
	}
	want := []string{"proxy_hops: 2 -> 1 by admin", "trust_proxy: true -> false by admin", "proxy_hops: 1 -> 2 by admin", "trusted_proxy_cidrs:  -> 127.0.0.1/32 by admin", "trust_proxy: false -> true by admin"}
	if strings.Join(changes, "|") != strings.Join(want, "|") {
		t.Errorf("audit = %v, want %v", changes, want)
	}

	before := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'settings_changed'")
	if st := fetch("PATCH", map[string]any{"trust_proxy": false}); st != 200 {
		t.Errorf("a no-op PATCH = %d", st)
	}
	if st := fetch("PATCH", map[string]any{}); st != 200 {
		t.Errorf("an empty PATCH = %d", st)
	}
	if after := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'settings_changed'"); after != before {
		t.Error("changing nothing must not be logged as a change")
	}

	for name, body := range map[string]any{
		"hops zero":         map[string]any{"proxy_hops": 0},
		"hops too many":     map[string]any{"proxy_hops": 11},
		"hops not a number": map[string]any{"proxy_hops": "two"},
		"trust not a bool":  map[string]any{"trust_proxy": "yes"},
		"secure_cookie is CLI-only (turning it on over http would lock you out)": map[string]any{"secure_cookie": true},
		"unknown": map[string]any{"colour": "blue"},
	} {
		if st := fetch("PATCH", body); st != 400 {
			t.Errorf("%s = %d, want 400", name, st)
		}
	}
	if got.TrustProxy || got.ProxyHops != 1 || got.SecureCookie {
		t.Errorf("refused changes altered something: %+v", got)
	}
	// A hops value that is valid on its own but arrives with an invalid second field changes nothing.
	if st := fetch("PATCH", map[string]any{"proxy_hops": 5, "trust_proxy": "bogus"}); st != 400 || e.s.settings().ProxyHops != 1 {
		t.Errorf("a half-valid PATCH = %d, hops now %d", st, e.s.settings().ProxyHops)
	}

	for _, m := range []string{"GET", "PATCH"} {
		var body any
		if m == "PATCH" {
			body = map[string]any{"trust_proxy": true}
		}
		if st := user.do(m, "/api/admin/settings", body); st != 403 {
			t.Errorf("a non-admin %s = %d, want 403", m, st)
		}
		if st := e.newClient().do(m, "/api/admin/settings", body); st != 401 {
			t.Errorf("anonymous %s = %d, want 401", m, st)
		}
	}
	if e.s.settings().TrustProxy {
		t.Error("a refused request changed a setting")
	}
}

func TestCLISettings(t *testing.T) {
	e := newTestServer(t)
	t.Setenv("APP_DB", e.dbPath)
	t.Setenv("APP_PASSWORD", "")
	t.Setenv("APP_PASSWORD_HASH", "")
	t.Setenv("APP_TRUST_PROXY", "")
	t.Setenv("APP_SECURE_COOKIE", "")

	out, _, handled, err := cli(t, "", "settings")
	if !handled || err != nil {
		t.Fatalf("settings: %v", err)
	}
	for _, want := range []string{"secure_cookie  false", "trust_proxy    false  (default)", "proxy_hops     1      (default)"} {
		if !regexp.MustCompile(strings.ReplaceAll(regexp.QuoteMeta(want), " ", `\s+`)).MatchString(out) {
			t.Errorf("settings output lacks %q:\n%s", want, out)
		}
	}
	out, _, _, err = cli(t, "", "settings", "set", "secure_cookie", "TRUE")
	if err != nil || !strings.Contains(out, "secure_cookie is now true") {
		t.Fatalf("set: %q %v", out, err)
	}
	out, _, _, _ = cli(t, "", "settings")
	line := regexp.MustCompile(`(?m)^secure_cookie.*$`).FindString(out)
	if !regexp.MustCompile(`^secure_cookie\s+true`).MatchString(line) || strings.Contains(line, "(default)") {
		t.Errorf("after set, the line should say true and no longer be marked as the default: %q", line)
	}
	if v, _, _ := e.s.storedSettings(t.Context()); v["secure_cookie"] != "true" {
		t.Errorf("the database says %v", v)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'settings_changed' AND actor = 'cli' AND detail = 'secure_cookie: false -> true'"); n != 1 {
		t.Error("the change should be in the audit log as the CLI's")
	}
	for _, args := range [][]string{{"settings", "set", "proxy_hops", "0"}, {"settings", "set", "nonsense", "1"}, {"settings", "set", "trust_proxy"}, {"settings", "set"}, {"settings", "get", "x"}, {"settings", "set", "a", "b", "c"}} {
		if _, _, _, err := cli(t, "", args...); err == nil {
			t.Errorf("%v should fail", args)
		}
	}
	if v, _, _ := e.s.storedSettings(t.Context()); v["proxy_hops"] != "1" {
		t.Error("a refused change altered a setting")
	}
	// and the environment does not leak in: the database is the source
	t.Setenv("APP_TRUST_PROXY", "true")
	out, _, _, _ = cli(t, "", "settings")
	if !regexp.MustCompile(`trust_proxy\s+false`).MatchString(out) {
		t.Errorf("an environment variable must not override what the CLI shows:\n%s", out)
	}
}

func TestLoginPageSaysHowToCreateTheFirstAccountOnlyWhenThereIsNone(t *testing.T) {
	login, err := fs.ReadFile(webFS, "web/login.html")
	if err != nil || !bytes.Contains(login, []byte(`id="setup" hidden`)) {
		t.Fatal(`web/login.html must contain id="setup" hidden: the server un-hides it when there are no accounts`)
	}
	db, err := openDB(t.TempDir()+"/j.db", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, _ := newServer(config{}, db)
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	page := func() string {
		resp, err := http.Get(ts.URL + "/login")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var b bytes.Buffer
		b.ReadFrom(resp.Body)
		return b.String()
	}
	if p := page(); !strings.Contains(p, `id="setup">`) || strings.Contains(p, `id="setup" hidden`) || !strings.Contains(p, "user add") {
		t.Error("with no accounts the sign-in page should say how to make the first one")
	}
	hash, _ := s.hashPassword("some-password")
	if _, err := s.createUser(context.Background(), "paul", hash, roleAdmin, false); err != nil {
		t.Fatal(err)
	}
	if p := page(); !strings.Contains(p, `id="setup" hidden`) {
		t.Error("once there is an account the hint must go away")
	}
}

// A brand-new install with nothing configured at all: it starts, says what to do, and the first admin
// made from the command line can sign in and is made to choose a password.
func TestFirstRunWithNoConfigurationAtAll(t *testing.T) {
	db, err := openDB(t.TempDir()+"/j.db", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, err := newServer(config{}, db) // no username, no password, no seeds
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := s.seedSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.ensureFirstAdmin(ctx); err != nil {
		t.Fatalf("starting with nothing configured: %v", err)
	}
	ts := httptest.NewServer(s.routes())
	defer ts.Close()
	if resp, err := http.Get(ts.URL + "/healthz"); err != nil || resp.StatusCode != 200 {
		t.Fatalf("healthz: %v", err)
	}

	var out bytes.Buffer
	if err := s.runUserCommand(ctx, []string{"add", "paul", "--admin"}, &out); err != nil {
		t.Fatal(err)
	}
	temp := regexp.MustCompile(`[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}`).FindString(out.String())
	// The server's secure-by-default cookie can't be used over plain http in this test.
	if _, err := s.setSetting(ctx, "secure_cookie", "false"); err != nil {
		t.Fatal(err)
	}
	e := &testEnv{t: t, s: s, ts: ts}
	c := e.newClient()
	c.mustLogin("paul", temp)
	var me map[string]any
	c.getJSON("/api/me", &me)
	if me["role"] != roleAdmin || me["must_change_password"] != true {
		t.Errorf("the first admin = %v", me)
	}
	if st := c.do("GET", "/api/docs", nil); st != 403 {
		t.Errorf("until they choose a password the API is closed: %d", st)
	}
	if st := c.do("POST", "/api/me/password", map[string]string{"current": temp, "new": "a-chosen-password"}); st != 204 {
		t.Fatalf("choosing a password = %d", st)
	}
	if st, _ := c.putDoc("d-2026-10-01", `{"status":"green"}`); st != 200 {
		t.Errorf("after that the app works: %d", st)
	}
}

func TestMigrationAddsTheSettingsTableToAnExistingAccountsDatabase(t *testing.T) {
	path := legacyDB(t, map[string]string{"d-2026-09-29": `{"date":"2026-09-29"}`}, nil)
	db, err := openDB(path, seedFor(t, "paul", "oldpassword1"))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if got := scalar(t, path, "SELECT count(*) FROM sqlite_master WHERE name = 'instance_settings'"); got != 1 {
		t.Error("the settings table is missing after the upgrade")
	}
	if got := scalar(t, path, "SELECT count(*) FROM instance_settings"); got != 0 {
		t.Error("an upgrade alone stores no settings: the defaults apply until someone chooses")
	}
}

func TestSettingsPatchAppliesAllOrNothing(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	if st := c.do("PATCH", "/api/admin/settings", map[string]any{"trust_proxy": true, "proxy_hops": 3}); st != 200 {
		t.Fatalf("valid patch = %d", st)
	}
	if got := e.s.settings().strings(); got["trust_proxy"] != "true" || got["proxy_hops"] != "3" {
		t.Fatalf("both fields should be stored, got %v", got)
	}
	if st := c.do("PATCH", "/api/admin/settings", map[string]any{"trust_proxy": false, "proxy_hops": 99}); st != 400 {
		t.Fatalf("patch with a bad second field = %d, want 400", st)
	}
	if got := e.s.settings().strings(); got["trust_proxy"] != "true" || got["proxy_hops"] != "3" {
		t.Errorf("a refused patch changed settings: %v", got)
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'settings_changed'"); n != 2 {
		t.Errorf("audit rows = %d, want 2 (one per changed field, none for the refused patch)", n)
	}
}

func TestJSONBodiesMustBeASingleValue(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	r, _ := http.NewRequest("PATCH", c.base+"/api/admin/settings", strings.NewReader(`{"trust_proxy":true} {"trust_proxy":false}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Requested-With", "jiggered")
	r.Header.Set("X-Jiggered-Password", adminPass)
	got, err := c.hc.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	got.Body.Close()
	if got.StatusCode != 400 {
		t.Errorf("two JSON values in one body = %d, want 400", got.StatusCode)
	}
	if e.s.settings().strings()["trust_proxy"] == "true" {
		t.Error("the first value was applied despite the trailing data")
	}
}

func TestRejectedSettingsPatchChangesNothing(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	before := e.s.settings().strings()
	if st := c.do("PATCH", "/api/admin/settings", map[string]any{"trust_proxy": true, "proxy_hops": 99}); st != 400 {
		t.Fatalf("patch with an invalid field = %d, want 400", st)
	}
	if after := e.s.settings().strings(); after["trust_proxy"] != before["trust_proxy"] {
		t.Errorf("a refused patch still changed trust_proxy: %q -> %q", before["trust_proxy"], after["trust_proxy"])
	}
}
