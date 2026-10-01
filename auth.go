package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"math/big"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost is a variable so tests can use a cheap one.
var bcryptCost = 12

const (
	roleAdmin = "admin"
	roleUser  = "user"

	minPasswordLen   = 8
	maxPasswordBytes = 72 // bcrypt ignores or rejects anything longer
	maxHashing       = 4  // concurrent bcrypt runs; each one costs ~250ms of CPU
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._@+-]{0,63}$`)

func normUsername(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validUsername(s string) bool { return usernamePattern.MatchString(s) }

func checkPassword(pw, username string) error {
	switch {
	case utf8.RuneCountInString(pw) < minPasswordLen:
		return errors.New("Password must be at least 8 characters.")
	case len(pw) > maxPasswordBytes:
		return errors.New("Password must be 72 bytes or fewer.")
	case strings.EqualFold(pw, username):
		return errors.New("Password can't be the same as the username.")
	}
	return nil
}

// Unambiguous characters only (no 0/O, 1/l/I), so a temporary password can be read out or retyped.
const tempAlphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// tempPassword returns something like "k3Mx-9tqD-aWn4-Rj7p" (16 random characters).
func tempPassword() (string, error) {
	var b strings.Builder
	max := big.NewInt(int64(len(tempAlphabet)))
	for i := 0; i < 16; i++ {
		if i > 0 && i%4 == 0 {
			b.WriteByte('-')
		}
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(tempAlphabet[n.Int64()])
	}
	return b.String(), nil
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

func randomHex(n int) (string, error) {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

// ---- who is calling ----

type authInfo struct {
	u    *user
	sid  string // public id of the calling session
	hash string // its token hash
}

type authKey struct{}

func authOf(r *http.Request) *authInfo {
	a, _ := r.Context().Value(authKey{}).(*authInfo)
	return a
}

// lookup resolves the session cookie to a signed-in, enabled user, or nil.
func (s *server) lookup(r *http.Request) *authInfo {
	c, err := r.Cookie(cookieName)
	if err != nil || len(c.Value) != 64 {
		return nil
	}
	a := &authInfo{u: &user{}, hash: hashToken(c.Value)}
	var exp, seen int64
	var disabled, must int
	err = s.db.QueryRowContext(r.Context(), `
		SELECT u.id, u.username, u.role, u.disabled, u.must_change_password, s.sid, s.expires_at, s.last_seen_at
		FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, a.hash).
		Scan(&a.u.ID, &a.u.Username, &a.u.Role, &disabled, &must, &a.sid, &exp, &seen)
	now := time.Now().Unix()
	if err != nil || now >= exp || disabled != 0 {
		return nil
	}
	a.u.Disabled, a.u.MustChange = false, must != 0
	if now-seen > 300 {
		s.db.ExecContext(r.Context(), "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", now, a.hash)
	}
	return a
}

// While a password change is pending, these are the only API calls that work.
var mustChangeAllowed = map[string]bool{"GET /api/me": true, "POST /api/me/password": true}

func (s *server) requireAuth(next http.Handler) http.Handler { return s.guard(next, false) }

func (s *server) requireAdmin(next http.Handler) http.Handler { return s.guard(next, true) }

func (s *server) guard(next http.Handler, adminOnly bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a := s.lookup(r)
		if a == nil {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.Error(w, "signed out", http.StatusUnauthorized)
				return
			}
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		// Writes must come from our own page (custom header can't be sent cross-site without CORS).
		if r.Method != http.MethodGet && r.Header.Get("X-Requested-With") != "jiggered" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		isAPI := strings.HasPrefix(r.URL.Path, "/api/")
		if a.u.MustChange && isAPI && !mustChangeAllowed[r.Method+" "+r.URL.Path] {
			jsonError(w, http.StatusForbidden, "Choose a new password before doing anything else.")
			return
		}
		if adminOnly && a.u.Role != roleAdmin {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authKey{}, a)))
	})
}

// ---- client address ----

// clientIP is the caller's address. Behind a reverse proxy (APP_TRUST_PROXY) it
// is the entry the proxy itself appended to X-Forwarded-For, counted from the
// right: anything further left was supplied by the client and can be rotated
// at will.
func (s *server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if s.cfg.trustProxy {
		parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		if i := len(parts) - s.cfg.proxyHops; i >= 0 {
			if v := strings.TrimSpace(parts[i]); net.ParseIP(v) != nil {
				host = v
			}
		}
	}
	return host
}

