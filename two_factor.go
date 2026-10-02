package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/jnnngs/jiggered/internal/qr"
)

// A code advances the stored step atomically. Recovery codes are single-use hashes.
func (s *server) consumeFactor(ctx context.Context, tx *sql.Tx, id int64, code string, optional bool) error {
	var secret string
	var enabled int
	var last int64
	err := tx.QueryRowContext(ctx, `SELECT secret,enabled,last_step FROM account_security WHERE user_id=?`, id).Scan(&secret, &enabled, &last)
	if errors.Is(err, sql.ErrNoRows) || err == nil && enabled == 0 {
		if optional {
			return nil
		}
		return errors.New("Two-step verification is not enabled.")
	}
	if err != nil {
		return err
	}
	if looksLikeRecoveryCode(code) {
		res, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE user_id=? AND code_hash=?`, id, hashToken(normaliseCode(code)))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			return nil
		}
		return errors.New("Invalid or used recovery code.")
	}
	plain, err := s.cryptSecret(secret, false)
	if err != nil {
		return err
	}
	step, ok := matchTOTP(plain, code, time.Now())
	if !ok || step <= last {
		return errors.New("Invalid or used authenticator code.")
	}
	res, err := tx.ExecContext(ctx, `UPDATE account_security SET last_step=? WHERE user_id=? AND last_step<? AND enabled=1`, step, id, step)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return errors.New("This code was already used.")
	}
	return nil
}
func (s *server) beginTwoFactor(w http.ResponseWriter, r *http.Request, u *user, hash []byte) (bool, error) {
	var secret string
	err := s.db.QueryRowContext(r.Context(), `SELECT secret FROM account_security WHERE user_id=? AND enabled=1`, u.ID).Scan(&secret)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	token, err := randomHex(32)
	if err != nil {
		return false, err
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	// One pending login per user keeps challenge storage bounded; restarting sign-in replaces it.
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM login_challenges WHERE user_id=?`, u.ID); err == nil {
		_, err = tx.ExecContext(r.Context(), `INSERT INTO login_challenges(token_hash,user_id,password_hash,secret,ua,ip,expires) VALUES(?,?,?,?,?,?,?)`, hashToken(token), u.ID, string(hash), secret, cleanText(r.UserAgent(), 200), ipKey(s.clientIP(r)), time.Now().Add(5*time.Minute).Unix())
	}
	if err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	http.SetCookie(w, &http.Cookie{Name: "jiggered_challenge", Value: token, Path: "/", MaxAge: 300, HttpOnly: true, Secure: s.settings().SecureCookie, SameSite: http.SameSiteStrictMode})
	http.Redirect(w, r, "/login?step=2", http.StatusSeeOther)
	return true, nil
}
func (s *server) finishTwoFactor(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Requested-With") != "jiggered" || !s.sameSiteLogin(r) {
		http.Error(w, "forbidden", 403)
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	cookie, err := r.Cookie("jiggered_challenge")
	if err != nil || len(cookie.Value) != 64 {
		jsonError(w, 400, "Sign-in expired. Enter your username and password again.")
		return
	}
	giveIP, ok := s.ipLimit.take(ipKey(s.clientIP(r)))
	if !ok {
		jsonError(w, 429, "Too many attempts. Wait 15 minutes.")
		return
	}
	// Attempts persist even when the transaction below rolls back on a wrong code.
	res, err := s.db.ExecContext(r.Context(), `UPDATE login_challenges SET attempts=attempts+1 WHERE token_hash=? AND expires>? AND attempts<5 AND ua=? AND ip=?`, hashToken(cookie.Value), time.Now().Unix(), cleanText(r.UserAgent(), 200), ipKey(s.clientIP(r)))
	if err != nil {
		serverError(w, r, err)
		return
	}
	if n, _ := res.RowsAffected(); n != 1 {
		jsonError(w, 400, "Sign-in expired. Enter your username and password again.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer tx.Rollback()
	var id int64
	var name, verified, secret string
	err = tx.QueryRowContext(r.Context(), `SELECT u.id,u.username,c.password_hash,c.secret FROM login_challenges c JOIN users u ON u.id=c.user_id JOIN account_security a ON a.user_id=u.id WHERE c.token_hash=? AND c.expires>? AND u.disabled=0 AND u.password_hash=c.password_hash AND a.enabled=1 AND a.secret=c.secret`, hashToken(cookie.Value), time.Now().Unix()).Scan(&id, &name, &verified, &secret)
	if err != nil {
		jsonError(w, 400, "Sign-in expired. Enter your username and password again.")
		return
	}
	giveUser, ok := s.userLimit.take("2fa:" + name)
	if !ok {
		jsonError(w, 429, "Too many code attempts. Wait 15 minutes.")
		return
	}
	if err = s.consumeFactor(r.Context(), tx, id, in.Code, false); err != nil {
		jsonError(w, 400, "That code is invalid or already used. Enter the current code or an unused recovery code.")
		return
	}
	token, err := randomHex(32)
	if err != nil {
		serverError(w, r, err)
		return
	}
	sid, err := randomHex(8)
	if err != nil {
		serverError(w, r, err)
		return
	}
	now := time.Now()
	exp := now.Add(sessionTTL)
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO sessions(token_hash,sid,user_id,created_at,last_seen_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?,?,?)`, hashToken(token), sid, id, now.Unix(), now.Unix(), exp.Unix(), s.clientIP(r), cleanText(r.UserAgent(), 200)); err != nil {
		serverError(w, r, err)
		return
	}
	for _, q := range []string{`DELETE FROM login_challenges WHERE user_id=?`, `UPDATE users SET last_login_at=strftime('%s','now') WHERE id=?`} {
		if _, err = tx.ExecContext(r.Context(), q, id); err != nil {
			serverError(w, r, err)
			return
		}
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY last_seen_at DESC,rowid DESC LIMIT ?)`, id, id, maxSessionsPerUser); err != nil {
		serverError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		serverError(w, r, err)
		return
	}
	giveIP()
	giveUser()
	s.userLimit.reset(name)
	s.setSessionCookie(w, token, exp)
	http.SetCookie(w, &http.Cookie{Name: "jiggered_challenge", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.settings().SecureCookie, SameSite: http.SameSiteStrictMode})
	s.audit(r.Context(), name, "login", name, "two-step verified", s.clientIP(r))
	writeJSON(w, 200, map[string]string{"message": "Signed in."})
}
func (s *server) twoFactorAction(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	var in struct {
		Action   string `json:"action"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !readJSON(w, r, &in) || !s.verifyOwnPassword(w, r, a.u, in.Password) {
		return
	}
	// Successful password entry must not refund guesses at the separate factor budget.
	give, ok := s.userLimit.take("2fa:" + a.u.Username)
	if !ok {
		jsonError(w, 429, "Too many code attempts. Wait 15 minutes.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer tx.Rollback()
	if err = verifiedPasswordTx(r.Context(), tx, authOf(r)); err != nil {
		jsonError(w, 409, err.Error())
		return
	}
	var enabled int
	err = tx.QueryRowContext(r.Context(), `SELECT enabled FROM account_security WHERE user_id=?`, a.u.ID).Scan(&enabled)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		serverError(w, r, err)
		return
	}
	result := map[string]any{}
	switch in.Action {
	case "setup":
		if enabled == 1 {
			jsonError(w, 409, "Two-step verification is already enabled. Disable it before setting up another device.")
			return
		}
		secret := newTOTPSecret()
		sealed, err := s.cryptSecret(secret, true)
		if err != nil {
			jsonError(w, 400, err.Error())
			return
		}
		uri := totpURI(secret, "Jiggered ("+r.Host+")", a.u.Username)
		code, err := qr.Encode([]byte(uri))
		if err != nil {
			serverError(w, r, err)
			return
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO account_security(user_id,pending_secret,pending_until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_until=excluded.pending_until`, a.u.ID, sealed, time.Now().Add(10*time.Minute).Unix()); err != nil {
			serverError(w, r, err)
			return
		}
		result["secret"] = secret
		result["qr"] = "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(code.SVG("#142a22", "#ffffff")))
		result["message"] = "Scan the QR code, then confirm a code from your app. Setup expires in 10 minutes."
	case "cancel":
		if _, err = tx.ExecContext(r.Context(), `UPDATE account_security SET pending_secret='',pending_until=0 WHERE user_id=?`, a.u.ID); err != nil {
			serverError(w, r, err)
			return
		}
		result["message"] = "Authenticator setup cancelled. Existing protection is unchanged."
	case "enable":
		if enabled == 1 {
			jsonError(w, 409, "Two-step verification is already enabled.")
			return
		}
		var sealed string
		var expires int64
		if err = tx.QueryRowContext(r.Context(), `SELECT pending_secret,pending_until FROM account_security WHERE user_id=?`, a.u.ID).Scan(&sealed, &expires); err != nil || sealed == "" || expires <= time.Now().Unix() {
			jsonError(w, 400, "Setup expired. Start again.")
			return
		}
		secret, err := s.cryptSecret(sealed, false)
		if err != nil {
			jsonError(w, 400, err.Error())
			return
		}
		step, ok := matchTOTP(secret, in.Code, time.Now())
		if !ok {
			jsonError(w, 400, "Enter the six-digit code from your authenticator app.")
			return
		}
		if _, err = tx.ExecContext(r.Context(), `UPDATE account_security SET secret=?,enabled=1,last_step=?,pending_secret='',pending_until=0 WHERE user_id=?`, sealed, step, a.u.ID); err != nil {
			serverError(w, r, err)
			return
		}
		codes, err := saveRecoveryCodes(r.Context(), tx, a.u.ID)
		if err != nil {
			serverError(w, r, err)
			return
		}
		result["codes"] = codes
		result["message"] = "Two-step verification enabled. Save these recovery codes now; they are shown once. Other devices were signed out."
	case "disable", "regenerate":
		if err = s.consumeFactor(r.Context(), tx, a.u.ID, in.Code, false); err != nil {
			jsonError(w, 400, "Enter your current authenticator code or an unused recovery code.")
			return
		}
		if in.Action == "disable" {
			if _, err = tx.ExecContext(r.Context(), `UPDATE account_security SET secret='',enabled=0,last_step=-1,pending_secret='',pending_until=0 WHERE user_id=?`, a.u.ID); err != nil {
				serverError(w, r, err)
				return
			}
			if _, err = tx.ExecContext(r.Context(), `DELETE FROM recovery_codes WHERE user_id=?`, a.u.ID); err != nil {
				serverError(w, r, err)
				return
			}
			result["message"] = "Two-step verification disabled. Other devices were signed out."
		} else {
			codes, err := saveRecoveryCodes(r.Context(), tx, a.u.ID)
			if err != nil {
				serverError(w, r, err)
				return
			}
			result["codes"] = codes
			result["message"] = "New recovery codes created. All previous codes are invalid."
		}
	default:
		jsonError(w, 400, "Unknown security action.")
		return
	}
	if in.Action != "setup" && in.Action != "cancel" {
		if _, err = tx.ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id=? AND sid!=?`, a.u.ID, a.sid); err != nil {
			serverError(w, r, err)
			return
		}
		if _, err = tx.ExecContext(r.Context(), `DELETE FROM login_challenges WHERE user_id=?`, a.u.ID); err != nil {
			serverError(w, r, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		serverError(w, r, err)
		return
	}
	give()
	s.audit(r.Context(), a.u.Username, "two_factor_"+in.Action, a.u.Username, "", s.clientIP(r))
	writeJSON(w, 200, result)
}
func saveRecoveryCodes(ctx context.Context, tx *sql.Tx, id int64) ([]string, error) {
	codes := newRecoveryCodes()
	if _, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE user_id=?`, id); err != nil {
		return nil, err
	}
	for _, c := range codes {
		if _, err := tx.ExecContext(ctx, `INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?)`, id, hashToken(normaliseCode(c))); err != nil {
			return nil, err
		}
	}
	return codes, nil
}
func (s *server) adminResetTwoFactor(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !readJSON(w, r, &in) || !s.verifyOwnPassword(w, r, authOf(r).u, in.Password) {
		return
	}
	target, err := s.userByName(r.Context(), r.PathValue("name"))
	if err != nil {
		jsonError(w, 404, "Account not found.")
		return
	}
	if target.ID == authOf(r).u.ID {
		jsonError(w, 400, "Manage your own two-step verification in Account.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer tx.Rollback()
	if err = verifiedPasswordTx(r.Context(), tx, authOf(r)); err != nil {
		jsonError(w, 409, err.Error())
		return
	}
	give, ok := s.userLimit.take("2fa:" + authOf(r).u.Username)
	if !ok {
		jsonError(w, 429, "Too many code attempts. Wait 15 minutes.")
		return
	}
	if err = s.consumeFactor(r.Context(), tx, authOf(r).u.ID, in.Code, true); err != nil {
		jsonError(w, 400, "Enter your current authenticator code or recovery code.")
		return
	}
	for _, q := range []string{`UPDATE account_security SET secret='',enabled=0,last_step=-1,pending_secret='',pending_until=0 WHERE user_id=?`, `DELETE FROM recovery_codes WHERE user_id=?`, `DELETE FROM login_challenges WHERE user_id=?`, `DELETE FROM sessions WHERE user_id=?`} {
		if _, err = tx.ExecContext(r.Context(), q, target.ID); err != nil {
			serverError(w, r, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		serverError(w, r, err)
		return
	}
	give()
	s.audit(r.Context(), authOf(r).u.Username, "two_factor_admin_reset", target.Username, "all sessions revoked", s.clientIP(r))
	writeJSON(w, 200, map[string]string{"message": "Two-step verification reset. All devices were signed out."})
}
