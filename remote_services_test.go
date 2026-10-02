package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func saveTestServices(t *testing.T, e *testEnv, c *client, cfg serviceSettings) {
	t.Helper()
	r, b := c.req("PUT", "/api/admin/services", map[string]any{"password": adminPass, "settings": cfg})
	if r.StatusCode != 200 {
		t.Fatalf("save: %d %s", r.StatusCode, b)
	}
}
func testServices(t *testing.T, e *testEnv) serviceSettings {
	t.Helper()
	cfg, err := e.s.loadServices(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

// This endpoint verifies every SigV4 signature and the uploaded payload digest.
func fakeS3(t *testing.T) (*httptest.Server, *sync.Mutex, map[string][]byte) {
	t.Helper()
	objects := map[string][]byte{}
	mu := &sync.Mutex{}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parsed, err := time.Parse("20060102T150405Z", r.Header.Get("X-Amz-Date"))
		if err != nil {
			http.Error(w, "date", 403)
			return
		}
		expected := r.Clone(r.Context())
		u := *r.URL
		u.Host = r.Host
		u.Scheme = "http"
		expected.URL = &u
		c := &s3Client{accessKey: "test-access", secretKey: "test-secret", region: "us-east-1", now: func() time.Time { return parsed }}
		got := r.Header.Get("Authorization")
		c.sign(expected, r.Header.Get("X-Amz-Content-Sha256"), r.ContentLength)
		if got != expected.Header.Get("Authorization") {
			http.Error(w, "signature", 403)
			return
		}
		key := strings.TrimPrefix(r.URL.Path, "/backups/")
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Query().Get("list-type") == "2" {
			result := listResult{}
			for k, v := range objects {
				if strings.HasPrefix(k, r.URL.Query().Get("prefix")) {
					result.Contents = append(result.Contents, struct {
						Key          string    `xml:"Key"`
						Size         int64     `xml:"Size"`
						LastModified time.Time `xml:"LastModified"`
						ETag         string    `xml:"ETag"`
					}{k, int64(len(v)), time.Now(), "tag"})
				}
			}
			b, _ := xml.Marshal(result)
			w.Write(b)
			return
		}
		switch r.Method {
		case "PUT":
			b, _ := io.ReadAll(r.Body)
			sum := sha256.Sum256(b)
			if hex.EncodeToString(sum[:]) != r.Header.Get("X-Amz-Content-Sha256") {
				http.Error(w, "checksum", 400)
				return
			}
			objects[key] = b
			w.WriteHeader(200)
		case "GET":
			b, ok := objects[key]
			if !ok {
				w.WriteHeader(404)
				return
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(b)))
			w.Write(b)
		case "DELETE":
			delete(objects, key)
			w.WriteHeader(204)
		default:
			w.WriteHeader(400)
		}
	}))
	t.Cleanup(ts.Close)
	return ts, mu, objects
}
func fakeSMTP(t *testing.T) (emailSettings, <-chan string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	messages := make(chan string, 20)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(5 * time.Second))
				reader := bufio.NewReader(conn)
				fmt.Fprint(conn, "220 local test SMTP\r\n")
				for {
					line, err := reader.ReadString('\n')
					if err != nil {
						return
					}
					switch {
					case strings.HasPrefix(line, "EHLO"), strings.HasPrefix(line, "HELO"):
						fmt.Fprint(conn, "250 localhost\r\n")
					case strings.HasPrefix(line, "MAIL"), strings.HasPrefix(line, "RCPT"):
						fmt.Fprint(conn, "250 ok\r\n")
					case strings.HasPrefix(line, "DATA"):
						fmt.Fprint(conn, "354 send data\r\n")
						var body strings.Builder
						for {
							line, err = reader.ReadString('\n')
							if err != nil {
								return
							}
							if line == ".\r\n" {
								break
							}
							body.WriteString(line)
						}
						messages <- body.String()
						fmt.Fprint(conn, "250 queued\r\n")
					case strings.HasPrefix(line, "QUIT"):
						fmt.Fprint(conn, "221 bye\r\n")
						return
					default:
						fmt.Fprint(conn, "500 no\r\n")
					}
				}
			}()
		}
	}()
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	n, _ := strconv.Atoi(port)
	return emailSettings{Enabled: true, Host: host, Port: n, TLS: "none", From: "server@example.com", To: []string{"admin@example.com"}, OnSuccess: true, OnFailure: true}, messages
}
func TestRemoteServicesSecretsAndAccess(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	if st := anon.do("GET", "/api/admin/services", nil); st != 401 {
		t.Fatal(st)
	}
	admin := e.newClient()
	admin.login(adminName, adminPass)
	cfg := testServices(t, e)
	cfg.Remote.AccessKey = "test-access"
	cfg.Remote.SecretKey = "test-secret"
	cfg.Email.Password = "smtp-secret"
	saveTestServices(t, e, admin, cfg)
	_, b := admin.req("GET", "/api/admin/services", nil)
	for _, secret := range []string{"test-access", "test-secret", "smtp-secret"} {
		if strings.Contains(string(b), secret) {
			t.Fatal("secret in API")
		}
	}
	var raw string
	e.s.db.QueryRow(`SELECT value FROM instance_settings WHERE key='remote_services'`).Scan(&raw)
	if strings.Contains(raw, "test-secret") || strings.Contains(raw, "smtp-secret") {
		t.Fatal("plaintext in DB")
	}
	clear, err := e.s.loadServices(context.Background(), true)
	if err != nil || clear.Remote.SecretKey != "test-secret" {
		t.Fatal(clear, err)
	}
	cfg = testServices(t, e)
	cfg.Remote.AccessKey = ""
	cfg.Remote.SecretKey = ""
	cfg.Email.Password = ""
	saveTestServices(t, e, admin, cfg)
	clear, _ = e.s.loadServices(context.Background(), true)
	if clear.Remote.SecretKey != "test-secret" {
		t.Fatal("blank erased secret")
	}
	if st := admin.do("PUT", "/api/admin/services", map[string]any{"settings": cfg, "password": adminPass}); st != 409 {
		t.Fatal("stale update", st)
	}
	cfg = testServices(t, e)
	if st := admin.do("PUT", "/api/admin/services", map[string]any{"settings": cfg, "password": "wrong"}); st != 403 {
		t.Fatal("no reauth", st)
	}
	u, _ := e.s.createUser(context.Background(), "ordinary", string(e.s.cfg.passwordHash), roleUser, false)
	user := e.newClient()
	user.login(u.Username, adminPass)
	if st := user.do("GET", "/api/admin/services", nil); st != 403 {
		t.Fatal("user access", st)
	}
}
func TestRemoteBackupRoundTripRetentionAndEmail(t *testing.T) {
	e := newTestServer(t)
	admin := e.newClient()
	admin.login(adminName, adminPass)
	ts, mu, objects := fakeS3(t)
	smtp, mails := fakeSMTP(t)
	cfg := testServices(t, e)
	cfg.Remote.Enabled = true
	cfg.Remote.Endpoint = ts.URL
	cfg.Remote.AllowHTTP = true
	cfg.Remote.Bucket = "backups"
	cfg.Remote.AccessKey = "test-access"
	cfg.Remote.SecretKey = "test-secret"
	cfg.Remote.Keep = 1
	cfg.Email = smtp
	saveTestServices(t, e, admin, cfg)
	cfg, _ = e.s.loadServices(context.Background(), true)
	other := cfg.Remote.Prefix + "/backup-other-20200101T000000Z-0000000000000000.db"
	mu.Lock()
	objects[other] = []byte("keep me")
	objects[backupPrefix(cfg)+"notes.txt"] = []byte("keep too")
	mu.Unlock()
	for i := 0; i < 2; i++ {
		r, b := admin.req("POST", "/api/admin/services/action", map[string]string{"action": "backup", "password": adminPass})
		if r.StatusCode != 202 {
			t.Fatalf("backup %d %s", r.StatusCode, b)
		}
		e.s.serviceJobs.Wait()
		select {
		case msg := <-mails:
			if !strings.Contains(msg, "SHA-256 verified") || strings.Contains(msg, "test-secret") {
				t.Fatal(msg)
			}
		case <-time.After(time.Second):
			t.Fatal("no notification")
		}
	}
	mu.Lock()
	if len(objects) != 3 {
		t.Errorf("retention deleted wrong files: %v", objects)
	}
	if _, ok := objects[other]; !ok {
		t.Error("other instance deleted")
	}
	mu.Unlock()
	var key, status string
	e.s.db.QueryRow(`SELECT object_key,status FROM remote_backup_runs ORDER BY id DESC LIMIT 1`).Scan(&key, &status)
	if status != "success" {
		t.Fatal(status)
	}
	r, b := admin.req("POST", "/api/admin/services/action", map[string]string{"action": "download", "key": key, "password": adminPass})
	if r.StatusCode != 200 || !strings.HasPrefix(string(b), "SQLite format 3") {
		t.Fatalf("download %d %s", r.StatusCode, b[:min(len(b), 100)])
	}
	if st := admin.do("POST", "/api/admin/services/action", map[string]string{"action": "download", "key": other, "password": adminPass}); st != 400 {
		t.Fatal("ownership", st)
	}
	if st := admin.do("POST", "/api/admin/services/action", map[string]string{"action": "test_s3", "password": adminPass}); st != 200 {
		t.Fatal("connection probe", st)
	}
}
func TestRemoteBackupFailuresDoNotPrune(t *testing.T) {
	e := newTestServer(t)
	cfg := testServices(t, e)
	cfg.Remote.Endpoint = "http://127.0.0.1:1"
	cfg.Remote.Bucket = "backups"
	cfg.Remote.AccessKey = "test-access"
	cfg.Remote.SecretKey = "test-secret"
	id, err := e.s.startRemoteBackup(cfg, "test")
	if err != nil {
		t.Fatal(err)
	}
	e.s.serviceJobs.Wait()
	var status, message string
	e.s.db.QueryRow(`SELECT status,message FROM remote_backup_runs WHERE id=?`, id).Scan(&status, &message)
	if status != "failed" || message == "" {
		t.Fatal(status, message)
	}
	if _, err = os.Stat(backupDir(e.dbPath)); err != nil {
		t.Fatal(err)
	}
}
func TestServiceValidationAndSMTPFailClosed(t *testing.T) {
	cfg := serviceSettings{Remote: remoteSettings{IntervalHours: 24}, Email: emailSettings{Port: 587, TLS: "starttls"}}
	for _, endpoint := range []string{"http://s3.example", "https://user:password@s3.example", "https://s3.example/path", "https://s3.example?secret=x"} {
		cfg.Remote.Endpoint = endpoint
		if validateServices(cfg) == nil {
			t.Fatal("accepted", endpoint)
		}
	}
	cfg.Remote.Endpoint = ""
	cfg.Accounts.Registration = true
	if validateServices(cfg) == nil {
		t.Fatal("registration without email")
	}
	e := newTestServer(t)
	smtp, _ := fakeSMTP(t)
	smtp.TLS = "starttls"
	if err := e.s.sendNotification(context.Background(), smtp, "test", "body"); err == nil {
		t.Fatal("SMTP downgraded")
	}
	smtp.TLS = "none"
	smtp.Username = "user"
	smtp.Password = "secret"
	if err := e.s.sendNotification(context.Background(), smtp, "test", "body"); err == nil {
		t.Fatal("plaintext credentials")
	}
}
func tokenFromMail(t *testing.T, messages <-chan string, kind string) string {
	t.Helper()
	select {
	case m := <-messages:
		idx := strings.Index(m, "#"+kind+"=")
		if idx < 0 {
			t.Fatalf("no %s token in %s", kind, m)
		}
		rest := m[idx+len(kind)+2:]
		return strings.TrimSpace(strings.Split(rest, "\r\n")[0])
	case <-time.After(2 * time.Second):
		t.Fatal("email did not arrive")
	}
	return ""
}
func TestRegistrationVerificationRecoveryAndSingleUse(t *testing.T) {
	e := newTestServer(t)
	admin := e.newClient()
	admin.login(adminName, adminPass)
	smtp, mails := fakeSMTP(t)
	cfg := testServices(t, e)
	cfg.Email = smtp
	cfg.Accounts = accountSettings{Registration: true, Recovery: true, PublicURL: "https://jiggered.example.com"}
	saveTestServices(t, e, admin, cfg)
	c := e.newClient()
	r, b := c.req("POST", "/api/auth/register", map[string]string{"username": "newperson", "email": "person@example.com", "password": "newpassword1"})
	if r.StatusCode != 200 {
		t.Fatal(r.StatusCode, string(b))
	}
	if _, err := e.s.userByName(context.Background(), "newperson"); err == nil {
		t.Fatal("unverified account created")
	}
	token := tokenFromMail(t, mails, "verify")
	e.s.serviceJobs.Wait()
	if st := c.do("POST", "/api/auth/verify", map[string]string{"token": token}); st != 200 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/auth/verify", map[string]string{"token": token}); st != 400 {
		t.Fatal("token replay", st)
	}
	if where := c.login("newperson", "newpassword1"); where != "/" {
		t.Fatal(where)
	}
	if st := c.do("POST", "/api/auth/forgot-password", map[string]string{"email": "person@example.com"}); st != 200 {
		t.Fatal(st)
	}
	reset := tokenFromMail(t, mails, "reset")
	e.s.serviceJobs.Wait()
	_, bKnown := c.req("POST", "/api/auth/forgot-password", map[string]string{"email": "person@example.com"})
	_, bUnknown := c.req("POST", "/api/auth/forgot-password", map[string]string{"email": "missing@example.com"})
	if string(bKnown) != string(bUnknown) {
		t.Fatal("account enumeration")
	}
	tokenFromMail(t, mails, "reset")
	e.s.serviceJobs.Wait()
	// The later request invalidated the first reset link.
	if st := c.do("POST", "/api/auth/reset-password", map[string]string{"token": reset, "password": "replacement1"}); st != 400 {
		t.Fatal("old reset survived", st)
	}
	// Insert a known token to check single-use and session revocation independently of transport.
	u, _ := e.s.userByName(context.Background(), "newperson")
	old, _ := e.s.passwordHash(context.Background(), u.ID)
	e.s.db.Exec(`INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'reset',?,?,?)`, hashToken("test-reset"), u.ID, string(old), time.Now().Add(time.Minute).Unix())
	if st := c.do("POST", "/api/auth/reset-password", map[string]string{"token": "test-reset", "password": "replacement1"}); st != 200 {
		t.Fatal(st)
	}
	if st := c.do("GET", "/api/me", nil); st != 401 {
		t.Fatal("session survived", st)
	}
	e.s.publicLimit = newLoginLimiter(10, 15*time.Minute)
	if st := c.do("POST", "/api/auth/reset-password", map[string]string{"token": "test-reset", "password": "replacement2"}); st != 400 {
		t.Fatal("reset replay", st)
	}
	if where := c.login("newperson", "replacement1"); where != "/" {
		t.Fatal(where)
	}
}
func TestScheduleHonoursIntervalAndPause(t *testing.T) {
	e := newTestServer(t)
	admin := e.newClient()
	admin.login(adminName, adminPass)
	ts, _, _ := fakeS3(t)
	cfg := testServices(t, e)
	cfg.Remote.Enabled = true
	cfg.Remote.Endpoint = ts.URL
	cfg.Remote.AllowHTTP = true
	cfg.Remote.Bucket = "backups"
	cfg.Remote.AccessKey = "test-access"
	cfg.Remote.SecretKey = "test-secret"
	saveTestServices(t, e, admin, cfg)
	e.s.scheduleRemoteBackup(context.Background(), time.Now())
	var n int
	e.s.db.QueryRow(`SELECT count(*) FROM remote_backup_runs`).Scan(&n)
	if n != 0 {
		t.Fatal("immediate scheduled backup")
	}
	cfg = testServices(t, e)
	cfg.ScheduledFrom = time.Now().Add(-25 * time.Hour).Unix()
	b, _ := json.Marshal(cfg)
	e.s.db.Exec(`UPDATE instance_settings SET value=? WHERE key='remote_services'`, string(b))
	e.s.scheduleRemoteBackup(context.Background(), time.Now())
	e.s.serviceJobs.Wait()
	e.s.db.QueryRow(`SELECT count(*) FROM remote_backup_runs`).Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
	e.s.scheduleRemoteBackup(context.Background(), time.Now())
	e.s.serviceJobs.Wait()
	e.s.db.QueryRow(`SELECT count(*) FROM remote_backup_runs`).Scan(&n)
	if n != 1 {
		t.Fatal("repeated schedule", n)
	}
	cfg = testServices(t, e)
	cfg.Remote.Enabled = false
	cfg.Remote.AccessKey = ""
	cfg.Remote.SecretKey = ""
	saveTestServices(t, e, admin, cfg)
	e.s.scheduleRemoteBackup(context.Background(), time.Now().Add(48*time.Hour))
	e.s.db.QueryRow(`SELECT count(*) FROM remote_backup_runs`).Scan(&n)
	if n != 1 {
		t.Fatal("paused schedule", n)
	}
}
func TestS3CanonicalEncoding(t *testing.T) {
	u, _ := url.Parse("https://bucket.example/a%20b/x+y?z=a+b&a=x%2Fy")
	if canonicalPath(u) != "/a%20b/x%2By" || canonicalQuery(u) != "a=x%2Fy&z=a%20b" {
		t.Fatal(canonicalPath(u), canonicalQuery(u))
	}
}
