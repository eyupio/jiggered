package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type productDefaults struct {
	Budget       int    `json:"budget"`
	SleepPenalty int    `json:"sleepPenalty"`
	Locale       string `json:"locale"`
	Activities   []struct {
		ID string `json:"id,omitempty"`
		A  string `json:"a"`
		C  int    `json:"c"`
	} `json:"activities"`
	Symptoms []string `json:"symptoms"`
	Triggers []string `json:"triggers"`
}

func (d productDefaults) validate() error {
	if d.Budget < 1 || d.Budget > 30 || d.SleepPenalty < 0 || d.SleepPenalty > d.Budget {
		return fmt.Errorf("Budget must be 1–30 and poor sleep costs 0–budget")
	}
	if !map[string]bool{"": true, "en-GB": true, "en-US": true, "en-AU": true, "en-CA": true, "de-DE": true, "fr-FR": true, "es-ES": true, "nl-NL": true}[d.Locale] {
		return fmt.Errorf("Choose a supported date format")
	}
	if d.Activities == nil {
		return fmt.Errorf("Activities must be a list")
	}
	activities := make([]string, len(d.Activities))
	ids := map[string]bool{}
	for i, a := range d.Activities {
		activities[i] = a.A
		if a.ID != "" {
			if len(a.ID) > 512 || ids[a.ID] {
				return fmt.Errorf("Activity identities must be unique and under 512 bytes")
			}
			ids[a.ID] = true
		}
		if a.C < -10 || a.C > 10 {
			return fmt.Errorf("Activity points must be −10 to 10")
		}
	}
	for _, list := range [][]string{activities, d.Symptoms, d.Triggers} {
		if list == nil || len(list) > 40 {
			return fmt.Errorf("Each list must contain at most 40 items")
		}
		seen := map[string]bool{}
		for _, name := range list {
			trimmed := strings.TrimSpace(name)
			if trimmed != name || trimmed == "" || utf8.RuneCountInString(name) > 60 {
				return fmt.Errorf("Names must have 1–60 characters with no surrounding spaces")
			}
			key := strings.ToLower(name)
			if seen[key] {
				return fmt.Errorf("Names in each list must be distinct")
			}
			seen[key] = true
		}
	}
	return nil
}
func defaultsTag(raw string) string { return fmt.Sprintf(`"%x"`, sha256.Sum256([]byte(raw))) }
func (s *server) getDefaults(r *http.Request) (string, bool, error) {
	var value string
	err := s.db.QueryRowContext(r.Context(), "SELECT value FROM instance_settings WHERE key = 'product_defaults'").Scan(&value)
	if err == sql.ErrNoRows {
		b, e := webFS.ReadFile("web/defaults.json")
		return string(b), false, e
	}
	return value, true, err
}
func (s *server) productGetDefaults(w http.ResponseWriter, r *http.Request) {
	raw, _, err := s.getDefaults(r)
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.Header().Set("ETag", defaultsTag(raw))
	w.Header().Set("Cache-Control", "no-store")
	var stored productDefaults
	if json.Unmarshal([]byte(raw), &stored) != nil || stored.validate() != nil {
		// Keep the stored-value ETag so an admin can repair damaged defaults through the normal editor.
		fallback, err := webFS.ReadFile("web/defaults.json")
		if err != nil {
			serverError(w, r, err)
			return
		}
		raw = string(fallback)
		w.Header().Set("X-Jiggered-Defaults-Fallback", "true")
	}
	writeJSON(w, http.StatusOK, json.RawMessage(raw))
}
func (s *server) productPutDefaults(w http.ResponseWriter, r *http.Request) {
	var in productDefaults
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.validate(); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	old, exists, err := s.getDefaults(r)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if r.Header.Get("If-Match") != defaultsTag(old) {
		jsonError(w, 409, "Defaults changed elsewhere. Reload them before saving; your draft is kept.")
		return
	}
	b, err := json.Marshal(in)
	if err != nil {
		serverError(w, r, err)
		return
	}
	var result sql.Result
	if exists {
		result, err = s.db.ExecContext(r.Context(), "UPDATE instance_settings SET value=?,updated_at=? WHERE key='product_defaults' AND value=?", string(b), time.Now().Unix(), old)
	} else {
		result, err = s.db.ExecContext(r.Context(), "INSERT OR IGNORE INTO instance_settings(key,value,updated_at) VALUES('product_defaults',?,?)", string(b), time.Now().Unix())
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		serverError(w, r, err)
		return
	}
	if n != 1 {
		jsonError(w, 409, "Defaults changed elsewhere. Reload before saving.")
		return
	}
	s.audit(r.Context(), authOf(r).u.Username, "defaults_changed", "", "Updated shared product defaults", s.clientIP(r))
	w.Header().Set("ETag", defaultsTag(string(b)))
	writeJSON(w, 200, in)
}