// ipKey is what the limiter counts: a whole /64 for IPv6, since one machine
// can hold millions of addresses in it.
func ipKey(ip string) string {
	p := net.ParseIP(ip)
	switch {
	case p == nil:
		return ip
	case p.To4() != nil:
		return p.To4().String()
	}
	return p.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// ---- login ----

var errBusy = errors.New("too many sign-ins at once")

// checkHash compares a password with a bcrypt hash, with at most maxHashing
// of these in flight so a flood of logins can't pin every CPU.
func (s *server) checkHash(hash []byte, pw string) (bool, error) {
	select {
	case s.hashSem <- struct{}{}:
		defer func() { <-s.hashSem }()
	case <-time.After(5 * time.Second):
		return false, errBusy
	}
	return bcrypt.CompareHashAndPassword(hash, []byte(pw)) == nil, nil
}

func (s *server) hashPassword(pw string) (string, error) {
	select {
	case s.hashSem <- struct{}{}:
		defer func() { <-s.hashSem }()
	case <-time.After(5 * time.Second):
		return "", errBusy
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	return string(h), err
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	if !s.ipLimit.allow(ipKey(ip)) {
		http.Redirect(w, r, "/login?e=locked", http.StatusSeeOther)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/login?e=bad", http.StatusSeeOther)
		return
	}
	ctx := r.Context()
	u, hash, err := s.loginUser(ctx, normUsername(r.PostFormValue("username")))
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if u == nil {
		hash = s.dummyHash // unknown name: still spend the bcrypt time, so timing doesn't reveal which names exist
	} else if !s.userLimit.allow(u.Username) {
		http.Redirect(w, r, "/login?e=locked", http.StatusSeeOther)
		return
	}
	ok, err := s.checkHash(hash, r.PostFormValue("password"))
	if err != nil {
		http.Redirect(w, r, "/login?e=busy", http.StatusSeeOther)
		return
	}
	if !ok || u == nil {
		s.ipLimit.fail(ipKey(ip))
		if u != nil {
			s.userLimit.fail(u.Username)
			s.audit(ctx, u.Username, "login_failed", u.Username, "", ip)
			log.Printf("failed login for %q from %s", u.Username, ip)
		} else {
			log.Printf("failed login from %s", ip) // never log the name typed: people paste passwords into it
		}
		http.Redirect(w, r, "/login?e=bad", http.StatusSeeOther)
		return
	}
	if u.Disabled {
		s.audit(ctx, u.Username, "login_refused", u.Username, "account is disabled", ip)
		http.Redirect(w, r, "/login?e=disabled", http.StatusSeeOther)
		return
	}
	s.userLimit.reset(u.Username)
	// The IP's failures are left to age out rather than cleared: otherwise anyone
	// with an account could log in between guesses to get unlimited tries at others.

	token, exp, err := s.newSession(ctx, u.ID, ip, r.UserAgent())
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	s.db.ExecContext(ctx, "UPDATE users SET last_login_at = ? WHERE id = ?", time.Now().Unix(), u.ID)
	s.audit(ctx, u.Username, "login", u.Username, "", ip)
	s.setSessionCookie(w, token, exp)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) newSession(ctx context.Context, userID int64, ip, ua string) (string, time.Time, error) {
	token, err := randomHex(32)
	if err != nil {
		return "", time.Time{}, err
	}
	sid, err := randomHex(8)
	if err != nil {
		return "", time.Time{}, err
	}
	now := time.Now()
	exp := now.Add(sessionTTL)
	_, err = s.db.ExecContext(ctx, `INSERT INTO sessions(token_hash, sid, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, hashToken(token), sid, userID, now.Unix(), now.Unix(), exp.Unix(), ip, cleanText(ua, 200))
	return token, exp, err
}

func (s *server) setSessionCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", Expires: exp,
		HttpOnly: true, Secure: s.cfg.secureCookie, SameSite: http.SameSiteLaxMode,
	})
}

func (s *server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.secureCookie, SameSite: http.SameSiteLaxMode})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash = ?", hashToken(c.Value))
	}
	s.clearSessionCookie(w)
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

// cleanText trims s to n bytes of printable text for storing what a client told us about itself.
func cleanText(s string, n int) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, s)
	if len(s) > n {
		s = strings.ToValidUTF8(s[:n], "")
	}
	return s
}

// loginLimiter allows `max` failures per key per window.
type loginLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	fails  map[string][]time.Time
}

const limiterMaxKeys = 50000

func newLoginLimiter(max int, window time.Duration) *loginLimiter {
	return &loginLimiter{max: max, window: window, fails: map[string][]time.Time{}}
}

func (l *loginLimiter) recent(key string) []time.Time {
	cut := time.Now().Add(-l.window)
	kept := l.fails[key][:0]
	for _, t := range l.fails[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.fails, key)
		return nil
	}
	l.fails[key] = kept
	return kept
}

func (l *loginLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.recent(key)) < l.max
}

func (l *loginLimiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, known := l.fails[key]; !known && len(l.fails) >= limiterMaxKeys {
		l.sweepLocked()
		if len(l.fails) >= limiterMaxKeys {
			return // full of live entries: stop tracking newcomers rather than grow without bound
		}
	}
	l.fails[key] = append(l.recent(key), time.Now())
}

func (l *loginLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, key)
}

// sweep forgets keys whose failures have all aged out; keys that never come back would otherwise stay forever.
func (l *loginLimiter) sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweepLocked()
}

func (l *loginLimiter) sweepLocked() {
	for key := range l.fails {
		l.recent(key)
	}
}
