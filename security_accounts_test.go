package main

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"
)

// configureAccounts turns on email with the local test relay and the given self-service switches.
func configureAccounts(t *testing.T, e *testEnv, c *client, accounts accountSettings) <-chan string {
	t.Helper()
	smtp, mails := fakeSMTP(t)
	cfg := testServices(t, e)
	cfg.Email = smtp
	cfg.Accounts = accounts
	saveTestServices(t, e, c, cfg)
	return mails
}

// The public authentication endpoints are what a page on another site would love to drive: only our own page,
// saying so with the custom header, may post to them.
func TestPublicAuthWritesNeedThePageHeaderAndSameOrigin(t *testing.T) {
	e := newTestServer(t)
	e.s.publicLimit = newLoginLimiter(100, 15*time.Minute)
	admin := e.signedInAdmin()
	configureAccounts(t, e, admin, accountSettings{Registration: true, Recovery: true, PublicURL: "https://example.com"})
	c := e.newClient()
	origin, _ := url.Parse(e.ts.URL)
	cases := []struct{ path, body string }{
		{"/api/auth/register", `{"username":"x","email":"x@example.com","password":"password1"}`},
		{"/api/auth/forgot-password", `{"email":"x@example.com"}`},
		{"/api/auth/reset-password", `{"token":"x","password":"password1"}`},
		{"/api/auth/verify", `{"token":"x"}`},
		{"/api/auth/two-step", `{"code":"123456"}`},
	}
	for _, tc := range cases {
		if st := c.do("POST", tc.path, tc.body, "X-Requested-With", ""); st != 403 {
			t.Errorf("%s without the page header = %d, want 403", tc.path, st)
		}
		if st := c.do("POST", tc.path, tc.body, "Origin", "https://elsewhere.example"); st != 403 {
			t.Errorf("%s from another origin = %d, want 403", tc.path, st)
		}
		if st := c.do("POST", tc.path, tc.body, "Origin", origin.String()); st == 403 {
			t.Errorf("%s from its own origin was refused", tc.path)
		}
	}
}

func TestPublicAuthEndpointsAreRateLimited(t *testing.T) {
	e := newTestServer(t)
	e.s.publicLimit = newLoginLimiter(3, 15*time.Minute)
	c := e.newClient()
	for i := 0; i < 3; i++ {
		if st := c.do("POST", "/api/auth/verify", `{"token":"x"}`); st != 400 { // unknown token, but it was allowed to try
			t.Fatalf("attempt %d = %d", i, st)
		}
	}
	r, b := c.req("POST", "/api/auth/verify", `{"token":"x"}`)
	if r.StatusCode != 429 || !strings.Contains(string(b), "Too many requests") {
		t.Fatalf("fourth attempt = %d %s", r.StatusCode, b)
	}
}

func TestAuthOptionsReportAvailability(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	c := e.newClient()
	var out map[string]bool
	c.getJSON("/api/auth/options", &out)
	if out["registration"] || out["recovery"] {
		t.Fatalf("nothing is available without a mail server: %v", out)
	}
	configureAccounts(t, e, admin, accountSettings{Registration: true, Recovery: true, PublicURL: "https://example.com"})
	c.getJSON("/api/auth/options", &out)
	if !out["registration"] || !out["recovery"] {
		t.Fatalf("available after configuration: %v", out)
	}
}

