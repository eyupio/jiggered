package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

// Everything in this file is account management. None of it reads a check-in
// or an episode: an admin sees who has an account and how much space it uses,
// not what is in it.

func (s *server) adminFail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errLastAdmin):
		jsonError(w, http.StatusConflict, "That would leave no active admin. Make someone else an admin first.")
	case errors.Is(err, errNoUser):
		jsonError(w, http.StatusNotFound, "No such user.")
	case errors.Is(err, errUserExists):
		jsonError(w, http.StatusConflict, "That username is taken.")
	default:
		http.Error(w, "server error", http.StatusInternalServerError)
	}
}

// target loads the account named in the URL.
func (s *server) target(w http.ResponseWriter, r *http.Request) (*user, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Bad user id.")
		return nil, false
	}
	t, err := s.userByID(r.Context(), id)
	if err != nil {
		s.adminFail(w, err)
		return nil, false
	}
	return t, true
}

func (s *server) adminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.listUsers(r.Context())
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users, "version": version})
}

func (s *server) adminCreateUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	name := normUsername(in.Username)
	if !validUsername(name) {
		jsonError(w, http.StatusBadRequest, "Usernames use letters, digits and . _ @ + - (up to 64 characters).")
		return
	}
	role := in.Role
	if role == "" {
		role = roleUser
	}
	if role != roleUser && role != roleAdmin {
		jsonError(w, http.StatusBadRequest, "Role must be user or admin.")
		return
	}
	pw, err := tempPassword()
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	hash, err := s.hashPassword(pw)
	if err != nil {
		jsonError(w, http.StatusServiceUnavailable, "Busy right now. Try again in a moment.")
		return
	}
	u, err := s.createUser(r.Context(), name, hash, role, true)
	if err != nil {
		s.adminFail(w, err)
		return
	}
	s.audit(r.Context(), authOf(r).u.Username, "user_created", u.Username, role, s.clientIP(r))
	writeJSON(w, http.StatusCreated, map[string]any{"user": u, "temp_password": pw})
}

func (s *server) adminUpdateUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Role     *string `json:"role"`
		Disabled *bool   `json:"disabled"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	me := authOf(r).u
	if t.ID == me.ID {
		jsonError(w, http.StatusBadRequest, "You can't change your own role or disable yourself. Ask another admin.")
		return
	}
	ctx, ip := r.Context(), s.clientIP(r)
	if in.Role != nil {
		if *in.Role != roleAdmin && *in.Role != roleUser {
			jsonError(w, http.StatusBadRequest, "Role must be user or admin.")
			return
		}
		if *in.Role != t.Role {
			if err := s.setRole(ctx, t.ID, *in.Role); err != nil {
				s.adminFail(w, err)
				return
			}
			s.audit(ctx, me.Username, "role_changed", t.Username, t.Role+" -> "+*in.Role, ip)
		}
	}
	if in.Disabled != nil && *in.Disabled != t.Disabled {
		if err := s.setDisabled(ctx, t.ID, *in.Disabled); err != nil {
			s.adminFail(w, err)
			return
		}
		action := "user_enabled"
		if *in.Disabled {
			action = "user_disabled"
		}
		s.audit(ctx, me.Username, action, t.Username, "", ip)
	}
	u, err := s.userByID(ctx, t.ID)
	if err != nil {
		s.adminFail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *server) adminResetPassword(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	me := authOf(r).u
	if t.ID == me.ID {
		jsonError(w, http.StatusBadRequest, "Change your own password from the Account tab.")
		return
	}
	pw, err := tempPassword()
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	hash, err := s.hashPassword(pw)
	if err != nil {
		jsonError(w, http.StatusServiceUnavailable, "Busy right now. Try again in a moment.")
		return
	}
	if err := s.setPassword(r.Context(), t.ID, hash, true, ""); err != nil {
		s.adminFail(w, err)
		return
	}
	s.userLimit.reset(t.Username)
	s.audit(r.Context(), me.Username, "password_reset", t.Username, "signed out everywhere", s.clientIP(r))
	writeJSON(w, http.StatusOK, map[string]string{"temp_password": pw})
}

func (s *server) adminRevokeSessions(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	me := authOf(r).u
	if t.ID == me.ID {
		jsonError(w, http.StatusBadRequest, "Sign yourself out from the Account tab.")
		return
	}
	n, err := s.revokeSessions(r.Context(), t.ID, "")
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	s.audit(r.Context(), me.Username, "sessions_revoked", t.Username, "", s.clientIP(r))
	writeJSON(w, http.StatusOK, map[string]int64{"revoked": n})
}

func (s *server) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	t, ok := s.target(w, r)
	if !ok {
		return
	}
	me := authOf(r).u
	if t.ID == me.ID {
		jsonError(w, http.StatusBadRequest, "Delete your own account from the Account tab.")
		return
	}
	if !strings.EqualFold(r.URL.Query().Get("confirm"), t.Username) {
		jsonError(w, http.StatusBadRequest, "Type the username to confirm.")
		return
	}
	if err := s.deleteUser(r.Context(), t.ID); err != nil {
		s.adminFail(w, err)
		return
	}
	s.audit(r.Context(), me.Username, "user_deleted", t.Username, "account and all its data", s.clientIP(r))
	w.WriteHeader(http.StatusNoContent)
}

type auditOut struct {
	ID     int64  `json:"id"`
	At     int64  `json:"at"`
	Actor  string `json:"actor"`
	Action string `json:"action"`
	Target string `json:"target"`
	Detail string `json:"detail"`
	IP     string `json:"ip"`
}

// adminAudit lists recent events, newest first; pass before=<id> for the next page.
func (s *server) adminAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 500 {
		limit = 100
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, at, actor, action, target, detail, ip FROM audit_log
		WHERE (? = 0 OR id < ?) ORDER BY id DESC LIMIT ?`, before, before, limit)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []auditOut{}
	for rows.Next() {
		var e auditOut
		if err := rows.Scan(&e.ID, &e.At, &e.Actor, &e.Action, &e.Target, &e.Detail, &e.IP); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, out)
}
