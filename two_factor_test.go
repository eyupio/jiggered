package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func enableTestFactor(t *testing.T, e *testEnv, c *client) (string, []string) {
	t.Helper()
	r, b := c.req("POST", "/api/me/security/two-factor", map[string]string{"action": "setup", "password": adminPass})
	if r.StatusCode != 200 {
		t.Fatalf("setup %d %s", r.StatusCode, b)
	}
	var setup struct {
		Secret string `json:"secret"`
		QR     string `json:"qr"`
	}
	json.Unmarshal(b, &setup)
	if setup.Secret == "" || !strings.HasPrefix(setup.QR, "data:image/svg+xml;base64,") {
		t.Fatal("no local setup QR")
	}
	code, _ := totpCode(setup.Secret, totpStep(time.Now()))
	r, b = c.req("POST", "/api/me/security/two-factor", map[string]string{"action": "enable", "password": adminPass, "code": code})
	if r.StatusCode != 200 {
		t.Fatalf("enable %d %s", r.StatusCode, b)
	}
	var result struct {
		Codes []string `json:"codes"`
	}
	json.Unmarshal(b, &result)
	if len(result.Codes) != 10 {
		t.Fatal("no recovery codes")
	}
	return setup.Secret, result.Codes
}
func TestTwoFactorBlocksPasswordOnlyAndRecoveryReplay(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	secret, codes := enableTestFactor(t, e, c)
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
	_, codes := enableTestFactor(t, e, c)
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
	_, codes := enableTestFactor(t, e, c)
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
	_, codes := enableTestFactor(t, e, c)
	for i := 0; i < 10; i++ {
		c.login(adminName, adminPass)
		if st := c.do("POST", "/api/auth/two-step", map[string]string{"code": "bad"}); st != 400 {
			t.Fatal(i, st)
		}
	}
	// Use a different client IP in headers through trusted proxy to distinguish the account limit.
	e.s.cfg.seeds["trust_proxy"] = "true"
	e.s.db.Exec(`UPDATE instance_settings SET value='true' WHERE key='trust_proxy'`)
	e.s.cache.ok = false
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
	enableTestFactor(t, e, c)
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
	enableTestFactor(t, e, c)
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
