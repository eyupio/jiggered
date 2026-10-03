package main

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// selfSignedCert is a throwaway certificate for 127.0.0.1, so a test can speak implicit TLS like a real relay.
// The PEM is written where the process's certificate verifier reads it (SSL_CERT_FILE); nothing else in the test
// process does TLS verification, so the trust store is otherwise empty.
func selfSignedCert(t *testing.T) tls.Certificate {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, err := rand.Int(rand.Reader, big.NewInt(1<<30))
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatal(err)
	}
	pemPath := filepath.Join(t.TempDir(), "test-relay.pem")
	if err := os.WriteFile(pemPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SSL_CERT_FILE", pemPath)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: priv}
}

// scriptedSMTP answers like a mail server until it reaches fail, where it refuses instead. The stage names match
// the point in the dialogue each error message in notifications.go is written for.
func scriptedSMTP(t *testing.T, fail string) emailSettings {
	t.Helper()
	switch fail {
	case "connect": // a port nothing is listening on
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := ln.Addr().(*net.TCPAddr).Port
		ln.Close()
		return emailSettings{Enabled: true, Host: "127.0.0.1", Port: port, TLS: "none", From: "server@example.com", To: []string{"to@example.com"}}
	case "unconfigured":
		return emailSettings{}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	// Credentials are only allowed over TLS, so the authentication stage needs a real TLS listener.
	if fail == "auth" {
		ln = tls.NewListener(ln, &tls.Config{Certificates: []tls.Certificate{selfSignedCert(t)}})
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				if fail == "greeting" {
					return // say nothing and hang up: the greeting never arrives
				}
				conn.SetDeadline(time.Now().Add(10 * time.Second))
				r := bufio.NewReader(conn)
				write := func(s string) { conn.Write([]byte(s)) }
				write("220 local test SMTP\r\n")
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					cmd := strings.ToUpper(strings.TrimSpace(line))
					switch {
					case strings.HasPrefix(cmd, "EHLO"):
						// No STARTTLS is advertised, so the starttls case can find it missing; AUTH is.
						if fail == "ehlo" {
							write("500 no\r\n")
						} else {
							write("250-local\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n")
						}
					case strings.HasPrefix(cmd, "HELO"):
						if fail == "ehlo" {
							write("500 no\r\n")
						} else {
							write("250 ok\r\n")
						}
					case strings.HasPrefix(cmd, "AUTH"):
						if fail == "auth" {
							write("535 authentication refused\r\n")
						} else {
							write("235 ok\r\n")
						}
					case strings.HasPrefix(cmd, "MAIL"):
						if fail == "mail" {
							write("550 no\r\n")
						} else {
							write("250 ok\r\n")
						}
					case strings.HasPrefix(cmd, "RCPT"):
						if fail == "rcpt" {
							write("550 no\r\n")
						} else {
							write("250 ok\r\n")
						}
					case strings.HasPrefix(cmd, "DATA"):
						if fail == "data" {
							write("554 no\r\n")
							return
						}
						write("354 go\r\n")
						for { // swallow the message itself, then answer the lone dot
							body, err := r.ReadString('\n')
							if err != nil {
								return
							}
							if strings.TrimSpace(body) == "." {
								if fail == "dot" {
									write("554 no\r\n")
								} else {
									write("250 ok\r\n")
								}
								break
							}
						}
					case strings.HasPrefix(cmd, "QUIT"):
						write("221 bye\r\n")
						return
					default:
						write("250 ok\r\n")
					}
				}
			}()
		}
	}()
	out := emailSettings{Enabled: true, Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port, TLS: "none", From: "server@example.com", To: []string{"to@example.com"}}
	if fail == "auth" {
		out.TLS = "tls"
	}
	return out
}

func TestSendNotificationReportsEachSMTPFailure(t *testing.T) {
	e := newTestServer(t)
	cases := []struct {
		fail, tls, username, want string
	}{
		{"unconfigured", "none", "", "Save an SMTP host, sender and recipients first"},
		{"connect", "none", "", "Could not connect to the SMTP server"},
		{"greeting", "none", "", "SMTP greeting failed"},
		{"ehlo", "none", "", "SMTP rejected the sender address"},
		{"auth", "tls", "someone", "SMTP authentication was refused"},
		{"mail", "none", "", "SMTP rejected the sender address"},
		{"rcpt", "none", "", "SMTP rejected a recipient address"},
		{"data", "none", "", "SMTP refused the message"},
		{"dot", "none", "", "SMTP did not accept the message"},
		{"", "starttls", "", "This SMTP server does not offer STARTTLS"},
	}
	for _, tc := range cases {
		t.Run(tc.fail+"/"+tc.tls, func(t *testing.T) {
			cfg := scriptedSMTP(t, tc.fail)
			cfg.TLS = tc.tls
			cfg.Username = tc.username
			if tc.username != "" {
				cfg.Password = "secret"
			}
			err := e.s.sendNotification(context.Background(), cfg, "Jiggered test", "No health data is included.")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("failure at %s = %v, want %q", tc.fail, err, tc.want)
			}
		})
	}
}

func TestSendNotificationSucceedsAgainstARelay(t *testing.T) {
	e := newTestServer(t)
	cfg := scriptedSMTP(t, "")
	if err := e.s.sendBrandedNotification(context.Background(), cfg, "Jiggered test", "No health data is included.", "https://example.com/login", "Sign in"); err != nil {
		t.Fatal(err)
	}
	if err := e.s.sendNotification(context.Background(), cfg, "Jiggered test", "No health data is included."); err != nil {
		t.Fatal(err)
	}
}

// mailStatus is the admin's only window into the account mail queue.
func TestMailStatusReportsRecentDeliveries(t *testing.T) {
	e := newTestServer(t)
	now := time.Now().Unix()
	for _, status := range []string{"queued", "sending", "accepted", "failed", "expired"} {
		if _, err := e.s.db.Exec(`INSERT INTO account_mail_deliveries(purpose,created,expires,next_at,attempts,status,token_hash,payload,error_category) VALUES('verify',?,?,?,2,?,'t','p','the reason')`, now, now, now, status); err != nil {
			t.Fatal(err)
		}
	}
	out, err := e.s.mailStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 5 {
		t.Fatalf("rows = %d", len(out))
	}
	// Newest first, with everything the admin page shows.
	if out[0]["status"] != "expired" || out[0]["purpose"] != "verify" || out[0]["error_category"] != "the reason" {
		t.Fatalf("newest row = %v", out[0])
	}
	for _, row := range out {
		if row["created"] == nil || row["attempts"] == nil || row["next_at"] == nil {
			t.Fatalf("incomplete row: %v", row)
		}
	}
}