// A duplicate of a *pending* registration is re-queued by design (the newer link replaces the older one), but a
// duplicate of an existing account or verified address must answer exactly like an unknown one and send no mail.
func TestDuplicateRegistrationsSendNoMailAndLookTheSame(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	mails := configureAccounts(t, e, admin, accountSettings{Registration: true, Recovery: true, PublicURL: "https://example.com"})
	c := e.newClient()
	r1, b1 := c.req("POST", "/api/auth/register", map[string]string{"username": "newperson", "email": "person@example.com", "password": "newpassword1"})
	if r1.StatusCode != 200 {
		t.Fatalf("first registration: %d %s", r1.StatusCode, b1)
	}
	superseded := tokenFromMail(t, mails, "verify")
	e.s.serviceJobs.Wait()
	// The same person asking again replaces their pending link with a fresh one.
	if st := c.do("POST", "/api/auth/register", map[string]string{"username": "newperson", "email": "person@example.com", "password": "newpassword1"}); st != 200 {
		t.Fatal(st)
	}
	live := tokenFromMail(t, mails, "verify")
	e.s.serviceJobs.Wait()
	if n := countRows(t, e, "SELECT count(*) FROM auth_tokens WHERE purpose='register'"); n != 1 {
		t.Fatalf("pending registrations = %d", n)
	}
	if st := c.do("POST", "/api/auth/verify", map[string]string{"token": superseded}); st != 400 {
		t.Fatal("a replaced link still worked", st)
	}
	// Complete the account, then duplicates of it must be indistinguishable from unknowns.
	if st := c.do("POST", "/api/auth/verify", map[string]string{"token": live}); st != 200 {
		t.Fatal(st)
	}
	e.s.serviceJobs.Wait()
	r2, b2 := c.req("POST", "/api/auth/register", map[string]string{"username": "newperson", "email": "other@example.com", "password": "newpassword1"})
	r3, b3 := c.req("POST", "/api/auth/register", map[string]string{"username": "someoneelse", "email": "person@example.com", "password": "newpassword1"})
	for _, got := range []struct {
		r  int
		b  []byte
		id string
	}{{r2.StatusCode, b2, "username"}, {r3.StatusCode, b3, "address"}} {
		if got.r != 200 || string(got.b) != string(b1) {
			t.Fatalf("duplicate %s: %d %s (first answer was %s)", got.id, got.r, got.b, b1)
		}
	}
	e.s.serviceJobs.Wait()
	select {
	case m := <-mails:
		t.Fatalf("mail was sent for a duplicate: %s", m)
	default:
	}
	if n := countRows(t, e, "SELECT count(*) FROM auth_tokens WHERE purpose='register'"); n != 0 {
		t.Fatalf("pending registrations after verification = %d", n)
	}
}

