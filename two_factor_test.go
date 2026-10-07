package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

func enableTestFactor(t *testing.T, e *testEnv, c *client, pass string) (string, []string) {
	t.Helper()
	r, b := c.req("POST", "/api/me/security/two-factor", map[string]string{"action": "setup", "password": pass})
	if r.StatusCode != 200 {
		t.Fatalf("setup %d %s", r.StatusCode, b)
	}
	var setup struct {
		Secret string `json:"secret"`
		QR     string `json:"qr"`
	}
	if err := json.Unmarshal(b, &setup); err != nil {
		t.Fatalf("setup response: %v in %s", err, b)
	}
	if setup.Secret == "" || !strings.HasPrefix(setup.QR, "data:image/svg+xml;base64,") {
		t.Fatalf("no local setup QR: %s", b)
	}
	code, _ := totpCode(setup.Secret, totpStep(time.Now()))
	r, b = c.req("POST", "/api/me/security/two-factor", map[string]string{"action": "enable", "password": pass, "code": code})
	if r.StatusCode != 200 {
		t.Fatalf("enable %d %s", r.StatusCode, b)
	}
	var result struct {
		Codes []string `json:"codes"`
	}
	if err := json.Unmarshal(b, &result); err != nil {
		t.Fatalf("enable response: %v in %s", err, b)
	}
	if len(result.Codes) != 10 {
		t.Fatalf("recovery codes: %d in %s", len(result.Codes), b)
	}
	return setup.Secret, result.Codes
}

// lookaheadCode is the code for the step after the current one. The server accepts one step of skew, so a test can
// use the authenticator path again without waiting out the current thirty-second window or replaying the step
// the enrolment itself consumed.
func lookaheadCode(t *testing.T, secret string) string {
	t.Helper()
	code, err := totpCode(secret, totpStep(time.Now())+1)
	if err != nil {
		t.Fatal(err)
	}
	return code
}
func TestTwoFactorBlocksPasswordOnlyAndRecoveryReplay(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	secret, codes := enableTestFactor(t, e, c, adminPass)
	var stored string
	var enabled int
	e.s.db.QueryRow(`SELECT secret,enabled FROM account_security`).Scan(&stored, &enabled)
	if stored == secret || enabled != 1 {
		t.Fatal("secret not sealed")
	}
	hash, _ := e.s.passwordHash(context.Background(), 1)
	if _, _, err := e.s.newSession(context.Background(), 1, hash, "", "test"); err == nil {
		t.Fatal("password session bypassed MFA")
	}
	next := e.newClient()
	if where := next.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := next.do("GET", "/api/me", nil); st != 401 {
		t.Fatal("session before factor", st)
	}
	code, _ := totpCode(secret, totpStep(time.Now()))
	if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": code}); st != 400 {
		t.Fatal("enrollment code replay", st)
	}
	if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 200 {
		t.Fatal("recovery login", st)
	}
	if st := next.do("GET", "/api/me", nil); st != 200 {
		t.Fatal(st)
	}
	replay := e.newClient()
	replay.login(adminName, adminPass)
	if st := replay.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 400 {
		t.Fatal("recovery replay", st)
	}
	if st := replay.do("POST", "/api/auth/two-step", map[string]string{"code": codes[1]}); st != 200 {
		t.Fatal(st)
	}
	var left int
	e.s.db.QueryRow(`SELECT count(*) FROM recovery_codes`).Scan(&left)
	if left != 8 {
		t.Fatal(left)
	}
}
func TestTwoFactorChallengeExpiresAndPasswordResetInvalidates(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	_, codes := enableTestFactor(t, e, c, adminPass)
	pending := e.newClient()
	pending.login(adminName, adminPass)
	e.s.db.Exec(`UPDATE login_challenges SET expires=0`)
	if st := pending.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 400 {
		t.Fatal("expired challenge", st)
	}
	pending.login(adminName, adminPass)
	hash, _ := e.s.hashPassword("changedpassword1")
	if err := e.s.setPassword(context.Background(), 1, hash, false, ""); err != nil {
		t.Fatal(err)
	}
	if st := pending.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 400 {
		t.Fatal("challenge survived reset", st)
	}
	if where := pending.login(adminName, "changedpassword1"); where != "/login?step=2" {
		t.Fatal("factor removed by reset", where)
	}
	if st := pending.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 200 {
		t.Fatal(st)
	}
}
func TestPasswordRecoveryRequiresAndPreservesFactor(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	_, codes := enableTestFactor(t, e, c, adminPass)
	smtp, _ := fakeSMTP(t)
	cfg := testServices(t, e)
	cfg.Email = smtp
	cfg.Accounts = accountSettings{Recovery: true, PublicURL: "https://example.com"}
	saveTestServices(t, e, c, cfg)
	hash, _ := e.s.passwordHash(context.Background(), 1)
	e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'reset',1,?,?)`, hashToken("reset"), string(hash), time.Now().Add(time.Minute).Unix())
	anon := e.newClient()
	if st := anon.do("POST", "/api/auth/reset-password", map[string]string{"token": "reset", "password": "changedpassword1"}); st != 400 {
		t.Fatal("MFA bypass", st)
	}
	if st := anon.do("POST", "/api/auth/reset-password", map[string]string{"token": "reset", "password": "changedpassword1", "code": codes[0]}); st != 200 {
		t.Fatal(st)
	}
	if where := anon.login(adminName, "changedpassword1"); where != "/login?step=2" {
		t.Fatal("MFA removed", where)
	}
	if st := anon.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 400 {
		t.Fatal("reset recovery code reused", st)
	}
}
func TestTwoFactorWrongCodesStayLimitedAfterCorrectPasswords(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	_, codes := enableTestFactor(t, e, c, adminPass)
	for i := 0; i < 10; i++ {
		c.login(adminName, adminPass)
		if st := c.do("POST", "/api/auth/two-step", map[string]string{"code": "bad"}); st != 400 {
			t.Fatal(i, st)
		}
	}
	// Use a different client IP in headers through trusted proxy to distinguish the account limit.
	e.set("trust_proxy", "true")
	c.login(adminName, adminPass, "X-Forwarded-For", "203.0.113.99")
	if st := c.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}, "X-Forwarded-For", "203.0.113.99"); st != 429 {
		t.Fatal("correct password refunded factor guesses", st)
	}
}
func TestTOTPStandardVector(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte("12345678901234567890"))
	code, err := totpCode(secret, 1)
	if err != nil || code != "287082" {
		t.Fatal(code, err)
	}
	if step, ok := matchTOTP(secret, "287 082", time.Unix(59, 0)); !ok || step != 1 {
		t.Fatal(step, ok)
	}
}
func TestExpiredRegistrationAndClosedRegistration(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	if st := c.do("POST", "/api/auth/register", map[string]string{"username": "new", "email": "new@example.com", "password": "password1"}); st != 403 {
		t.Fatal(st)
	}
	e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,payload,expires) VALUES(?,'register','new',0)`, hashToken("expired"))
	if st := c.do("POST", "/api/auth/verify", map[string]string{"token": "expired"}); st != 400 {
		t.Fatal(st)
	}
}

