package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
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

// reservedUsernames are what the activity log calls the app itself and the command line; a person with one of
// them would be indistinguishable from those in the log.
var reservedUsernames = map[string]bool{"system": true, "cli": true}

func validUsername(s string) bool { return usernamePattern.MatchString(s) && !reservedUsernames[s] }

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
	verifiedHash []byte
	u            *user
	sid          string // public id of the calling session
	hash         string // its token hash
}

type authKey struct{}

func authOf(r *http.Request) *authInfo {
	a, _ := r.Context().Value(authKey{}).(*authInfo)
	return a
}

// lookup resolves the session cookie to a signed-in, enabled user, or nil.
func (s *server) lookup(r *http.Request) *authInfo {
	a, _ := s.lookupState(r)
	return a
}

// lookupState is lookup that also says when it couldn't tell: a database that fails to answer is not a session
// that doesn't exist, and signing everyone out over a hiccup would make the pages throw away their sign-in.
func (s *server) lookupState(r *http.Request) (a *authInfo, unavailable bool) {
	c, err := r.Cookie(cookieName)
	if err != nil || len(c.Value) != 64 {
		return nil, false
	}
	a = &authInfo{u: &user{}, hash: hashToken(c.Value)}
	var exp, seen int64
	var disabled, must int
	err = s.db.QueryRowContext(r.Context(), `
		SELECT u.id, u.username, u.role, u.disabled, u.must_change_password, s.sid, s.expires_at, s.last_seen_at
		FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, a.hash).
		Scan(&a.u.ID, &a.u.Username, &a.u.Role, &disabled, &must, &a.sid, &exp, &seen)
	now := time.Now().Unix()
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		log.Printf("looking up a session: %v", err)
		return nil, true
	}
	if err != nil || now >= exp || disabled != 0 {
		return nil, false
	}
	a.u.Disabled, a.u.MustChange = false, must != 0
	if now-seen > 300 {
		s.db.ExecContext(r.Context(), "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", now, a.hash)
	}
	return a, false
}

// While a password change is pending, these are the only API calls that work.
var mustChangeAllowed = map[string]bool{"GET /api/me": true, "POST /api/me/password": true}

func (s *server) requireAuth(next http.Handler) http.Handler { return s.guard(next, false) }

func (s *server) requireAdmin(next http.Handler) http.Handler { return s.guard(next, true) }

func (s *server) guard(next http.Handler, adminOnly bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a, unavailable := s.lookupState(r)
		if unavailable {
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
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
		if h := r.Header.Get("X-Jiggered-User"); isAPI && h != "" && h != strconv.FormatInt(a.u.ID, 10) {
			// The page was opened as someone else; the browser has since signed in as this account.
			http.Error(w, "signed out", http.StatusUnauthorized)
			return
		}
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
	if st := s.settings(); st.TrustProxy {
		parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		if i := len(parts) - st.ProxyHops; i >= 0 {
			if v := forwardedAddr(parts[i]); v != "" {
				host = v
			}
		}
	}
	return host
}

// sameSiteLogin refuses a sign-in that a page on another site made the browser send ("login CSRF": it would sign
// the visitor in to the attacker's account). Browsers that send Sec-Fetch-Site are already judged by rejectCrossSite;
// this covers the ones that don't, by comparing the Origin (or, failing that, the Referer) with the host being
// asked. A request with neither header (a script, or a privacy setting that strips them) is allowed: it can't have
// come from another site's page without one of them in any browser that matters here.
func (s *server) sameSiteLogin(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") != "" {
		return true
	}
	from := r.Header.Get("Origin")
	if from == "" {
		from = r.Header.Get("Referer")
	}
	if from == "" {
		return true
	}
	u, err := url.Parse(from)
	if err != nil || u.Host == "" {
		return false // "null" (a sandboxed or opaque origin) or garbage
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	if s.settings().TrustProxy { // behind a proxy that rewrites Host, the name the person typed is in X-Forwarded-Host
		for _, h := range strings.Split(r.Header.Get("X-Forwarded-Host"), ",") {
			if strings.EqualFold(u.Host, strings.TrimSpace(h)) {
				return true
			}
		}
	}
	return false
}

// forwardedAddr reads one X-Forwarded-For entry: a bare address, or one with a port as some proxies add it
// ("198.51.100.7:51234", "[2001:db8::7]:443"). It returns "" for anything else.
func forwardedAddr(v string) string {
	v = strings.TrimSpace(v)
	if net.ParseIP(v) != nil {
		return v
	}
	if host, _, err := net.SplitHostPort(v); err == nil && net.ParseIP(host) != nil {
		return host
	}
	if strings.HasPrefix(v, "[") && strings.HasSuffix(v, "]") && net.ParseIP(v[1:len(v)-1]) != nil {
		return v[1 : len(v)-1]
	}
	return ""
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
	if !s.sameSiteLogin(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	ip := s.clientIP(r)
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/login?e=bad", http.StatusSeeOther)
		return
	}
	ctx := r.Context()

	// Each guess is counted the moment it is allowed to start, not when its answer comes back. Otherwise a burst of
	// requests all pass the check before any failure is recorded, and "ten tries" turn into dozens. The count stands
	// as the failure; giveBack takes it out again when the password was right or was never checked.
	giveBackIP, ok := s.ipLimit.take(ipKey(ip))
	if !ok {
		http.Redirect(w, r, "/login?e=locked", http.StatusSeeOther)
		return
	}
	u, hash, err := s.loginUser(ctx, normUsername(r.PostFormValue("username")))
	if err != nil {
		giveBackIP()
		serverError(w, r, err)
		return
	}
	giveBackUser := func() {}
	locked := false
	if u == nil {
		hash = s.dummyHash // unknown name: still spend the bcrypt time, so timing doesn't reveal which names exist
	} else if give, ok := s.userLimit.take(u.Username); ok {
		giveBackUser = give
	} else {
		// A locked account answers exactly like a wrong password, after the same wait. Saying "locked" would tell
		// anyone who can send ten guesses which usernames exist.
		locked, hash = true, s.dummyHash
	}
	good, err := s.checkHash(hash, r.PostFormValue("password"))
	if err != nil {
		giveBackIP()
		giveBackUser()
		http.Redirect(w, r, "/login?e=busy", http.StatusSeeOther)
		return
	}
	if locked || !good || u == nil {
		if u != nil && !locked {
			s.audit(ctx, u.Username, "login_failed", u.Username, "", ip)
			log.Printf("failed login for %q from %s", u.Username, ip)
		} else {
			log.Printf("failed login from %s", ip) // never log the name typed: people paste passwords into it
		}
		http.Redirect(w, r, "/login?e=bad", http.StatusSeeOther)
		return
	}
	// The password was right, so this was not a failed guess. The address's earlier failures are left to age out
	// rather than cleared: otherwise anyone with an account could sign in between guesses to get unlimited tries
	// at other people's.
	giveBackIP()
	giveBackUser()
	if u.Disabled {
		s.audit(ctx, u.Username, "login_refused", u.Username, "account is disabled", ip)
		http.Redirect(w, r, "/login?e=disabled", http.StatusSeeOther)
		return
	}

	if pending, e := s.beginTwoFactor(w, r, u, hash); e != nil {
		serverError(w, r, e)
		return
	} else if pending {
		return
	}
	s.userLimit.reset(u.Username)
	token, exp, err := s.newSession(ctx, u.ID, hash, ip, r.UserAgent())
	if errors.Is(err, errStaleLogin) {
		log.Printf("sign-in for %q dropped: the account changed while the password was being checked", u.Username)
		http.Redirect(w, r, "/login?e=bad", http.StatusSeeOther)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	s.db.ExecContext(ctx, "UPDATE users SET last_login_at = ? WHERE id = ?", time.Now().Unix(), u.ID)
	s.audit(ctx, u.Username, "login", u.Username, "", ip)
	s.setSessionCookie(w, token, exp)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// maxSessionsPerUser is how many signed-in devices one account keeps; the oldest are signed out beyond it, so
// neither a login loop nor a forgotten script can make the table (or the device list) grow without bound.
const maxSessionsPerUser = 25

// errStaleLogin means the account changed between checking its password and creating the session.
var errStaleLogin = errors.New("the account changed while signing in")

// newSession starts a session for a sign-in that checked the password against `verified`. Checking takes ~300ms of
// bcrypt, and a password change, reset or disable that lands meanwhile has already ended the account's sessions;
// without this check the late one would be created anyway and outlive the revocation. So the insert only happens
// if the account still has the password that was checked and is still enabled.
func (s *server) newSession(ctx context.Context, userID int64, verified []byte, ip, ua string) (string, time.Time, error) {
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
	res, err := s.db.ExecContext(ctx, `INSERT INTO sessions(token_hash, sid, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
		SELECT ?, ?, id, ?, ?, ?, ?, ? FROM users WHERE id = ? AND password_hash = ? AND disabled = 0 AND NOT EXISTS (SELECT 1 FROM account_security a WHERE a.user_id=users.id AND a.enabled=1)`,
		hashToken(token), sid, now.Unix(), now.Unix(), exp.Unix(), ip, cleanText(ua, 200), userID, string(verified))
	if err != nil {
		return "", time.Time{}, err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return "", time.Time{}, errStaleLogin
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
		(SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC, rowid DESC LIMIT ?)`,
		userID, userID, maxSessionsPerUser); err != nil {
		log.Printf("trimming old sessions: %v", err) // the new session is fine; the next sign-in trims again
	}
	return token, exp, nil
}

func (s *server) setSessionCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", Expires: exp,
		HttpOnly: true, Secure: s.settings().SecureCookie, SameSite: http.SameSiteLaxMode,
	})
}

func (s *server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.settings().SecureCookie, SameSite: http.SameSiteLaxMode})
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

// take reserves one attempt for key before the password is checked, so that a burst of requests can't all pass a
// check that only counts finished failures. It reports false when the key has used up its budget. The reservation
// stands as the recorded failure; call giveBack when the attempt turns out fine (the password was right) or was
// never checked (the server was too busy).
func (l *loginLimiter) take(key string) (giveBack func(), ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.recent(key)) >= l.max {
		return nil, false
	}
	if _, known := l.fails[key]; !known && len(l.fails) >= limiterMaxKeys {
		l.sweepLocked()
		if len(l.fails) >= limiterMaxKeys {
			return func() {}, true // full of live entries: let it through untracked rather than grow without bound
		}
	}
	at := time.Now()
	l.fails[key] = append(l.recent(key), at)
	return func() { l.give(key, at) }, true
}

func (l *loginLimiter) give(key string, at time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	ts := l.fails[key]
	for i, t := range ts {
		if t.Equal(at) {
			ts = append(ts[:i], ts[i+1:]...)
			break
		}
	}
	if len(ts) == 0 {
		delete(l.fails, key)
		return
	}
	l.fails[key] = ts
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
