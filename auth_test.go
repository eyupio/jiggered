package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestLoginAndLogout(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	if st := c.do("GET", "/api/me", nil); st != 401 {
		t.Fatalf("signed out /api/me = %d, want 401", st)
	}
	if loc := c.login(adminName, adminPass); loc != "/" {
		t.Fatalf("login redirected to %q", loc)
	}
	var me map[string]any
	c.getJSON("/api/me", &me)
	if me["username"] != adminName || me["role"] != roleAdmin || me["must_change_password"] != false {
		t.Errorf("/api/me = %v", me)
	}
	resp, _ := c.req("POST", "/logout", nil)
	if resp.StatusCode != 303 || resp.Header.Get("Location") != "/login" {
		t.Errorf("logout = %d -> %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	if st := c.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("after logout /api/me = %d, want 401", st)
	}
}

func TestSessionCookieIsHardened(t *testing.T) {
	e := newTestServer(t, func(c *config) { c.secureCookie = true })
	form := strings.NewReader("username=admin&password=" + adminPass)
	req, _ := http.NewRequest("POST", e.ts.URL+"/login", form)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var cookie *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == cookieName {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || len(cookie.Value) != 64 {
		t.Fatalf("cookie = %+v", cookie)
	}
	// Only a hash of the token is stored.
	if n := countRows(t, e, "SELECT count(*) FROM sessions WHERE token_hash = ?", cookie.Value); n != 0 {
		t.Error("the raw token must not be stored")
	}
	if n := countRows(t, e, "SELECT count(*) FROM sessions WHERE token_hash = ?", hashToken(cookie.Value)); n != 1 {
		t.Error("the hashed token should be stored")
	}
}

func TestWrongPasswordAndUnknownUserLookTheSame(t *testing.T) {
	e := newTestServer(t)
	for name, user := range map[string]string{"wrong password": adminName, "unknown user": "nobody"} {
		if loc := e.newClient().login(user, "not-the-password"); loc != "/login?e=bad" {
			t.Errorf("%s: redirected to %q", name, loc)
		}
	}
}

func TestUsernameIsCaseInsensitiveAndTrimmed(t *testing.T) {
	e := newTestServer(t)
	for _, name := range []string{"ADMIN", "  Admin ", "admin"} {
		if loc := e.newClient().login(name, adminPass); loc != "/" {
			t.Errorf("login as %q redirected to %q", name, loc)
		}
	}
}

func TestDisabledAccountCannotSignIn(t *testing.T) {
	e := newTestServer(t)
	dora, pw := e.addUser("dora", roleUser)
	u, _ := e.s.userByName(t.Context(), "dora")
	if err := e.s.setDisabled(t.Context(), u.ID, true); err != nil {
		t.Fatal(err)
	}
	if st := dora.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("an existing session of a disabled account = %d, want 401", st)
	}
	if loc := e.newClient().login("dora", pw); loc != "/login?e=disabled" {
		t.Errorf("right password, disabled: %q", loc)
	}
	if loc := e.newClient().login("dora", "wrong-wrong"); loc != "/login?e=bad" {
		t.Errorf("wrong password, disabled: %q (must not reveal the account is disabled)", loc)
	}
	if err := e.s.setDisabled(t.Context(), u.ID, false); err != nil {
		t.Fatal(err)
	}
	if loc := e.newClient().login("dora", pw); loc != "/" {
		t.Errorf("after enabling: %q", loc)
	}
}

func TestIPLockoutAfterTenFailures(t *testing.T) {
	e := newTestServer(t)
	for i := 0; i < 10; i++ {
		// A different X-Forwarded-For each time must not matter: we don't trust it unless told to.
		if loc := e.newClient().login("nobody", "wrong-wrong", "X-Forwarded-For", fmt.Sprintf("203.0.113.%d", i)); loc != "/login?e=bad" {
			t.Fatalf("attempt %d: %q", i, loc)
		}
	}
	if loc := e.newClient().login(adminName, adminPass); loc != "/login?e=locked" {
		t.Errorf("11th attempt with the right password: %q, want locked", loc)
	}
}

func TestSuccessfulLoginDoesNotRefillTheIPBudget(t *testing.T) {
	e := newTestServer(t)
	for i := 0; i < 5; i++ {
		e.newClient().login("nobody", "wrong-wrong")
	}
	if loc := e.newClient().login(adminName, adminPass); loc != "/" {
		t.Fatalf("login in between: %q", loc)
	}
	for i := 0; i < 5; i++ {
		e.newClient().login("nobody", "wrong-wrong")
	}
	if loc := e.newClient().login(adminName, adminPass); loc != "/login?e=locked" {
		t.Errorf("an account must not be able to log in between guesses to get unlimited tries at others: %q", loc)
	}
}

func TestTrustProxyCountsFromTheRight(t *testing.T) {
	e := newTestServer(t, func(c *config) { c.trustProxy = true })
	// The client rotates the leftmost entries; our proxy appends the real address on the right.
	for i := 0; i < 10; i++ {
		xff := fmt.Sprintf("10.9.9.%d, 198.51.100.7", i)
		if loc := e.newClient().login("nobody", "wrong-wrong", "X-Forwarded-For", xff); loc != "/login?e=bad" {
			t.Fatalf("attempt %d: %q", i, loc)
		}
	}
	if loc := e.newClient().login(adminName, adminPass, "X-Forwarded-For", "10.1.1.1, 198.51.100.7"); loc != "/login?e=locked" {
		t.Errorf("rotating the leftmost entry must not dodge the lockout: %q", loc)
	}
	if loc := e.newClient().login(adminName, adminPass, "X-Forwarded-For", "10.1.1.1, 198.51.100.8"); loc != "/" {
		t.Errorf("a different real address must not be locked out: %q", loc)
	}
}

func TestTrustProxyHops(t *testing.T) {
	e := newTestServer(t, func(c *config) { c.trustProxy = true; c.proxyHops = 2 })
	for i := 0; i < 10; i++ {
		e.newClient().login("nobody", "wrong-wrong", "X-Forwarded-For", fmt.Sprintf("192.0.2.1, 198.51.100.7, 10.0.0.%d", i))
	}
	if loc := e.newClient().login(adminName, adminPass, "X-Forwarded-For", "192.0.2.1, 198.51.100.7, 10.0.0.99"); loc != "/login?e=locked" {
		t.Errorf("two proxies: the second from the right is the client: %q", loc)
	}
}

func TestAccountLockoutCoversEveryAddress(t *testing.T) {
	e := newTestServer(t, func(c *config) { c.trustProxy = true })
	e.addUser("alice", roleUser)
	for i := 0; i < 10; i++ { // spread across addresses so no single IP hits its own limit
		e.newClient().login(adminName, "wrong-wrong", "X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
	}
	if loc := e.newClient().login(adminName, adminPass, "X-Forwarded-For", "198.51.100.200"); loc != "/login?e=locked" {
		t.Errorf("the guessed-at account should be locked from every address: %q", loc)
	}
	if loc := e.newClient().login("alice", "password-alice", "X-Forwarded-For", "198.51.100.200"); loc != "/" {
		t.Errorf("other accounts are unaffected: %q", loc)
	}
}

func TestUnknownUsernamesAreNotTracked(t *testing.T) {
	e := newTestServer(t)
	for i := 0; i < 5; i++ {
		e.newClient().login(fmt.Sprintf("ghost%d", i), "wrong-wrong")
	}
	e.s.userLimit.mu.Lock()
	n := len(e.s.userLimit.fails)
	e.s.userLimit.mu.Unlock()
	if n != 0 {
		t.Errorf("per-account limiter holds %d keys for names that don't exist; an attacker could grow it without bound", n)
	}
}

func TestIPv6AddressesShareTheirSlash64(t *testing.T) {
	if ipKey("2001:db8:1:2:aaaa::1") != ipKey("2001:db8:1:2:bbbb::9") {
		t.Error("addresses in one /64 must share a limiter key")
	}
	if ipKey("2001:db8:1:2::1") == ipKey("2001:db8:1:3::1") {
		t.Error("different /64s must not")
	}
	if ipKey("203.0.113.5") != "203.0.113.5" || ipKey("not-an-ip") != "not-an-ip" {
		t.Error("IPv4 and junk pass through unchanged")
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct {
		name   string
		trust  bool
		hops   int
		remote string
		xff    []string
		want   string
	}{
		{"direct", false, 1, "192.0.2.10:5555", nil, "192.0.2.10"},
		{"header ignored unless trusted", false, 1, "192.0.2.10:5555", []string{"1.2.3.4"}, "192.0.2.10"},
		{"one hop, single entry", true, 1, "127.0.0.1:1", []string{"198.51.100.7"}, "198.51.100.7"},
		{"one hop, spoofed prefix", true, 1, "127.0.0.1:1", []string{"6.6.6.6, 198.51.100.7"}, "198.51.100.7"},
		{"header split over two lines", true, 1, "127.0.0.1:1", []string{"6.6.6.6", "198.51.100.7"}, "198.51.100.7"},
		{"two hops", true, 2, "127.0.0.1:1", []string{"6.6.6.6, 198.51.100.7, 10.0.0.2"}, "198.51.100.7"},
		{"fewer entries than hops falls back", true, 3, "127.0.0.1:1", []string{"198.51.100.7"}, "127.0.0.1"},
		{"garbage falls back", true, 1, "127.0.0.1:1", []string{"not an ip"}, "127.0.0.1"},
		{"no header", true, 1, "127.0.0.1:1", nil, "127.0.0.1"},
	}
	for _, c := range cases {
		s := &server{cfg: config{trustProxy: c.trust, proxyHops: c.hops}}
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.remote
		for _, v := range c.xff {
			r.Header.Add("X-Forwarded-For", v)
		}
		if got := s.clientIP(r); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestCrossSiteWritesAreRefused(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	if st := c.do("PUT", "/api/docs/d-2026-10-01", `{"status":"green"}`, "X-Requested-With", ""); st != 403 {
		t.Errorf("write without X-Requested-With = %d, want 403", st)
	}
	if st, _ := c.putDoc("d-2026-10-01", `{"status":"green"}`); st != 200 {
		t.Errorf("same-origin write = %d", st)
	}
	for _, site := range []string{"cross-site", "same-site"} {
		if loc := e.newClient().login(adminName, adminPass, "Sec-Fetch-Site", site); loc != "403" {
			t.Errorf("login with Sec-Fetch-Site: %s -> %q, want 403 (login CSRF)", site, loc)
		}
		if st := c.do("PUT", "/api/docs/d-2026-10-01", `{"status":"green"}`, "Sec-Fetch-Site", site); st != 403 {
			t.Errorf("API write with Sec-Fetch-Site: %s = %d, want 403", site, st)
		}
	}
	for _, site := range []string{"same-origin", "none", ""} {
		if loc := e.newClient().login(adminName, adminPass, "Sec-Fetch-Site", site); loc != "/" {
			t.Errorf("login with Sec-Fetch-Site %q -> %q", site, loc)
		}
	}
	if st := c.do("GET", "/api/me", nil, "Sec-Fetch-Site", "cross-site"); st != 200 {
		t.Errorf("reads are not blocked: %d", st)
	}
}

func TestExpiredSessionIsRejected(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	if _, err := e.s.db.Exec("UPDATE sessions SET expires_at = ?", time.Now().Add(-time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	if st := c.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("expired session = %d, want 401", st)
	}
	e.s.prune()
	if n := countRows(t, e, "SELECT count(*) FROM sessions"); n != 0 {
		t.Errorf("prune left %d expired sessions", n)
	}
}

func TestSignedOutRequestsAreRedirectedOrRefused(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	for _, p := range []string{"/", "/app.js", "/index.html"} {
		resp, _ := c.req("GET", p, nil)
		if resp.StatusCode != 303 || resp.Header.Get("Location") != "/login" {
			t.Errorf("GET %s signed out = %d -> %q", p, resp.StatusCode, resp.Header.Get("Location"))
		}
	}
	for _, p := range []string{"/api/docs", "/api/export", "/api/me", "/api/admin/users", "/api/admin/audit"} {
		if st := c.do("GET", p, nil); st != 401 {
			t.Errorf("GET %s signed out = %d, want 401", p, st)
		}
	}
	if st := c.do("POST", "/api/admin/backup", nil); st != 401 {
		t.Errorf("backup signed out = %d, want 401", st)
	}
	resp, _ := c.req("GET", "/login", nil)
	if resp.StatusCode != 200 {
		t.Errorf("login page = %d", resp.StatusCode)
	}
}

func TestLoginPageSendsSignedInUsersHome(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	resp, _ := c.req("GET", "/login", nil)
	if resp.StatusCode != 303 || resp.Header.Get("Location") != "/" {
		t.Errorf("signed-in /login = %d -> %q", resp.StatusCode, resp.Header.Get("Location"))
	}
}

func TestMustChangePasswordBlocksTheAPIUntilChanged(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	tmp := createViaAPI(t, admin, "newbie", roleUser)

	nb := e.newClient()
	nb.mustLogin("newbie", tmp)
	var me map[string]any
	nb.getJSON("/api/me", &me)
	if me["must_change_password"] != true {
		t.Fatalf("me = %v", me)
	}
	if st := nb.do("GET", "/api/docs", nil); st != 403 {
		t.Errorf("docs before changing the password = %d, want 403", st)
	}
	if st, _ := nb.putDoc("d-2026-10-01", `{"status":"green"}`); st != 403 {
		t.Errorf("write before changing the password = %d, want 403", st)
	}
	if st := nb.do("GET", "/api/export", nil); st != 403 {
		t.Errorf("export before changing the password = %d, want 403", st)
	}
	if resp, _ := nb.req("GET", "/", nil); resp.StatusCode != 200 {
		t.Errorf("the page itself must load so it can show the change form: %d", resp.StatusCode)
	}
	if st := nb.do("POST", "/api/me/password", map[string]string{"current": tmp, "new": "a-better-password"}); st != 204 {
		t.Fatalf("change password = %d", st)
	}
	if st := nb.do("GET", "/api/docs", nil); st != 200 {
		t.Errorf("docs after changing the password = %d", st)
	}
	if loc := e.newClient().login("newbie", tmp); loc != "/login?e=bad" {
		t.Errorf("the temporary password must stop working: %q", loc)
	}
	if loc := e.newClient().login("newbie", "a-better-password"); loc != "/" {
		t.Errorf("new password: %q", loc)
	}
}

func TestChangePassword(t *testing.T) {
	e := newTestServer(t)
	c1 := e.signedInAdmin()
	c2 := e.signedInAdmin() // a second device

	change := func(cur, nw string) int {
		return c1.do("POST", "/api/me/password", map[string]string{"current": cur, "new": nw})
	}
	if st := change("wrong-current", "brand-new-pass"); st != 403 {
		t.Errorf("wrong current password = %d, want 403", st)
	}
	if st := change(adminPass, "short"); st != 400 {
		t.Errorf("too short = %d, want 400", st)
	}
	if st := change(adminPass, strings.Repeat("x", 73)); st != 400 {
		t.Errorf("over 72 bytes = %d, want 400", st)
	}
	if st := change(adminPass, adminPass); st != 400 {
		t.Errorf("unchanged = %d, want 400", st)
	}
	if st := change(adminPass, "ADMIN"); st != 400 {
		t.Errorf("same as username (and too short) = %d, want 400", st)
	}
	if st := c1.do("POST", "/api/me/password", `{"current":"x","new":"y","extra":1}`); st != 400 {
		t.Errorf("unknown field = %d, want 400", st)
	}
	if st := change(adminPass, "brand-new-pass"); st != 204 {
		t.Fatalf("valid change = %d", st)
	}
	if st := c1.do("GET", "/api/me", nil); st != 200 {
		t.Errorf("the session that changed the password stays signed in: %d", st)
	}
	if st := c2.do("GET", "/api/me", nil); st != 401 {
		t.Errorf("other sessions must be signed out: %d", st)
	}
	if loc := e.newClient().login(adminName, adminPass); loc != "/login?e=bad" {
		t.Errorf("old password still works: %q", loc)
	}
	if loc := e.newClient().login(adminName, "brand-new-pass"); loc != "/" {
		t.Errorf("new password: %q", loc)
	}
}

func TestChangePasswordGuessesAreLimited(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	for i := 0; i < 10; i++ {
		if st := c.do("POST", "/api/me/password", map[string]string{"current": "wrong-guess", "new": "brand-new-pass"}); st != 403 {
			t.Fatalf("guess %d = %d", i, st)
		}
	}
	if st := c.do("POST", "/api/me/password", map[string]string{"current": adminPass, "new": "brand-new-pass"}); st != 429 {
		t.Errorf("a stolen session must not get unlimited guesses at the password: %d", st)
	}
}

func TestPasswordChecks(t *testing.T) {
	for pw, ok := range map[string]bool{
		"12345678": true, "abcdefg": false, "": false, "pässwörd": true,
		strings.Repeat("a", 72): true, strings.Repeat("a", 73): false, "Alice123": false,
	} {
		err := checkPassword(pw, "alice123")
		if (err == nil) != ok {
			t.Errorf("checkPassword(%q) = %v, want ok=%v", pw, err, ok)
		}
	}
}

func TestUsernames(t *testing.T) {
	for in, want := range map[string]bool{
		"paul": true, "a": true, "al.ice-1_x": true, "me@example.com": true, "plus+tag": true,
		"": false, "-lead": false, ".dot": false, "has space": false, "semi;colon": false,
		strings.Repeat("a", 65): false, "ünï": false, "Upper": false,
	} {
		if validUsername(in) != want {
			t.Errorf("validUsername(%q) != %v", in, want)
		}
	}
	if normUsername("  PaUl ") != "paul" {
		t.Error("normUsername should trim and lower-case")
	}
}

func TestTempPassword(t *testing.T) {
	re := regexp.MustCompile(`^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$`)
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		pw, err := tempPassword()
		if err != nil {
			t.Fatal(err)
		}
		if !re.MatchString(pw) || strings.ContainsAny(pw, "0O1lI") {
			t.Fatalf("%q is not in the expected format", pw)
		}
		if err := checkPassword(pw, "someone"); err != nil {
			t.Fatalf("a temporary password must satisfy our own policy: %v", err)
		}
		if seen[pw] {
			t.Fatalf("%q repeated", pw)
		}
		seen[pw] = true
	}
}

func TestLimiter(t *testing.T) {
	l := newLoginLimiter(3, 40*time.Millisecond)
	for i := 0; i < 3; i++ {
		if !l.allow("k") {
			t.Fatalf("blocked after %d failures", i)
		}
		l.fail("k")
	}
	if l.allow("k") {
		t.Error("should block at the limit")
	}
	if !l.allow("other") {
		t.Error("keys are independent")
	}
	l.reset("k")
	if !l.allow("k") {
		t.Error("reset should clear")
	}
	for i := 0; i < 3; i++ {
		l.fail("k")
	}
	time.Sleep(60 * time.Millisecond)
	if !l.allow("k") {
		t.Error("failures should age out of the window")
	}
	l.fail("stale")
	time.Sleep(60 * time.Millisecond)
	l.sweep()
	l.mu.Lock()
	n := len(l.fails)
	l.mu.Unlock()
	if n != 0 {
		t.Errorf("sweep left %d aged-out keys", n)
	}
}

func TestLimiterStopsGrowingWhenFull(t *testing.T) {
	l := newLoginLimiter(3, time.Hour)
	for i := 0; i < limiterMaxKeys; i++ {
		l.fail(fmt.Sprint("k", i))
	}
	l.fail("one-too-many")
	l.mu.Lock()
	n, tracked := len(l.fails), l.fails["one-too-many"] != nil
	l.mu.Unlock()
	if n != limiterMaxKeys || tracked {
		t.Errorf("limiter grew to %d keys (new key tracked: %v)", n, tracked)
	}
	l.fail("k0") // an existing key still counts
	l.mu.Lock()
	got := len(l.fails["k0"])
	l.mu.Unlock()
	if got != 2 {
		t.Errorf("existing key has %d failures, want 2", got)
	}
}

// createViaAPI has an admin create an account and returns its temporary password.
func createViaAPI(t *testing.T, admin *client, name, role string) string {
	t.Helper()
	resp, b := admin.req("POST", "/api/admin/users", map[string]string{"username": name, "role": role})
	if resp.StatusCode != 201 {
		t.Fatalf("create %s: %d %s", name, resp.StatusCode, b)
	}
	var out struct {
		TempPassword string `json:"temp_password"`
	}
	if err := json.Unmarshal(b, &out); err != nil || out.TempPassword == "" {
		t.Fatalf("create %s: %s", name, b)
	}
	return out.TempPassword
}