func TestRegistrationPausesWhenTooManyLinksArePending(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	mails := configureAccounts(t, e, admin, accountSettings{Registration: true, PublicURL: "https://example.com"})
	if _, err := e.s.db.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 1000)
		INSERT INTO auth_tokens(token_hash,purpose,payload,expires) SELECT 'pending'||x, 'register', 'pending', ? FROM n`, time.Now().Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	c := e.newClient()
	r, b := c.req("POST", "/api/auth/register", map[string]string{"username": "newperson", "email": "person@example.com", "password": "newpassword1"})
	if r.StatusCode != 503 || !strings.Contains(string(b), "Registration is busy") {
		t.Fatalf("full queue: %d %s", r.StatusCode, b)
	}
	select {
	case m := <-mails:
		t.Fatalf("mail was sent while busy: %s", m)
	default:
	}
	if _, err := e.s.db.Exec(`DELETE FROM auth_tokens`); err != nil {
		t.Fatal(err)
	}
	// With room again the same request is accepted, and a link arrives.
	if st := c.do("POST", "/api/auth/register", map[string]string{"username": "newperson", "email": "person@example.com", "password": "newpassword1"}); st != 200 {
		t.Fatal(st)
	}
	tokenFromMail(t, mails, "verify")
}

func TestVerifyRefusesWhenRegistrationClosesAfterIssue(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	mails := configureAccounts(t, e, admin, accountSettings{Registration: true, PublicURL: "https://example.com"})
	c := e.newClient()
	if st := c.do("POST", "/api/auth/register", map[string]string{"username": "late", "email": "late@example.com", "password": "newpassword1"}); st != 200 {
		t.Fatal(st)
	}
	token := tokenFromMail(t, mails, "verify")
	e.s.serviceJobs.Wait()
	cfg := testServices(t, e)
	cfg.Accounts.Registration = false
	saveTestServices(t, e, admin, cfg)
	r, b := c.req("POST", "/api/auth/verify", map[string]string{"token": token})
	if r.StatusCode != 403 || !strings.Contains(string(b), "closed") {
		t.Fatalf("verify after closing: %d %s", r.StatusCode, b)
	}
	if _, err := e.s.userByName(context.Background(), "late"); err == nil {
		t.Fatal("an account was created after registration was closed")
	}
}

// A reset link is bound to the password it was issued against: any password change in between kills it.
func TestAResetLinkDiesWhenThePasswordChanges(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	mails := configureAccounts(t, e, admin, accountSettings{Registration: true, Recovery: true, PublicURL: "https://example.com"})
	c := e.newClient()
	if st := c.do("POST", "/api/auth/register", map[string]string{"username": "newperson", "email": "person@example.com", "password": "newpassword1"}); st != 200 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/auth/verify", map[string]string{"token": tokenFromMail(t, mails, "verify")}); st != 200 {
		t.Fatal(st)
	}
	e.s.serviceJobs.Wait()
	if st := c.do("POST", "/api/auth/forgot-password", map[string]string{"email": "person@example.com"}); st != 200 {
		t.Fatal(st)
	}
	stale := tokenFromMail(t, mails, "reset")
	e.s.serviceJobs.Wait()
	// The password changes before the link is used.
	if where := c.login("newperson", "newpassword1"); where != "/" {
		t.Fatal(where)
	}
	if st := c.do("POST", "/api/me/password", map[string]string{"current": "newpassword1", "new": "changedpassword1"}); st != 204 {
		t.Fatal(st)
	}
	r, b := c.req("POST", "/api/auth/reset-password", map[string]string{"token": stale, "password": "secondchange1"})
	if r.StatusCode != 400 || !strings.Contains(string(b), "expired or was already used") {
		t.Fatalf("a reset link survived a password change: %d %s", r.StatusCode, b)
	}
	if where := c.login("newperson", "changedpassword1"); where != "/" {
		t.Fatalf("the stale link changed the password anyway: %s", where)
	}
	// A link issued after the change still works.
	if st := c.do("POST", "/api/auth/forgot-password", map[string]string{"email": "person@example.com"}); st != 200 {
		t.Fatal(st)
	}
	fresh := tokenFromMail(t, mails, "reset")
	e.s.serviceJobs.Wait()
	if st := c.do("POST", "/api/auth/reset-password", map[string]string{"token": fresh, "password": "thirdchange1"}); st != 200 {
		t.Fatal(st)
	}
	if where := c.login("newperson", "thirdchange1"); where != "/" {
		t.Fatal(where)
	}
	// The link is also bound to the hash it was issued against, independently of the row being deleted: a token
	// left over from an older password must be refused even if it is still in the table.
	who, _ := e.s.userByName(context.Background(), "newperson")
	e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'reset',?,'an older password hash',?)`, hashToken("stale-bound"), who.ID, time.Now().Add(time.Minute).Unix())
	r, b = c.req("POST", "/api/auth/reset-password", map[string]string{"token": "stale-bound", "password": "fourthchange1"})
	if r.StatusCode != 400 || !strings.Contains(string(b), "expired or was already used") {
		t.Fatalf("a token bound to an old password was accepted: %d %s", r.StatusCode, b)
	}
	if where := c.login("newperson", "thirdchange1"); where != "/" {
		t.Fatal("the stale-bound link changed the password", where)
	}
}

