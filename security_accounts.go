package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

func verifiedPasswordTx(ctx context.Context, tx *sql.Tx, a *authInfo) error {
	var hash, role string
	err := tx.QueryRowContext(ctx, `SELECT password_hash,role FROM users WHERE id=? AND disabled=0`, a.u.ID).Scan(&hash, &role)
	if err != nil || hash != string(a.verifiedHash) || role != a.u.Role {
		return errors.New("Your account changed while this request was being authorised. Sign in and try again.")
	}
	return nil
}

func migrateSecurityAccounts(tx *sql.Tx, _ *seedAdmin) error {
	_, err := tx.Exec(`
 CREATE TABLE account_security(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email TEXT UNIQUE, secret TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT -1, pending_secret TEXT NOT NULL DEFAULT '', pending_until INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE recovery_codes(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, PRIMARY KEY(user_id,code_hash));
 CREATE TABLE auth_tokens(token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, payload TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL);
 CREATE TABLE login_challenges(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, password_hash TEXT NOT NULL, secret TEXT NOT NULL, ua TEXT NOT NULL, ip TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE remote_backup_runs (id INTEGER PRIMARY KEY, started INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, object_key TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '');
 CREATE INDEX auth_tokens_expiry ON auth_tokens(expires);
 CREATE INDEX login_challenges_expiry ON login_challenges(expires);
 `)
	return err
}
func (s *server) authPublic(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != "GET" && (r.Header.Get("X-Requested-With") != "jiggered" || !s.sameSiteLogin(r)) {
		http.Error(w, "forbidden", 403)
		return false
	}
	if _, ok := s.publicLimit.take(ipKey(s.clientIP(r))); !ok {
		jsonError(w, 429, "Too many requests. Wait 15 minutes before trying again.")
		return false
	}
	return true
}
func (s *server) publicAuthOptions(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.loadServices(r.Context(), false)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"registration": cfg.Accounts.Registration && cfg.Email.Enabled, "recovery": cfg.Accounts.Recovery && cfg.Email.Enabled})
}
func normalEmail(v string) (string, error) {
	v = strings.ToLower(strings.TrimSpace(v))
	a, err := mail.ParseAddress(v)
	if err != nil || a.Address != v || len(v) > 254 || strings.ContainsAny(v, "\r\n") {
		return "", errors.New("Enter a valid email address without a display name.")
	}
	return v, nil
}
func genericEmailResponse(w http.ResponseWriter) {
	writeJSON(w, 200, map[string]string{"message": "If this request is eligible, an email will arrive shortly. Check your inbox and spam folder."})
}

