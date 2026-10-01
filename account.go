package main

import (
	"errors"
	"net/http"
	"time"
)

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	writeJSON(w, http.StatusOK, map[string]any{
		"id":                   u.ID,
		"username":             u.Username,
		"role":                 u.Role,
		"must_change_password": u.MustChange,
		"version":              version,
	})
}

// verifyOwnPassword checks a password typed into a signed-in session. It shares
// the per-account failure budget with login, so a stolen cookie can't be used
// to guess the password here without limit.
func (s *server) verifyOwnPassword(w http.ResponseWriter, r *http.Request, u *user, pw string) bool {
	giveBack, ok := s.userLimit.take(u.Username) // counted as it starts, like a sign-in: see handleLogin
	if !ok {
		jsonError(w, http.StatusTooManyRequests, "Too many wrong passwords. Wait 15 minutes, then try again.")
		return false
	}
	hash, err := s.passwordHash(r.Context(), u.ID)
	if err != nil {
		giveBack()
		http.Error(w, "server error", http.StatusInternalServerError)
		return false
	}
	good, err := s.checkHash(hash, pw)
	if err != nil {
		giveBack()
		jsonError(w, http.StatusServiceUnavailable, "Busy right now. Try again in a moment.")
		return false
	}
	if !good {
		s.audit(r.Context(), u.Username, "password_check_failed", u.Username, r.Method+" "+r.URL.Path, s.clientIP(r))
		jsonError(w, http.StatusForbidden, "That isn't your current password.")
		return false
	}
	giveBack()
	return true
}

func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	var in struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !s.verifyOwnPassword(w, r, a.u, in.Current) {
		return
	}
	if err := checkPassword(in.New, a.u.Username); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.New == in.Current {
		jsonError(w, http.StatusBadRequest, "Choose a different password from the current one.")
		return
	}
	hash, err := s.hashPassword(in.New)
	if err != nil {
		jsonError(w, http.StatusServiceUnavailable, "Busy right now. Try again in a moment.")
		return
	}
	if err := s.setPassword(r.Context(), a.u.ID, hash, false, a.sid); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	s.userLimit.reset(a.u.Username)
	s.audit(r.Context(), a.u.Username, "password_changed", a.u.Username, "other sessions signed out", s.clientIP(r))
	w.WriteHeader(http.StatusNoContent)
}

type sessionOut struct {
	ID         string `json:"id"`
	CreatedAt  int64  `json:"created_at"`
	LastSeenAt int64  `json:"last_seen_at"`
	IP         string `json:"ip"`
	UserAgent  string `json:"user_agent"`
	Current    bool   `json:"current"`
}

func (s *server) listSessions(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	rows, err := s.db.QueryContext(r.Context(), `SELECT sid, created_at, last_seen_at, ip, user_agent FROM sessions
		WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`, a.u.ID, time.Now().Unix())
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []sessionOut{}
	for rows.Next() {
		var so sessionOut
		if err := rows.Scan(&so.ID, &so.CreatedAt, &so.LastSeenAt, &so.IP, &so.UserAgent); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		so.Current = so.ID == a.sid
		out = append(out, so)
	}
	writeJSON(w, http.StatusOK, out)
}

// revokeSession signs out one of the caller's own sessions (never someone else's).
func (s *server) revokeSession(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	sid := r.PathValue("sid")
	res, err := s.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE user_id = ? AND sid = ?", a.u.ID, sid)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if sid == a.sid {
		s.clearSessionCookie(w)
	}
	if n, _ := res.RowsAffected(); n > 0 { // revoking what isn't there changes nothing, so it isn't an event
		s.audit(r.Context(), a.u.Username, "session_revoked", a.u.Username, "", s.clientIP(r))
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	n, err := s.revokeSessions(r.Context(), a.u.ID, a.sid)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if n > 0 {
		s.audit(r.Context(), a.u.Username, "sessions_revoked", a.u.Username, "other devices", s.clientIP(r))
	}
	writeJSON(w, http.StatusOK, map[string]int64{"revoked": n})
}

func (s *server) revokeAllSessions(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	n, err := s.revokeSessions(r.Context(), a.u.ID, "")
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	s.clearSessionCookie(w)
	if n > 0 {
		s.audit(r.Context(), a.u.Username, "sessions_revoked", a.u.Username, "everywhere", s.clientIP(r))
	}
	writeJSON(w, http.StatusOK, map[string]int64{"revoked": n})
}

// deleteSelf removes the caller's account and every doc in it.
func (s *server) deleteSelf(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	var in struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !s.verifyOwnPassword(w, r, a.u, in.Password) {
		return
	}
	if err := s.deleteUser(r.Context(), a.u.ID); err != nil {
		if errors.Is(err, errLastAdmin) {
			jsonError(w, http.StatusConflict, "You're the only admin. Make someone else an admin first.")
			return
		}
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	s.audit(r.Context(), a.u.Username, "account_deleted", a.u.Username, "by the account holder", s.clientIP(r))
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}