// Changing the recovery address is the flow that decides where reset links go: a link only ever attaches the
// address it was issued for, supersedes the previous request, and dies if the password changes underneath it.
func TestRecoveryEmailChangeVerifiesSupersedesAndBindsToThePassword(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	bob, bobPass := e.addUser("bob", roleUser)
	e.s.recoveryLimit = newLoginLimiter(100, 15*time.Minute) // this test requests several changes in a row
	mails := configureAccounts(t, e, admin, accountSettings{Registration: true, Recovery: true, PublicURL: "https://example.com"})
	bobID, _ := e.s.userByName(context.Background(), "bob")
	anon := e.newClient()

	// The panel reports what the account has before anything is verified.
	var status map[string]any
	bob.getJSON("/api/me/security", &status)
	if status["email"] != "" || status["two_factor"] != false || status["email_available"] != true || status["recovery_enabled"] != true {
		t.Fatalf("empty account status: %v", status)
	}

	// Requesting a change to a@ supersedes the one for b@ when b@ is requested second.
	if st := bob.do("POST", "/api/me/security/email", map[string]string{"password": bobPass, "email": "a@example.com"}); st != 200 {
		t.Fatal(st)
	}
	if st := bob.do("POST", "/api/me/security/email", map[string]string{"password": bobPass, "email": "b@example.com"}); st != 200 {
		t.Fatal(st)
	}
	tokenA := tokenFromMail(t, mails, "verify")
	tokenB := tokenFromMail(t, mails, "verify")
	e.s.serviceJobs.Wait()
	if st := anon.do("POST", "/api/auth/verify", map[string]string{"token": tokenA}); st != 400 {
		t.Fatal("a superseded link was accepted", st)
	}
	if st := anon.do("POST", "/api/auth/verify", map[string]string{"token": tokenB}); st != 200 {
		t.Fatal(st)
	}
	var email string
	e.s.db.QueryRow(`SELECT email FROM account_security WHERE user_id=?`, bobID.ID).Scan(&email)
	if email != "b@example.com" {
		t.Fatalf("verified address = %q", email)
	}
	// The link is single use, and verifying it consumed every outstanding email and reset link.
	if st := anon.do("POST", "/api/auth/verify", map[string]string{"token": tokenB}); st != 400 {
		t.Fatal("replay accepted", st)
	}
	if n := countRows(t, e, `SELECT count(*) FROM auth_tokens WHERE user_id=? AND purpose IN ('email','reset')`, bobID.ID); n != 0 {
		t.Fatalf("outstanding links = %d", n)
	}
	bob.getJSON("/api/me/security", &status)
	if status["email"] != "b@example.com" {
		t.Fatalf("panel did not show the verified address: %v", status)
	}

	// Another account cannot attach an address that is taken.
	if st := admin.do("POST", "/api/me/security/email", map[string]string{"password": adminPass, "email": "b@example.com"}); st != 200 {
		t.Fatal(st)
	}
	tokenC := tokenFromMail(t, mails, "verify")
	e.s.serviceJobs.Wait()
	r, b := admin.req("POST", "/api/auth/verify", map[string]string{"token": tokenC})
	if r.StatusCode != 409 || !strings.Contains(string(b), "cannot be attached") {
		t.Fatalf("taken address: %d %s", r.StatusCode, b)
	}

	// A link dies if the password changes before it is used, and the current address is untouched.
	if st := bob.do("POST", "/api/me/security/email", map[string]string{"password": bobPass, "email": "c@example.com"}); st != 200 {
		t.Fatal(st)
	}
	tokenD := tokenFromMail(t, mails, "verify")
	e.s.serviceJobs.Wait()
	if st := bob.do("POST", "/api/me/password", map[string]string{"current": bobPass, "new": "bobchangedpass1"}); st != 204 {
		t.Fatal(st)
	}
	if st := anon.do("POST", "/api/auth/verify", map[string]string{"token": tokenD}); st != 400 {
		t.Fatal("a link survived the password change", st)
	}
	e.s.db.QueryRow(`SELECT email FROM account_security WHERE user_id=?`, bobID.ID).Scan(&email)
	if email != "b@example.com" {
		t.Fatalf("a refused link changed the address: %q", email)
	}
}

func TestRecoveryEmailRequestValidatesBeforeAnythingIsSent(t *testing.T) {
	e := newTestServer(t)
	c, pass := e.addUser("bob", roleUser)
	if st := c.do("POST", "/api/me/security/email", map[string]string{"password": "wrongpass1", "email": "x@example.com"}); st != 403 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/me/security/email", map[string]string{"password": pass, "email": "not an address"}); st != 400 {
		t.Fatal(st)
	}
	// Email is not configured yet.
	if st := c.do("POST", "/api/me/security/email", map[string]string{"password": pass, "email": "x@example.com"}); st != 400 {
		t.Fatal(st)
	}
	admin := e.signedInAdmin()
	configureAccounts(t, e, admin, accountSettings{Registration: true, Recovery: true, PublicURL: "https://example.com"})
	if st := c.do("POST", "/api/me/security/email", map[string]string{"password": pass, "email": "x@example.com"}); st != 200 {
		t.Fatal(st)
	}
	// The third request of the window was the last the limiter allowed.
	r, b := c.req("POST", "/api/me/security/email", map[string]string{"password": pass, "email": "y@example.com"})
	if r.StatusCode != 429 || !strings.Contains(string(b), "Too many verification requests") {
		t.Fatalf("rate limit = %d %s", r.StatusCode, b)
	}
}