func TestCLIFactorResetIsAuditedAndRevokesSessions(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	enableTestFactor(t, e, c, adminPass)
	var out strings.Builder
	if err := e.s.runUserCommand(context.Background(), []string{"reset-two-factor", adminName}, &out); err != nil {
		t.Fatal(err)
	}
	var enabled, sessions, codes, audits int
	e.s.db.QueryRow(`SELECT enabled FROM account_security WHERE user_id=1`).Scan(&enabled)
	e.s.db.QueryRow(`SELECT count(*) FROM sessions WHERE user_id=1`).Scan(&sessions)
	e.s.db.QueryRow(`SELECT count(*) FROM recovery_codes WHERE user_id=1`).Scan(&codes)
	e.s.db.QueryRow(`SELECT count(*) FROM audit_log WHERE actor='cli' AND action='two_factor_admin_reset'`).Scan(&audits)
	if enabled != 0 || sessions != 0 || codes != 0 || audits != 1 {
		t.Fatal(enabled, sessions, codes, audits)
	}
}
func TestWholeDatabaseRestoreClearsPendingAuthentication(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	enableTestFactor(t, e, c, adminPass)
	e.newClient().login(adminName, adminPass)
	e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES('pending','reset',1,'payload',9999999999)`)
	tmp, err := snapshotToTemp(e.s.db, e.dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = clearSessions(tmp); err != nil {
		t.Fatal(err)
	}
	db, err := openRaw(tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, table := range []string{"sessions", "auth_tokens", "login_challenges"} {
		var n int
		if err = db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatal(table, n, err)
		}
	}
	if _, err = db.Exec(`DROP TABLE account_security`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err = checkBackup(tmp); err == nil {
		t.Fatal("schema-v5 backup missing security table accepted")
	}
}

// Disabling two-step is the security-critical half of the feature: everything that could still authenticate
// the account — the sealed secret, the recovery codes, pending challenges and other devices — must go.
func TestDisableTwoFactorWipesSecretCodesChallengesAndOtherSessions(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	secret, codes := enableTestFactor(t, e, c, adminPass)
	// A second device finishes sign-in with a recovery code, and a third is left at the challenge.
	other := e.newClient()
	if where := other.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := other.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 200 {
		t.Fatal(st)
	}
	if st := other.do("GET", "/api/me", nil); st != 200 {
		t.Fatal(st)
	}
	pending := e.newClient()
	if where := pending.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := c.do("POST", "/api/me/security/two-factor", map[string]string{"action": "disable", "password": adminPass, "code": "bad"}); st != 400 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/me/security/two-factor", map[string]string{"action": "disable", "password": adminPass, "code": lookaheadCode(t, secret)}); st != 200 {
		t.Fatal(st)
	}
	var secretStored string
	var enabled, lastStep int
	var stored, challenges, sessions int
	e.s.db.QueryRow(`SELECT secret,enabled,last_step FROM account_security WHERE user_id=1`).Scan(&secretStored, &enabled, &lastStep)
	e.s.db.QueryRow(`SELECT count(*) FROM recovery_codes`).Scan(&stored)
	e.s.db.QueryRow(`SELECT count(*) FROM login_challenges`).Scan(&challenges)
	e.s.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&sessions)
	if secretStored != "" || enabled != 0 || lastStep != -1 {
		t.Fatalf("factor not wiped: secret=%q enabled=%d last_step=%d", secretStored, enabled, lastStep)
	}
	if stored != 0 || challenges != 0 {
		t.Fatalf("codes=%d challenges=%d", stored, challenges)
	}
	if sessions != 1 { // the session that did the disabling is the only one left
		t.Fatalf("sessions=%d", sessions)
	}
	if st := other.do("GET", "/api/me", nil); st != 401 {
		t.Fatal("another device survived the disable", st)
	}
	if st := c.do("GET", "/api/me", nil); st != 200 {
		t.Fatal(st)
	}
	if n := countRows(t, e, `SELECT count(*) FROM audit_log WHERE action='two_factor_disable'`); n != 1 {
		t.Fatalf("audit rows=%d", n)
	}
	// Password-only sign-in works again, and a fresh setup is possible.
	fresh := e.newClient()
	if where := fresh.login(adminName, adminPass); where != "/" {
		t.Fatal(where)
	}
	enableTestFactor(t, e, fresh, adminPass)
}
func TestDisableTwoFactorRefusesWrongPasswordAndKeepsEverything(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	enableTestFactor(t, e, c, adminPass)
	if st := c.do("POST", "/api/me/security/two-factor", map[string]string{"action": "disable", "password": "wrongpass1", "code": "bad"}); st != 403 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/me/security/two-factor", map[string]string{"action": "disable", "password": adminPass, "code": "bad"}); st != 400 {
		t.Fatal(st)
	}
	var enabled int
	e.s.db.QueryRow(`SELECT enabled FROM account_security WHERE user_id=1`).Scan(&enabled)
	if enabled != 1 {
		t.Fatal("a refused disable changed the factor")
	}
	if n := countRows(t, e, "SELECT count(*) FROM recovery_codes"); n != 10 {
		t.Fatalf("recovery codes=%d", n)
	}
}
func TestRegenerateRecoveryCodesInvalidatesOldOnes(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	secret, codes := enableTestFactor(t, e, c, adminPass)
	// Another device is signed in; regenerating codes must sign it out.
	other := e.newClient()
	if where := other.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := other.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 200 {
		t.Fatal(st)
	}
	r, b := c.req("POST", "/api/me/security/two-factor", map[string]string{"action": "regenerate", "password": adminPass, "code": lookaheadCode(t, secret)})
	if r.StatusCode != 200 {
		t.Fatalf("regenerate %d %s", r.StatusCode, b)
	}
	var result struct {
		Codes []string `json:"codes"`
	}
	if err := json.Unmarshal(b, &result); err != nil || len(result.Codes) != 10 {
		t.Fatalf("new codes: %v in %s", err, b)
	}
	for _, old := range codes {
		for _, fresh := range result.Codes {
			if old == fresh {
				t.Fatal("a regenerated set repeated an old code")
			}
		}
	}
	if st := other.do("GET", "/api/me", nil); st != 401 {
		t.Fatal("another device survived the regeneration", st)
	}
	if n := countRows(t, e, "SELECT count(*) FROM recovery_codes"); n != 10 {
		t.Fatalf("stored codes=%d", n)
	}
	// The old codes no longer work at sign-in; a new one does.
	next := e.newClient()
	if where := next.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": codes[1]}); st != 400 {
		t.Fatal("an old recovery code was accepted", st)
	}
	if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": result.Codes[0]}); st != 200 {
		t.Fatal(st)
	}
	if n := countRows(t, e, `SELECT count(*) FROM audit_log WHERE action='two_factor_regenerate'`); n != 1 {
		t.Fatalf("audit rows=%d", n)
	}
}
func TestAdminResetTwoFactorOverHTTP(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	bob, bobPass := e.addUser("bob", roleUser)
	_, codes := enableTestFactor(t, e, bob, bobPass)
	// Bob has another signed-in device and a challenge waiting.
	other := e.newClient()
	if where := other.login("bob", bobPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := other.do("POST", "/api/auth/two-step", map[string]string{"code": codes[0]}); st != 200 {
		t.Fatal(st)
	}
	if where := e.newClient().login("bob", bobPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	b, _ := e.s.userByName(context.Background(), "bob")
	if st := admin.do("POST", "/api/admin/users/bob/two-factor-reset", map[string]string{"password": adminPass}); st != 200 {
		t.Fatal(st)
	}
	var enabled int
	var secretStored string
	e.s.db.QueryRow(`SELECT enabled,secret FROM account_security WHERE user_id=?`, b.ID).Scan(&enabled, &secretStored)
	if enabled != 0 || secretStored != "" {
		t.Fatalf("factor survived: enabled=%d secret=%q", enabled, secretStored)
	}
	for _, what := range []struct{ q string }{
		{`SELECT count(*) FROM recovery_codes WHERE user_id=` + fmt.Sprint(b.ID)},
		{`SELECT count(*) FROM login_challenges WHERE user_id=` + fmt.Sprint(b.ID)},
		{`SELECT count(*) FROM sessions WHERE user_id=` + fmt.Sprint(b.ID)},
	} {
		if n := countRows(t, e, what.q); n != 0 {
			t.Fatalf("%s = %d", what.q, n)
		}
	}
	if st := other.do("GET", "/api/me", nil); st != 401 {
		t.Fatal("a reset did not sign the target out", st)
	}
	if n := countRows(t, e, `SELECT count(*) FROM audit_log WHERE actor='admin' AND action='two_factor_admin_reset' AND target='bob'`); n != 1 {
		t.Fatalf("audit rows=%d", n)
	}
	// Bob signs in with the password alone now.
	if where := e.newClient().login("bob", bobPass); where != "/" {
		t.Fatal(where)
	}
}
func TestAdminResetTwoFactorRefusals(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	bob, bobPass := e.addUser("bob", roleUser)
	enableTestFactor(t, e, bob, bobPass)
	factorRow := func() (int, int) {
		var enabled, n int
		e.s.db.QueryRow(`SELECT enabled FROM account_security WHERE user_id=(SELECT id FROM users WHERE username='bob')`).Scan(&enabled)
		e.s.db.QueryRow(`SELECT count(*) FROM recovery_codes WHERE user_id=(SELECT id FROM users WHERE username='bob')`).Scan(&n)
		return enabled, n
	}
	// Resetting your own two-step belongs in Account, not the admin panel.
	if st := admin.do("POST", "/api/admin/users/admin/two-factor-reset", map[string]string{"password": adminPass}); st != 400 {
		t.Fatal("self reset", st)
	}
	// A wrong admin password changes nothing.
	if st := admin.do("POST", "/api/admin/users/bob/two-factor-reset", map[string]string{"password": "wrongpass1"}); st != 403 {
		t.Fatal(st)
	}
	if enabled, n := factorRow(); enabled != 1 || n != 10 {
		t.Fatalf("a refused reset changed the target: enabled=%d codes=%d", enabled, n)
	}
	// An admin who has two-step of their own must present it too.
	_, adminCodes := enableTestFactor(t, e, admin, adminPass)
	if st := admin.do("POST", "/api/admin/users/bob/two-factor-reset", map[string]string{"password": adminPass, "code": "bad"}); st != 400 {
		t.Fatal(st)
	}
	if enabled, n := factorRow(); enabled != 1 || n != 10 {
		t.Fatalf("a wrong admin code changed the target: enabled=%d codes=%d", enabled, n)
	}
	if st := admin.do("POST", "/api/admin/users/bob/two-factor-reset", map[string]string{"password": adminPass, "code": adminCodes[0]}); st != 200 {
		t.Fatal(st)
	}
	// Unknown accounts are 404, and a non-admin is refused even with the right password.
	if st := admin.do("POST", "/api/admin/users/nobody/two-factor-reset", map[string]string{"password": adminPass}); st != 404 {
		t.Fatal(st)
	}
	bobAgain := e.newClient()
	if where := bobAgain.login("bob", bobPass); where != "/" { // the reset above removed bob's factor
		t.Fatal(where)
	}
	if st := bobAgain.do("POST", "/api/admin/users/bob/two-factor-reset", map[string]string{"password": bobPass}); st != 403 {
		t.Fatal(st)
	}
}
func TestTwoStepEndpointNeedsThePageHeader(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	enableTestFactor(t, e, c, adminPass)
	next := e.newClient()
	if where := next.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": "123456"}, "X-Requested-With", ""); st != 403 {
		t.Fatal(st)
	}
}
func TestChallengeLocksAfterFiveWrongCodes(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	secret, _ := enableTestFactor(t, e, c, adminPass)
	next := e.newClient()
	if where := next.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	for i := 0; i < 5; i++ {
		if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": "bad"}); st != 400 {
			t.Fatal(i, st)
		}
	}
	// The challenge is spent: even the right code is refused until a fresh sign-in re-arms it.
	if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": lookaheadCode(t, secret)}); st != 400 {
		t.Fatal("a correct code was accepted on a spent challenge", st)
	}
	next = e.newClient()
	if where := next.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	if st := next.do("POST", "/api/auth/two-step", map[string]string{"code": lookaheadCode(t, secret)}); st != 200 {
		t.Fatal(st)
	}
}
func TestTwoStepLockoutByAddress(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	enableTestFactor(t, e, c, adminPass)
	next := e.newClient()
	if where := next.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	for i := 0; i < 10; i++ {
		if _, ok := e.s.ipLimit.take(ipKey("127.0.0.1")); !ok {
			t.Fatal("could not fill the address budget")
		}
	}
	r, b := next.req("POST", "/api/auth/two-step", map[string]string{"code": "123456"})
	if r.StatusCode != 429 || !strings.Contains(string(b), "Too many attempts") {
		t.Fatalf("two-step under a locked address = %d %s", r.StatusCode, b)
	}
}
func TestTheSameCodeCannotFinishTwoSignInsAtOnce(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	secret, _ := enableTestFactor(t, e, c, adminPass)
	next := e.newClient()
	if where := next.login(adminName, adminPass); where != "/login?step=2" {
		t.Fatal(where)
	}
	code := lookaheadCode(t, secret)
	var wg sync.WaitGroup
	results := make([]int, 2)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = next.do("POST", "/api/auth/two-step", map[string]string{"code": code})
		}(i)
	}
	wg.Wait()
	sort.Ints(results)
	if results[0] != 200 || results[1] != 400 {
		t.Fatalf("two finishes with one code gave %v, want [200 400]", results)
	}
	if n := countRows(t, e, "SELECT count(*) FROM sessions"); n != 2 { // the enabling client plus exactly one new session
		t.Fatalf("sessions=%d", n)
	}
}
func TestConsumeFactorRequiredWhenNoFactorExists(t *testing.T) {
	e := newTestServer(t)
	tx, err := e.s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := e.s.consumeFactor(context.Background(), tx, 1, "123456", false); err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatalf("required factor without enrolment: %v", err)
	}
	if err := e.s.consumeFactor(context.Background(), tx, 1, "123456", true); err != nil {
		t.Fatalf("optional factor without enrolment should pass: %v", err)
	}
}

func TestCancelFactorSetupPreservesEnabledFactor(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	if st := c.do("POST", "/api/me/security/two-factor", map[string]string{"action": "setup", "password": adminPass}); st != 200 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/me/security/two-factor", map[string]string{"action": "cancel", "password": adminPass}); st != 200 {
		t.Fatal(st)
	}
	var abandoned string
	e.s.db.QueryRow(`SELECT pending_secret FROM account_security WHERE user_id=1`).Scan(&abandoned)
	if abandoned != "" {
		t.Fatal("cancel retained pending setup")
	}
	enableTestFactor(t, e, c, adminPass)
	if st := c.do("POST", "/api/me/security/two-factor", map[string]string{"action": "cancel", "password": adminPass}); st != 200 {
		t.Fatal(st)
	}
	var enabled int
	var pending string
	e.s.db.QueryRow(`SELECT enabled,pending_secret FROM account_security WHERE user_id=1`).Scan(&enabled, &pending)
	if enabled != 1 || pending != "" {
		t.Fatal("cancel changed protection or kept pending secret", enabled, pending)
	}
}