// Registration is a pending token only. No account or login exists until email ownership is proved.
func (s *server) registerAccount(w http.ResponseWriter, r *http.Request) {
	if !s.authPublic(w, r) {
		return
	}
	var in struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	cfg, err := s.loadServices(r.Context(), true)
	if err != nil || !cfg.Accounts.Registration || !cfg.Email.Enabled {
		jsonError(w, 403, "Registration is closed. Ask the person who runs this server for an account.")
		return
	}
	name := normUsername(in.Username)
	email, err := normalEmail(in.Email)
	if !validUsername(name) {
		jsonError(w, 400, "Use a username of up to 64 letters, digits or . _ @ + -.")
		return
	}
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	if err = checkPassword(in.Password, name); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	hash, err := s.hashPassword(in.Password)
	if err != nil {
		jsonError(w, 503, "Busy right now. Try again shortly.")
		return
	}
	token, err := randomHex(32)
	if err != nil {
		serverError(w, r, err)
		return
	}
	// Hash the submitted password even for a duplicate, and keep the public response identical.
	var n int
	err = s.db.QueryRowContext(r.Context(), `SELECT (SELECT count(*) FROM users WHERE username=?)+(SELECT count(*) FROM account_security WHERE email=?)`, name, email).Scan(&n)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if n == 0 {
		if _, ok := s.recoveryLimit.take("register:" + email); !ok {
			genericEmailResponse(w)
			return
		}
		var pending int
		if err = s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM auth_tokens WHERE expires>?`, time.Now().Unix()).Scan(&pending); err != nil {
			serverError(w, r, err)
			return
		}
		if pending >= 1000 {
			jsonError(w, 503, "Registration is busy. Try again later.")
			return
		}
		// A registration payload has fixed separators because usernames, addresses and bcrypt hashes cannot contain newlines.
		payload := name + "\n" + email + "\n" + hash
		s.db.ExecContext(r.Context(), `DELETE FROM auth_tokens WHERE purpose='register' AND substr(payload,1,instr(payload,char(10))-1)=?`, name)
		if _, err = s.db.ExecContext(r.Context(), `INSERT INTO auth_tokens(token_hash,purpose,payload,expires) VALUES(?,'register',?,?)`, hashToken(token), payload, time.Now().Add(30*time.Minute).Unix()); err != nil {
			serverError(w, r, err)
			return
		}
		s.queueAccountMail(cfg, email, "Verify your Jiggered account", "Confirm your email to create your account. This link expires in 30 minutes.", "verify", token)
	}
	genericEmailResponse(w)
}
func (s *server) forgotPassword(w http.ResponseWriter, r *http.Request) {
	if !s.authPublic(w, r) {
		return
	}
	var in struct {
		Email string `json:"email"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	cfg, err := s.loadServices(r.Context(), true)
	if err != nil || !cfg.Accounts.Recovery || !cfg.Email.Enabled {
		genericEmailResponse(w)
		return
	}
	email, _ := normalEmail(in.Email)
	var id int64
	var oldHash string
	err = s.db.QueryRowContext(r.Context(), `SELECT u.id,u.password_hash FROM users u JOIN account_security a ON a.user_id=u.id WHERE a.email=? AND u.disabled=0`, email).Scan(&id, &oldHash)
	if err == nil {
		if _, ok := s.recoveryLimit.take(fmt.Sprint(id)); ok {
			token, e := randomHex(32)
			if e != nil {
				serverError(w, r, e)
				return
			}
			tx, e := s.db.BeginTx(r.Context(), nil)
			if e != nil {
				serverError(w, r, e)
				return
			}
			defer tx.Rollback()
			if _, e = tx.ExecContext(r.Context(), `DELETE FROM auth_tokens WHERE user_id=? AND purpose='reset'`, id); e == nil {
				_, e = tx.ExecContext(r.Context(), `INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'reset',?,?,?)`, hashToken(token), id, oldHash, time.Now().Add(30*time.Minute).Unix())
			}
			if e != nil {
				serverError(w, r, e)
				return
			}
			if e = tx.Commit(); e != nil {
				serverError(w, r, e)
				return
			}
			s.queueAccountMail(cfg, email, "Reset your Jiggered password", "A password reset was requested. If it wasn't you, ignore this email. This link expires in 30 minutes. If two-step verification is enabled, you will also need an authenticator or recovery code.", "reset", token)
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		serverError(w, r, err)
		return
	}
	genericEmailResponse(w)
}
func (s *server) queueAccountMail(cfg serviceSettings, to, subject, body, kind, token string) {
	select {
	case s.mailSem <- struct{}{}:
	default:
		s.audit(context.Background(), "system", "account_email_failed", "", "email queue is busy", "")
		return
	}
	s.serviceJobs.Add(1)
	go func() {
		defer s.serviceJobs.Done()
		defer func() { <-s.mailSem }()
		parent := s.serviceCtx
		if parent == nil {
			parent = context.Background()
		}
		ctx, cancel := context.WithTimeout(parent, 25*time.Second)
		defer cancel()
		cfg.Email.To = []string{to}
		link := strings.TrimRight(cfg.Accounts.PublicURL, "/") + "/login#" + kind + "=" + token
		if err := s.sendNotification(ctx, cfg.Email, subject, body+"\n\n"+link); err != nil {
			s.audit(ctx, "system", "account_email_failed", "", "SMTP delivery failed; check email configuration", "")
		}
	}()
}
func (s *server) verifyEmailToken(w http.ResponseWriter, r *http.Request) {
	if !s.authPublic(w, r) {
		return
	}
	var in struct {
		Token string `json:"token"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	cfg, err := s.loadServices(r.Context(), false)
	if err != nil {
		serverError(w, r, err)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer tx.Rollback()
	var purpose, payload string
	var uid sql.NullInt64
	err = tx.QueryRowContext(r.Context(), `SELECT purpose,payload,user_id FROM auth_tokens WHERE token_hash=? AND expires>? AND purpose IN ('register','email')`, hashToken(in.Token), time.Now().Unix()).Scan(&purpose, &payload, &uid)
	if err != nil {
		jsonError(w, 400, "This verification link has expired or was already used. Request a new one.")
		return
	}
	if purpose == "register" {
		if !cfg.Accounts.Registration || !cfg.Email.Enabled {
			jsonError(w, 403, "Registration has been closed by the administrator.")
			return
		}
		parts := strings.Split(payload, "\n")
		if len(parts) != 3 {
			jsonError(w, 400, "Invalid verification link.")
			return
		}
		row, e := tx.ExecContext(r.Context(), `INSERT INTO users(username,password_hash,role,must_change_password,created_at) VALUES(?,?,'user',0,?)`, parts[0], parts[2], time.Now().Unix())
		if e != nil {
			jsonError(w, 409, "This account cannot be created. Ask the server administrator for help.")
			return
		}
		id, e := row.LastInsertId()
		if e != nil {
			serverError(w, r, e)
			return
		}
		if _, e = tx.ExecContext(r.Context(), `INSERT INTO account_security(user_id,email) VALUES(?,?)`, id, parts[1]); e != nil {
			jsonError(w, 409, "This account cannot be created. Ask the server administrator for help.")
			return
		}
	} else {
		// Email changes are tied to the password used when requested, so an account reset invalidates them too.
		parts := strings.Split(payload, "\n")
		if len(parts) != 2 {
			jsonError(w, 400, "Invalid verification link.")
			return
		}
		var current string
		if e := tx.QueryRowContext(r.Context(), `SELECT password_hash FROM users WHERE id=? AND disabled=0`, uid.Int64).Scan(&current); e != nil || current != parts[1] {
			jsonError(w, 400, "This verification link is no longer valid.")
			return
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO account_security(user_id,email) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email`, uid.Int64, parts[0]); err != nil {
			jsonError(w, 409, "This email cannot be attached to the account.")
			return
		}
		if _, err = tx.ExecContext(r.Context(), `DELETE FROM auth_tokens WHERE user_id=? AND purpose IN ('email','reset')`, uid.Int64); err != nil {
			serverError(w, r, err)
			return
		}
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM auth_tokens WHERE token_hash=?`, hashToken(in.Token)); err != nil {
		serverError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		serverError(w, r, err)
		return
	}
	s.audit(r.Context(), "system", "email_verified", "", "email ownership verified", s.clientIP(r))
	writeJSON(w, 200, map[string]string{"message": "Email verified. You can now sign in."})
}
func (s *server) resetPasswordToken(w http.ResponseWriter, r *http.Request) {
	if !s.authPublic(w, r) {
		return
	}
	var in struct {
		Token    string `json:"token"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	cfg, err := s.loadServices(r.Context(), false)
	if err != nil || !cfg.Accounts.Recovery || !cfg.Email.Enabled {
		jsonError(w, 403, "Email recovery is disabled. Ask the server administrator for help.")
		return
	}
	if err = checkPassword(in.Password, ""); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	hash, err := s.hashPassword(in.Password)
	if err != nil {
		jsonError(w, 503, "Busy right now. Try again shortly.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer tx.Rollback()
	var id int64
	var oldHash, name string
	err = tx.QueryRowContext(r.Context(), `SELECT u.id,t.payload,u.username FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.purpose='reset' AND t.expires>? AND u.disabled=0 AND u.password_hash=t.payload`, hashToken(in.Token), time.Now().Unix()).Scan(&id, &oldHash, &name)
	if err != nil {
		jsonError(w, 400, "This reset link has expired or was already used. Request a new one.")
		return
	}
	if err = checkPassword(in.Password, name); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	giveFactor, ok := s.userLimit.take("2fa:" + name)
	if !ok {
		jsonError(w, 429, "Too many code attempts. Wait 15 minutes.")
		return
	}
	if err = s.consumeFactor(r.Context(), tx, id, in.Code, true); err != nil {
		jsonError(w, 400, "Enter your current authenticator code or an unused recovery code. Two-step verification stays enabled.")
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND password_hash=?`, hash, id, oldHash); err != nil {
		serverError(w, r, err)
		return
	}
	for _, q := range []string{`DELETE FROM sessions WHERE user_id=?`, `DELETE FROM auth_tokens WHERE user_id=?`, `DELETE FROM login_challenges WHERE user_id=?`} {
		if _, err = tx.ExecContext(r.Context(), q, id); err != nil {
			serverError(w, r, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		serverError(w, r, err)
		return
	}
	giveFactor()
	s.audit(r.Context(), name, "password_recovered", name, "all sessions revoked; two-step preserved", s.clientIP(r))
	writeJSON(w, 200, map[string]string{"message": "Password changed. All devices were signed out. Sign in with your new password."})
}
func (s *server) securityStatus(w http.ResponseWriter, r *http.Request) {
	var email sql.NullString
	var enabled, left int
	err := s.db.QueryRowContext(r.Context(), `SELECT email,enabled FROM account_security WHERE user_id=?`, authOf(r).u.ID).Scan(&email, &enabled)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		serverError(w, r, err)
		return
	}
	s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM recovery_codes WHERE user_id=?`, authOf(r).u.ID).Scan(&left)
	cfg, e := s.loadServices(r.Context(), false)
	if e != nil {
		serverError(w, r, e)
		return
	}
	writeJSON(w, 200, map[string]any{"email": email.String, "two_factor": enabled == 1, "recovery_codes_left": left, "email_available": cfg.Email.Enabled && cfg.Accounts.PublicURL != "", "recovery_enabled": cfg.Accounts.Recovery})
}
func (s *server) requestRecoveryEmail(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	var in struct {
		Password string `json:"password"`
		Email    string `json:"email"`
	}
	if !readJSON(w, r, &in) || !s.verifyOwnPassword(w, r, a.u, in.Password) {
		return
	}
	if _, ok := s.recoveryLimit.take("email:" + fmt.Sprint(a.u.ID)); !ok {
		jsonError(w, 429, "Too many verification requests. Wait 15 minutes.")
		return
	}
	email, err := normalEmail(in.Email)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	cfg, err := s.loadServices(r.Context(), true)
	if err != nil || !cfg.Email.Enabled || cfg.Accounts.PublicURL == "" {
		jsonError(w, 400, "The administrator must configure email and the public application URL first.")
		return
	}
	token, err := randomHex(32)
	if err != nil {
		serverError(w, r, err)
		return
	}
	current := a.verifiedHash
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer tx.Rollback()
	if err = verifiedPasswordTx(r.Context(), tx, a); err != nil {
		jsonError(w, 409, err.Error())
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM auth_tokens WHERE user_id=? AND purpose='email'`, a.u.ID); err == nil {
		_, err = tx.ExecContext(r.Context(), `INSERT INTO auth_tokens(token_hash,purpose,user_id,payload,expires) VALUES(?,'email',?,?,?)`, hashToken(token), a.u.ID, email+"\n"+string(current), time.Now().Add(30*time.Minute).Unix())
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		serverError(w, r, err)
		return
	}
	s.queueAccountMail(cfg, email, "Verify your Jiggered recovery email", "Confirm this email address for your account. It will replace your previous verified address. This link expires in 30 minutes.", "verify", token)
	writeJSON(w, 200, map[string]string{"message": "Verification email requested. Your current address stays active until the new one is verified."})
}
