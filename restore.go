package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Validate known fields without stripping unrecognised/legacy fields from an export.
// The same validator runs for previews and commits. A malformed record rejects the entire restore.
func validateRestoreDoc(id string, raw json.RawMessage) error {
	if !validDocID(id) || len(raw) > maxBodySize {
		return fmt.Errorf("unsupported record id or record too large")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return fmt.Errorf("record must be a JSON object")
	}
	if id == "settings" {
		factory, _ := webFS.ReadFile("web/defaults.json")
		var d productDefaults
		json.Unmarshal(factory, &d)
		if err := json.Unmarshal(raw, &d); err != nil {
			return fmt.Errorf("settings field has the wrong type")
		}
		return d.validate()
	}
	var value map[string]any
	json.Unmarshal(raw, &value)
	for _, field := range []string{"when", "endedAt", "whenZone", "endZone", "notes", "onset", "duration", "date"} {
		if v, ok := value[field]; ok {
			if _, ok := v.(string); !ok {
				return fmt.Errorf("%s must be text", field)
			}
		}
	}
	for _, field := range []string{"symptoms", "before"} {
		if v, ok := value[field]; ok {
			list, ok := v.([]any)
			if !ok {
				return fmt.Errorf("%s must be a list", field)
			}
			for _, n := range list {
				if _, ok := n.(string); !ok {
					return fmt.Errorf("%s must contain text", field)
				}
			}
		}
	}
	for _, field := range []string{"when", "endedAt"} {
		if v, ok := value[field].(string); ok && v != "" {
			if _, err := time.Parse("2006-01-02T15:04", v); err != nil {
				if _, err := time.Parse("2006-01-02T15:04:05", v); err != nil {
					return fmt.Errorf("%s must be a valid local date and time", field)
				}
			}
		}
	}
	if strings.HasPrefix(id, "d-") {
		if v, ok := value["date"]; ok && v != id[2:] {
			return fmt.Errorf("date does not match record id")
		}
		if v, ok := value["status"]; ok && v != nil && v != "green" && v != "amber" && v != "red" {
			return fmt.Errorf("unknown check-in status")
		}
		if v, ok := value["poorSleep"]; ok {
			if _, ok := v.(bool); !ok {
				return fmt.Errorf("poorSleep must be true or false")
			}
		}
		for _, field := range []string{"budget", "sleepPenalty"} {
			if v, ok := value[field]; ok {
				n, ok := v.(float64)
				if !ok || n != float64(int(n)) || n < 0 || n > 30 || field == "budget" && n < 1 {
					return fmt.Errorf("%s must be a valid whole number", field)
				}
			}
		}
		if v, ok := value["entries"]; ok {
			list, ok := v.([]any)
			if !ok {
				return fmt.Errorf("entries must be a list")
			}
			ids := map[string]bool{}
			for _, entry := range list {
				e, ok := entry.(map[string]any)
				if !ok {
					return fmt.Errorf("activity must be an object")
				}
				a, ok := e["a"].(string)
				if !ok || strings.TrimSpace(a) == "" || utf8.RuneCountInString(a) > 60 {
					return fmt.Errorf("activity needs a name of 1–60 characters")
				}
				n, ok := e["c"].(float64)
				if !ok || n != float64(int(n)) || n < -10 || n > 10 {
					return fmt.Errorf("activity points must be a whole number from −10 to 10")
				}
				if v, ok := e["id"]; ok {
					id, ok := v.(string)
					if !ok || id == "" || ids[id] {
						return fmt.Errorf("activity ids must be distinct text")
					}
					ids[id] = true
				}
				if v, ok := e["t"]; ok {
					t, ok := v.(string)
					if !ok {
						return fmt.Errorf("activity time must be text")
					}
					if t != "" {
						if _, err := time.Parse("15:04", t); err != nil {
							return fmt.Errorf("activity time must be HH:MM or empty")
						}
					}
				}
			}
		}
	}
	return nil
}

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
		if err := validateRestoreDoc(id, in[id]); err != nil {
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
