package main

import (
	"context"
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

// importLimit is the biggest upload accepted. Whatever a person can export they can import back, so it has to
// cover their whole storage quota (and the ids and punctuation an export adds around the bodies).
func importLimit() int64 { return maxBytesPerUser + 1<<20 }

// allowSlowTransfer lifts the server-wide 30 second read and write limits for a handler that moves a lot of data:
// nobody on a slow connection can send or receive 25 MB that fast. Five minutes still bounds it.
func allowSlowTransfer(w http.ResponseWriter) {
	rc := http.NewResponseController(w)
	rc.SetReadDeadline(time.Now().Add(5 * time.Minute))
	rc.SetWriteDeadline(time.Now().Add(5 * time.Minute))
}

// readBody reads a request body of at most limit bytes. If it can't, it answers the client itself and says so:
// 413 when the body really was too big, 400 when it simply couldn't be read (the connection dropped, or the
// client was too slow).
func readBody(w http.ResponseWriter, r *http.Request, limit int64, tooBig string) ([]byte, bool) {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err == nil {
		return b, true
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		jsonError(w, http.StatusRequestEntityTooLarge, tooBig)
	} else {
		jsonError(w, http.StatusBadRequest, "That upload couldn't be read. Try again.")
	}
	return nil, false
}

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
	allowSlowTransfer(w)
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, rev, body FROM docs WHERE user_id = ?", u.ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer rows.Close()
	out := map[string]docOut{}
	for rows.Next() {
		var id, body string
		var rev int64
		if err := rows.Scan(&id, &rev, &body); err != nil {
			serverError(w, r, err)
			return
		}
		out[id] = docOut{rev, json.RawMessage(body)}
	}
	// A scan that stopped on an error is not a short list: the page would replace its copy with it.
	if err := rows.Err(); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// exportDocs downloads the caller's data as a plain {id: body} map, the same
// shape the first version exported and importDocs reads back.
func (s *server) exportDocs(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	allowSlowTransfer(w)
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, body FROM docs WHERE user_id = ?", u.ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var id, body string
		if err := rows.Scan(&id, &body); err != nil {
			serverError(w, r, err)
			return
		}
		out[id] = json.RawMessage(body)
	}
	if err := rows.Err(); err != nil { // an export that quietly lacks half the data is worse than none
		serverError(w, r, err)
		return
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

// parsePrecondition reads the headers strictly: one that is present but unreadable, including an empty one, is
// an error, never "no precondition", which would turn a garbled header into an unconditional overwrite.
func parsePrecondition(r *http.Request) (p precondition, err error) {
	if vals := r.Header.Values("If-None-Match"); len(vals) > 0 {
		if strings.TrimSpace(strings.Join(vals, ",")) != "*" {
			return p, errors.New("If-None-Match must be *")
		}
		p.none = true
	}
	if vals := r.Header.Values("If-Match"); len(vals) > 0 {
		v := strings.TrimSpace(strings.Join(vals, ","))
		if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
			v = v[1 : len(v)-1]
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			return p, errors.New("If-Match must be a revision number")
		}
		p.match = &n
	}
	return p, nil
}

var (
	errDocLimit     = errors.New("too many documents")
	errStorageLimit = errors.New("over the storage limit")
)

// storeDoc applies one write under the caller's preconditions in a single transaction and is finished with the
// database before it returns. The handler only writes to the client afterwards: there is one connection, so a
// transaction held open while talking to a slow client would stop everyone else. conflict is set instead of rev
// when the precondition failed, and holds what is there now.
func (s *server) storeDoc(ctx context.Context, userID int64, id string, body []byte, pre precondition) (rev int64, conflict *docOut, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()

	var oldSize int64
	exists := true
	err = tx.QueryRowContext(ctx, "SELECT rev, size FROM docs WHERE user_id = ? AND id = ?", userID, id).Scan(&rev, &oldSize)
	if errors.Is(err, sql.ErrNoRows) {
		exists = false
	} else if err != nil {
		return 0, nil, err
	}
	if (pre.none && exists) || (pre.match != nil && *pre.match != rev) {
		// Someone (usually the same person on another device) saved since this client last looked.
		c := docOut{Rev: rev, Body: json.RawMessage("null")}
		var cur string
		if tx.QueryRowContext(ctx, "SELECT body FROM docs WHERE user_id = ? AND id = ?", userID, id).Scan(&cur) == nil {
			c.Body = json.RawMessage(cur)
		}
		return 0, &c, nil
	}

	var count, total int64
	if err := tx.QueryRowContext(ctx, "SELECT count(*), COALESCE(sum(size), 0) FROM docs WHERE user_id = ?", userID).Scan(&count, &total); err != nil {
		return 0, nil, err
	}
	if !exists && int(count) >= maxDocsPerUser {
		return 0, nil, errDocLimit
	}
	if total-oldSize+int64(len(body)) > maxBytesPerUser {
		return 0, nil, errStorageLimit
	}

	rev++
	if _, err := tx.ExecContext(ctx, `INSERT INTO docs(user_id, id, body, rev, size, updated_at) VALUES(?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, id) DO UPDATE SET body = excluded.body, rev = excluded.rev, size = excluded.size, updated_at = excluded.updated_at`,
		userID, id, string(body), rev, len(body), time.Now().Unix()); err != nil {
		return 0, nil, err
	}
	return rev, nil, tx.Commit()
}

func (s *server) putDoc(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	id := r.PathValue("id")
	if !validDocID(id) {
		jsonError(w, http.StatusBadRequest, "Unknown document id.")
		return
	}
	body, ok := readBody(w, r, maxBodySize, "That is too large to save.")
	if !ok {
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

	rev, conflict, err := s.storeDoc(r.Context(), u.ID, id, body, pre)
	switch {
	case errors.Is(err, errDocLimit):
		jsonError(w, http.StatusRequestEntityTooLarge, "You've reached the limit on saved entries.")
	case errors.Is(err, errStorageLimit):
		jsonError(w, http.StatusRequestEntityTooLarge, "You've reached your storage limit.")
	case err != nil:
		serverError(w, r, err)
	case conflict != nil:
		writeJSON(w, http.StatusConflict, conflict)
	default:
		w.Header().Set("ETag", `"`+strconv.FormatInt(rev, 10)+`"`)
		writeJSON(w, http.StatusOK, map[string]int64{"rev": rev})
	}
}

func (s *server) deleteDoc(w http.ResponseWriter, r *http.Request) {
	u := authOf(r).u
	id := r.PathValue("id")
	if !validDocID(id) {
		jsonError(w, http.StatusBadRequest, "Unknown document id.")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM docs WHERE user_id = ? AND id = ?", u.ID, id); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type importResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Invalid  int `json:"invalid"`
}

var errImportTooBig = errors.New("import would go over the storage limit")

// importInto adds or overwrites docs for one person, all or nothing, and is finished with the database before it
// returns (see storeDoc).
func (s *server) importInto(ctx context.Context, userID int64, in map[string]json.RawMessage, mode string) (res importResult, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return res, err
	}
	defer tx.Rollback()

	res, err = s.importTx(ctx, tx, userID, in, mode, false)
	if err != nil {
		return res, err
	}
	return res, tx.Commit()
}

func (s *server) importTx(ctx context.Context, tx *sql.Tx, userID int64, in map[string]json.RawMessage, mode string, preview bool) (res importResult, err error) {

	type have struct{ rev, size int64 }
	existing := map[string]have{}
	var total int64
	rows, err := tx.QueryContext(ctx, "SELECT id, rev, size FROM docs WHERE user_id = ?", userID)
	if err != nil {
		return res, err
	}
	for rows.Next() {
		var id string
		var h have
		if err := rows.Scan(&id, &h.rev, &h.size); err != nil {
			rows.Close()
			return res, err
		}
		existing[id] = h
		total += h.size
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return res, err
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
			return res, errImportTooBig
		}
		if !preview {
			if _, err := tx.ExecContext(ctx, `INSERT INTO docs(user_id, id, body, rev, size, updated_at) VALUES(?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, id) DO UPDATE SET body = excluded.body, rev = excluded.rev, size = excluded.size, updated_at = excluded.updated_at`,
				userID, id, string(body), old.rev+1, len(body), now); err != nil {
				return res, err
			}
		}
		res.Imported++
	}
	return res, nil
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
	allowSlowTransfer(w)
	raw, ok := readBody(w, r, importLimit(), "That file is too large to import.")
	if !ok {
		return
	}
	var in map[string]json.RawMessage
	if err := json.Unmarshal(raw, &in); err != nil || in == nil {
		jsonError(w, http.StatusBadRequest, "That isn't a Jiggered export.")
		return
	}

	res, err := s.importInto(r.Context(), u.ID, in, mode)
	switch {
	case errors.Is(err, errImportTooBig):
		jsonError(w, http.StatusRequestEntityTooLarge, "Importing that would go over your storage limit. Nothing was imported.")
	case err != nil:
		serverError(w, r, err)
	default:
		s.audit(r.Context(), u.Username, "import", u.Username, fmt.Sprintf("%s: %d imported, %d skipped, %d invalid", mode, res.Imported, res.Skipped, res.Invalid), s.clientIP(r))
		writeJSON(w, http.StatusOK, res)
	}
}
