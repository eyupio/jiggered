package main

import (
	"context"
	"encoding/json"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSecurityAdminCookieCannotCreatePersistence(t *testing.T) {
	e := newTestServer(t)
	stolen := e.signedInAdmin()
	for _, path := range []string{"/api/admin/users", "/api/admin/settings"} {
		method := "POST"
		body := `{"username":"attackeradmin","role":"admin"}`
		if strings.HasSuffix(path, "settings") {
			method = "PATCH"
			body = `{"trust_proxy":true}`
		}
		if status := stolen.do(method, path, body, "X-Jiggered-Password", ""); status != 403 {
			t.Fatal(path, status)
		}
	}
	if countRows(t, e, "SELECT count(*) FROM users WHERE username='attackeradmin'") != 0 {
		t.Fatal("unauthorized account created")
	}
}

func TestSecurityFixStalePasswordChange(t *testing.T) {
	e := newTestServer(t)
	alice, old := e.addUser("alice", roleUser)
	u, _ := e.s.userByName(t.Context(), "alice")
	resetHash, _ := bcrypt.GenerateFromPassword([]byte("owner-reset-password"), bcrypt.MinCost)
	e.s.hashSem = make(chan struct{})
	done := make(chan int, 1)
	go func() {
		done <- alice.do("POST", "/api/me/password", map[string]string{"current": old, "new": "attacker-final-password"})
	}()
	<-e.s.hashSem             // password verification starts
	e.s.hashSem <- struct{}{} // verification ends, next step starts
	<-e.s.hashSem             // new-password hashing starts after old password was verified
	if err := e.s.setPassword(context.Background(), u.ID, string(resetHash), true, ""); err != nil {
		t.Fatal(err)
	}
	e.s.hashSem <- struct{}{} // permit stale request to finish hashing and commit
	if st := <-done; st != 409 {
		t.Fatal(st)
	}
	hash, _ := e.s.passwordHash(t.Context(), u.ID)
	if bcrypt.CompareHashAndPassword(hash, []byte("owner-reset-password")) != nil {
		t.Fatal("reset password was overwritten")
	}
	fresh, _ := e.s.userByID(t.Context(), u.ID)
	if !fresh.MustChange {
		t.Fatal("must-change unexpectedly retained")
	}
	// Restore a normal semaphore before performing a real login.
	e.s.hashSem = make(chan struct{}, maxHashing)
	if loc := e.newClient().login("alice", "attacker-final-password"); loc == "/" {
		t.Fatal("stale password accepted")
	}
}

type gateBody struct {
	entered, release chan struct{}
	content          io.Reader
	first            bool
}

func (g *gateBody) Read(p []byte) (int, error) {
	if !g.first {
		g.first = true
		close(g.entered)
		<-g.release
	}
	return g.content.Read(p)
}
func (g *gateBody) Close() error { return nil }
func TestSecurityFixDemotedAdminStillCreatesAdmin(t *testing.T) {
	e := newTestServer(t)
	old, _ := e.addUser("oldadmin", roleAdmin)
	u, _ := e.s.userByName(t.Context(), "oldadmin")
	req := httptest.NewRequest("POST", "/api/admin/users", nil)
	base, _ := http.NewRequest("GET", e.ts.URL, nil)
	for _, c := range old.hc.Jar.Cookies(base.URL) {
		req.AddCookie(c)
	}
	req.Header.Set("X-Requested-With", "jiggered")
	req.Header.Set("X-Jiggered-Password", "password-oldadmin")
	body := &gateBody{entered: make(chan struct{}), release: make(chan struct{}), content: strings.NewReader(`{"username":"persistadmin","role":"admin"}`)}
	req.Body = body
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { e.s.routes().ServeHTTP(rec, req); close(done) }()
	<-body.entered
	if err := e.s.setRole(t.Context(), u.ID, roleUser); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.revokeSessions(t.Context(), u.ID, ""); err != nil {
		t.Fatal(err)
	}
	close(body.release)
	<-done
	if rec.Code != 403 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	if countRows(t, e, "SELECT count(*) FROM users WHERE username='persistadmin'") != 0 {
		t.Fatal("demoted admin created persistent account")
	}

}

func TestSecurityFixTombstonesEscapeQuota(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	prior := maxDocIdentitiesPerUser
	maxDocIdentitiesPerUser = 2
	defer func() { maxDocIdentitiesPerUser = prior }()
	for i := 0; i < 2; i++ {
		id := fmt.Sprintf("e-%d", i)
		if st, _ := alice.putDoc(id, `{}`); st != 200 {
			t.Fatal(st)
		}
		if st := alice.do("DELETE", "/api/docs/"+id, nil); st != 204 {
			t.Fatal(st)
		}
	}
	if status, _ := alice.putDoc("e-99", `{}`); status != 413 {
		t.Fatal("new identity not bounded", status)
	}
	if status, _ := alice.putDoc("e-0", `{}`); status != 200 {
		t.Fatal("existing identity must be reusable", status)
	}
	alice.do("DELETE", "/api/docs/e-0", nil)
	n := countRows(t, e, "SELECT count(*) FROM doc_revs")
	if n != 2 || countRows(t, e, "SELECT count(*) FROM docs") != 0 {
		t.Fatal(n)
	}
}

func TestSecurityFixRestoreErasesAdminAudit(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	e.s.audit(t.Context(), "admin", "password_reset", "alice", "KEEP-MARKER", "")
	r, b := alice.req("POST", "/api/restore/preview", `{"e-1":{}}`)
	if r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	var p struct {
		Token string `json:"token"`
	}
	json.Unmarshal(b, &p)
	if st := alice.do("POST", "/api/restore", `{"e-1":{}}`, "If-Match", p.Token); st != 200 {
		t.Fatal(st)
	}
	var classified int
	e.s.db.QueryRow("SELECT count(*) FROM audit_log WHERE action='restore' AND NOT " + auditSelfService).Scan(&classified)
	if classified != 0 {
		t.Fatal(classified)
	}
	// Seed repeat events locally rather than hammering the HTTP server 10,000 times.
	tx, _ := e.s.db.Begin()
	for i := 0; i < auditMaxRows; i++ {
		tx.Exec("INSERT INTO audit_log(at,actor,action,target,detail,ip)VALUES(?,?,?,?,?,?)", time.Now().Unix(), "alice", "restore", "alice", "", "")
	}
	tx.Commit()
	e.s.prune()
	if countRows(t, e, "SELECT count(*) FROM audit_log WHERE detail='KEEP-MARKER'") != 1 {
		t.Fatal("marker retained")
	}
}

func TestSecurityFixProxySpoofing(t *testing.T) {
	s := serverWithSettings(instanceSettings{SecureCookie: true, TrustProxy: true, ProxyHops: 1})
	r := httptest.NewRequest("POST", "/login", nil)
	r.RemoteAddr = "203.0.113.10:5000"
	r.Header.Set("X-Forwarded-For", "198.51.100.99")
	if s.clientIP(r) != "203.0.113.10" {
		t.Fatal(s.clientIP(r))
	}
	r.Header.Set("Origin", "https://evil.example")
	r.Header.Set("X-Forwarded-Host", "evil.example")
	if s.sameSiteLogin(r) {
		t.Fatal("forged origin accepted")
	}
}

func TestSecurityFixStolenCurrentCookieSurvivesPasswordChange(t *testing.T) {
	e := newTestServer(t)
	alice, old := e.addUser("alice", roleUser)
	base, _ := http.NewRequest("GET", e.ts.URL, nil)
	stolen := e.newClient()
	stolen.hc.Jar.SetCookies(base.URL, alice.hc.Jar.Cookies(base.URL))
	if st := alice.do("POST", "/api/me/password", map[string]string{"current": old, "new": "owner-changed-password"}); st != 204 {
		t.Fatal(st)
	}
	if st := stolen.do("GET", "/api/docs", nil); st != 401 {
		t.Fatal(st)
	}
}

func TestSecurityImportAdmissionAndBoundedDecoder(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	bob, _ := e.addUser("bob", roleUser)
	charlie, _ := e.addUser("charlie", roleUser)
	request := func(c *client) *http.Request {
		r := httptest.NewRequest("POST", "/api/import", nil)
		u, _ := e.s.userByName(t.Context(), map[*client]string{alice: "alice", bob: "bob", charlie: "charlie"}[c])
		return r.WithContext(context.WithValue(r.Context(), authKey{}, &authInfo{u: u}))
	}
	releaseA, ok := e.s.admitImport(httptest.NewRecorder(), request(alice))
	if !ok {
		t.Fatal("first upload refused")
	}
	defer releaseA()
	rec := httptest.NewRecorder()
	if _, ok = e.s.admitImport(rec, request(alice)); ok || rec.Code != 429 || rec.Header().Get("Retry-After") == "" {
		t.Fatal("duplicate account admitted")
	}
	releaseB, ok := e.s.admitImport(httptest.NewRecorder(), request(bob))
	if !ok {
		t.Fatal("second account refused")
	}
	defer releaseB()
	if _, ok = e.s.admitImport(httptest.NewRecorder(), request(charlie)); ok {
		t.Fatal("global capacity exceeded")
	}
	for _, body := range []string{`{"e-1":{},"e-1":{}}`, `{"e-1":{}} {}`, `[]`} {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/import", strings.NewReader(body))
		if _, ok := readExport(rec, r); ok || rec.Code != 400 {
			t.Fatal("malformed export accepted", body)
		}
	}
	old := maxDocsPerUser
	maxDocsPerUser = 2
	defer func() { maxDocsPerUser = old }()
	rec = httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/import", strings.NewReader(`{"e-1":{},"e-2":{},"e-3":{}}`))
	if _, ok := readExport(rec, r); ok || rec.Code != 413 {
		t.Fatal("record count not bounded")
	}
}

func TestSecurityProxyRequiresPeersChainAndCanonicalOrigin(t *testing.T) {
	s := serverWithSettings(instanceSettings{TrustProxy: true, ProxyHops: 2, TrustedProxyCIDRs: "127.0.0.1/32,10.0.0.0/8"})
	r := httptest.NewRequest("POST", "http://internal/login", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("X-Forwarded-For", "198.51.100.4,10.0.0.2")
	r.Header.Set("Origin", "https://logs.example")
	r.Header.Set("X-Forwarded-Host", "logs.example")
	r.Header.Set("X-Forwarded-Proto", "https")
	if s.clientIP(r) != "198.51.100.4" || !s.sameSiteLogin(r) {
		t.Fatal("valid proxy rejected")
	}
	r.Header.Set("X-Forwarded-Host", "evil.example,logs.example")
	if s.sameSiteLogin(r) {
		t.Fatal("multi-valued host accepted")
	}
	r.Header.Set("X-Forwarded-For", "198.51.100.4,203.0.113.9")
	if s.clientIP(r) != "127.0.0.1" {
		t.Fatal("untrusted intermediary accepted")
	}
}

func TestSecurityRevokedAdminCannotCommitAnyAccountMutation(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	target, _ := e.addUser("target", roleUser)
	req := httptest.NewRequest("POST", "/api/admin/users", nil)
	base, _ := http.NewRequest("GET", e.ts.URL, nil)
	for _, cookie := range admin.hc.Jar.Cookies(base.URL) {
		req.AddCookie(cookie)
	}
	a := e.s.lookup(req)
	a.verified, _ = e.s.passwordHash(t.Context(), a.u.ID)
	ctx := context.WithValue(context.WithValue(t.Context(), authKey{}, a), adminMutationKey{}, true)
	tu, _ := e.s.userByName(t.Context(), "target")
	if _, err := e.s.revokeSessions(t.Context(), a.u.ID, ""); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func() error{
		"create":   func() error { _, err := e.s.createUser(ctx, "intruder", "invalidhash", roleAdmin, true); return err },
		"password": func() error { return e.s.setPassword(ctx, tu.ID, "invalidhash", true, "") },
		"role":     func() error { return e.s.setRole(ctx, tu.ID, roleAdmin) },
		"disable":  func() error { return e.s.setDisabled(ctx, tu.ID, true) },
		"delete":   func() error { return e.s.deleteUser(ctx, tu.ID) },
		"revoke":   func() error { _, err := e.s.revokeSessions(ctx, tu.ID, ""); return err },
		"settings": func() error { _, err := e.s.setSettings(ctx, map[string]string{"trust_proxy": "true"}); return err },
	}
	for name, fn := range cases {
		t.Run(name, func(t *testing.T) {
			if err := fn(); err != errStaleAuthorization {
				t.Fatal("stale request admitted", err)
			}
		})
	}
	if target.do("GET", "/api/me", nil) != 200 {
		t.Fatal("target session changed")
	}
	current, _ := e.s.userByID(t.Context(), tu.ID)
	if current.Role != roleUser || current.Disabled || current.MustChange {
		t.Fatal("target mutated")
	}
}
