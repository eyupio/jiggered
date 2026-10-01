package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"slices"
)

func (s *server) restoreDocs(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "add"
	}
	if mode != "add" && mode != "overwrite" {
		jsonError(w, 400, "Mode must be add or overwrite.")
		return
	}
	allowSlowTransfer(w)
	raw, ok := readBody(w, r, importLimit(), "That export is too large.")
	if !ok {
		return
	}
	var in map[string]json.RawMessage
	if json.Unmarshal(raw, &in) != nil || in == nil || len(in) == 0 {
		jsonError(w, 400, "Choose a non-empty Jiggered export (not a device recovery file).")
		return
	}
	issues := []string{}
	for _, id := range slices.Sorted(maps.Keys(in)) {
		if err := validateDoc(id, in[id]); err != nil {
			issues = append(issues, fmt.Sprintf("%s: %s", id, err))
		}
	}
	if len(issues) > 0 {
		writeJSON(w, 422, map[string]any{"error": "Restore rejected. Nothing changed. Fix these records or use an earlier export.", "issues": issues})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer tx.Rollback()
	// Bind the preview to both the selected file/mode and the entire current account.
	// A revision change, addition or deletion on another device forces a new preview.
	current := map[string]docOut{}
	rows, err := tx.QueryContext(r.Context(), "SELECT id,body,rev FROM docs WHERE user_id=? ORDER BY id", authOf(r).u.ID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	for rows.Next() {
		var id string
		var d docOut
		var body string
		if err = rows.Scan(&id, &body, &d.Rev); err != nil {
			rows.Close()
			serverError(w, r, err)
			return
		}
		d.Body = json.RawMessage(body)
		current[id] = d
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		serverError(w, r, err)
		return
	}
	fingerprint, _ := json.Marshal([]any{authOf(r).u.ID, mode, in, current})
	token := fmt.Sprintf(`"%x"`, sha256.Sum256(fingerprint))
	preview := r.URL.Path == "/api/restore/preview"
	if !preview && r.Header.Get("If-Match") != token {
		jsonError(w, 409, "Your file, restore mode or server data changed. Nothing restored. Preview again.")
		return
	}
	res, err := s.importTx(r.Context(), tx, authOf(r).u.ID, in, mode, preview)
	if err != nil {
		if err == errImportTooBig {
			jsonError(w, 413, "Restore would exceed your storage limit. Nothing changed.")
		} else {
			serverError(w, r, err)
		}
		return
	}
	if preview {
		matches := 0
		for id := range in {
			if _, ok := current[id]; ok {
				matches++
			}
		}
		_, settings := in["settings"]
		_, haveSettings := current["settings"]
		writeJSON(w, 200, map[string]any{"token": token, "additions": len(in) - matches, "matches": matches, "overwrites": map[bool]int{true: matches, false: 0}[mode == "overwrite"], "settingsChanged": settings && (!haveSettings || mode == "overwrite"), "skipped": res.Skipped})
		return
	}
	if err = tx.Commit(); err != nil {
		serverError(w, r, err)
		return
	}
	s.audit(r.Context(), authOf(r).u.Username, "restore", authOf(r).u.Username, fmt.Sprintf("%s: %d restored, %d kept", mode, res.Imported, res.Skipped), s.clientIP(r))
	writeJSON(w, 200, res)
}
