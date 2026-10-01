package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Per-user limits; variables so tests can shrink them.
var (
	maxDocsPerUser  = 10000
	maxBytesPerUser = int64(25 << 20)
)

const maxImportSize = 16 << 20

var (
	dayDocID     = regexp.MustCompile(`^d-\d{4}-\d{2}-\d{2}$`)
	episodeDocID = regexp.MustCompile(`^e-\d{1,20}$`)
)

// validDocID is everything a client may store: one check-in per day, episodes, and settings.
func validDocID(id string) bool {
	switch {
	case id == "settings":
		return true
	case dayDocID.MatchString(id):
		_, err := time.Parse("2006-01-02", id[2:])
		return err == nil
	}
	return episodeDocID.MatchString(id)
}

type docOut struct {
	Rev  int64           `json:"rev"`
	Body json.RawMessage `json:"body"`
}

func (s *server) listDocs(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, rev, body FROM docs WHERE user_id = ?", u.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := map[string]docOut{}
	for rows.Next() {
		var id, body string
		var rev int64
		if err := rows.Scan(&id, &rev, &body); err == nil {
			out[id] = docOut{rev, json.RawMessage(body)}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// exportDocs downloads the caller's data as a plain {id: body} map, the same
// shape the first version exported and importDocs reads back.
func (s *server) exportDocs(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, body FROM docs WHERE user_id = ?", u.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var id, body string
		if err := rows.Scan(&id, &body); err == nil {
			out[id] = json.RawMessage(body)
		}
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="jiggered-%s-%s.json"`, u.Username, time.Now().Format("2006-01-02")))
	writeJSON(w, http.StatusOK, out)
}

// precondition is a client's claim about what it last saw: If-Match "<rev>"
// (0 means "doesn't exist yet") or If-None-Match: *.
type precondition struct {
	match *int64
	none  bool
}

func parsePrecondition(r *http.Request) (p precondition, err error) {
	if v := strings.TrimSpace(r.Header.Get("If-None-Match")); v != "" {
		if v != "*" {
			return p, errors.New("If-None-Match must be *")
		}
		p.none = true
	}
	if v := strings.Trim(strings.TrimSpace(r.Header.Get("If-Match")), `"`); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			return p, errors.New("If-Match must be a revision number")
		}
		p.match = &n
	}
	return p, nil
}

func (s *server) putDoc(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	id := r.PathValue("id")
	if !validDocID(id) {
		jsonError(w, http.StatusBadRequest, "Unknown document id.")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodySize))
	if err != nil {
		jsonError(w, http.StatusRequestEntityTooLarge, "That is too large to save.")
		return
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil || obj == nil {
		jsonError(w, http.StatusBadRequest, "Body must be a JSON object.")
		return
	}
	pre, err := parsePrecondition(r)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var rev, oldSize int64
	exists := true
	err = tx.QueryRowContext(ctx, "SELECT rev, size FROM docs WHERE user_id = ? AND id = ?", u.ID, id).Scan(&rev, &oldSize)
	if errors.Is(err, sql.ErrNoRows) {
		exists = false
	} else if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if (pre.none && exists) || (pre.match != nil && *pre.match != rev) {
		// Someone (usually the same person on another device) saved since this client last looked.
		conflict := docOut{Rev: rev, Body: json.RawMessage("null")}
		var cur string
		if tx.QueryRowContext(ctx, "SELECT body FROM docs WHERE user_id = ? AND id = ?", u.ID, id).Scan(&cur) == nil {
			conflict.Body = json.RawMessage(cur)
		}
		writeJSON(w, http.StatusConflict, conflict)
		return
	}

	var count, total int64
	if err := tx.QueryRowContext(ctx, "SELECT count(*), COALESCE(sum(size), 0) FROM docs WHERE user_id = ?", u.ID).Scan(&count, &total); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if !exists && int(count) >= maxDocsPerUser {
		jsonError(w, http.StatusRequestEntityTooLarge, "You've reached the limit on saved entries.")
		return
	}
	if total-oldSize+int64(len(body)) > maxBytesPerUser {
		jsonError(w, http.StatusRequestEntityTooLarge, "You've reached your storage limit.")
		return
	}

	rev++
	if _, err := tx.ExecContext(ctx, `INSERT INTO docs(user_id, id, body, rev, size, updated_at) VALUES(?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, id) DO UPDATE SET body = excluded.body, rev = excluded.rev, size = excluded.size, updated_at = excluded.updated_at`,
		u.ID, id, string(body), rev, len(body), time.Now().Unix()); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("ETag", `"`+strconv.FormatInt(rev, 10)+`"`)
	writeJSON(w, http.StatusOK, map[string]int64{"rev": rev})
}

func (s *server) deleteDoc(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	id := r.PathValue("id")
	if !validDocID(id) {
		jsonError(w, http.StatusBadRequest, "Unknown document id.")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM docs WHERE user_id = ? AND id = ?", u.ID, id); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// importDocs restores an export. ?mode=add (default) keeps what is already
// here and only adds what is missing; ?mode=overwrite replaces matching ids.
// Either way it is all or nothing, and the per-user limits still apply.
func (s *server) importDocs(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "add"
	}
	if mode != "add" && mode != "overwrite" {
		jsonError(w, http.StatusBadRequest, "mode must be add or overwrite.")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxImportSize))
	if err != nil {
		jsonError(w, http.StatusRequestEntityTooLarge, "That file is too large to import.")
		return
	}
	var in map[string]json.RawMessage
	if err := json.Unmarshal(raw, &in); err != nil || in == nil {
		jsonError(w, http.StatusBadRequest, "That isn't a Jiggered export.")
		return
	}

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	type have struct{ rev, size int64 }
	existing := map[string]have{}
	var total int64
	rows, err := tx.QueryContext(ctx, "SELECT id, rev, size FROM docs WHERE user_id = ?", u.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var id string
		var h have
		if err := rows.Scan(&id, &h.rev, &h.size); err != nil {
			rows.Close()
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		existing[id] = h
		total += h.size
	}
	rows.Close()

	var res struct {
		Imported int `json:"imported"`
		Skipped  int `json:"skipped"`
		Invalid  int `json:"invalid"`
	}
	now := time.Now().Unix()
	for _, id := range slices.Sorted(maps.Keys(in)) {
		body := in[id]
		var obj map[string]any
		if !validDocID(id) || len(body) > maxBodySize || json.Unmarshal(body, &obj) != nil || obj == nil {
			res.Invalid++
			continue
		}
		old, exists := existing[id]
		if exists && mode == "add" {
			res.Skipped++
			continue
		}
		total += int64(len(body)) - old.size
		existing[id] = have{old.rev + 1, int64(len(body))}
		if len(existing) > maxDocsPerUser || total > maxBytesPerUser {
			jsonError(w, http.StatusRequestEntityTooLarge, "Importing that would go over your storage limit. Nothing was imported.")
			return
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO docs(user_id, id, body, rev, size, updated_at) VALUES(?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, id) DO UPDATE SET body = excluded.body, rev = excluded.rev, size = excluded.size, updated_at = excluded.updated_at`,
			u.ID, id, string(body), old.rev+1, len(body), now); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		res.Imported++
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	s.audit(ctx, u.Username, "import", u.Username, fmt.Sprintf("%s: %d imported, %d skipped, %d invalid", mode, res.Imported, res.Skipped, res.Invalid), s.clientIP(r))
	writeJSON(w, http.StatusOK, res)
}
