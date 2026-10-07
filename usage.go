package main

import (
	"context"
	"database/sql"
	"net/http"
	"time"
)

// Consent holds a random seed; event rows contain only rotating weekly pseudonyms.
// Admins receive cohort aggregates, never person-level event rows. No health data is accepted.
func usageWeek(now time.Time) string {
	now = now.UTC()
	day := (int(now.Weekday()) + 6) % 7
	return now.AddDate(0, 0, -day).Format("2006-01-02")
}

func eraseUsage(ctx context.Context, tx *sql.Tx, userID int64) error {
	var seed string
	err := tx.QueryRowContext(ctx, `SELECT seed FROM usage_consent WHERE user_id=?`, userID).Scan(&seed)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	for i := 0; i < 15; i++ {
		week := usageWeek(time.Now().AddDate(0, 0, -7*i))
		if _, err = tx.ExecContext(ctx, `DELETE FROM product_usage WHERE cohort=?`, hashToken(seed+week)); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM usage_consent WHERE user_id=?`, userID)
	return err
}

func (s *server) usageEnabled(ctx context.Context) (bool, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM instance_settings WHERE key='product_usage_enabled'`).Scan(&value)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return value == "true", err
}

func (s *server) usageConsent(w http.ResponseWriter, r *http.Request) {
	enabled, err := s.usageEnabled(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	uid := authOf(r).u.ID
	if r.Method == "PUT" {
		var in struct {
			Enabled bool `json:"enabled"`
		}
		if !readJSON(w, r, &in) {
			return
		}
		if in.Enabled && !enabled {
			jsonError(w, 409, "Usage measurement is disabled for this instance.")
			return
		}
		err = s.withUserTx(r.Context(), uid, func(tx *sql.Tx, u *user) error {
			if !in.Enabled {
				return eraseUsage(r.Context(), tx, uid)
			}
			seed, e := randomHex(32)
			if e != nil {
				return e
			}
			_, e = tx.ExecContext(r.Context(), `INSERT OR IGNORE INTO usage_consent(user_id,seed) VALUES(?,?)`, uid, seed)
			return e
		})
		if err != nil {
			serverError(w, r, err)
			return
		}
	}
	var n int
	err = s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM usage_consent WHERE user_id=?`, uid).Scan(&n)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"available": enabled, "enabled": n > 0})
}

func (s *server) recordUsage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Event string `json:"event"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	switch in.Event {
	case "capture_saved", "history_viewed", "export_created", "settings_saved", "save_failed", "print_requested", "recovery_saved", "tool_opened", "tool_edited":
	default:
		jsonError(w, 400, "Unknown task event.")
		return
	}
	enabled, err := s.usageEnabled(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	if !enabled {
		w.WriteHeader(204)
		return
	}
	var seed string
	err = s.db.QueryRowContext(r.Context(), `SELECT seed FROM usage_consent WHERE user_id=?`, authOf(r).u.ID).Scan(&seed)
	if err == sql.ErrNoRows {
		w.WriteHeader(204)
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	now := time.Now().UTC()
	week := usageWeek(now)
	// Gate consent and instance setting in the same write: disabling cannot race a queued event.
	_, err = s.db.ExecContext(r.Context(), `INSERT INTO product_usage(cohort,week,event,count,days) SELECT ?,?,?,1,? FROM usage_consent WHERE user_id=? AND seed=? AND EXISTS(SELECT 1 FROM instance_settings WHERE key='product_usage_enabled' AND value='true') ON CONFLICT(cohort,week,event) DO UPDATE SET count=MIN(count+1,100),days=days|excluded.days`, hashToken(seed+week), week, in.Event, 1<<uint(now.Weekday()), authOf(r).u.ID, seed)
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(204)
}

func (s *server) adminUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		var in struct {
			Enabled  bool   `json:"enabled"`
			Password string `json:"password"`
			Clear    bool   `json:"clear"`
		}
		if !readJSON(w, r, &in) || !s.verifyOwnPassword(w, r, authOf(r).u, in.Password) {
			return
		}
		err := s.withUserTx(r.Context(), authOf(r).u.ID, func(tx *sql.Tx, u *user) error {
			value := "false"
			if in.Enabled {
				value = "true"
			}
			if _, e := tx.ExecContext(r.Context(), `INSERT INTO instance_settings(key,value,updated_at) VALUES('product_usage_enabled',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, value, time.Now().Unix()); e != nil {
				return e
			}
			if in.Clear {
				_, e := tx.ExecContext(r.Context(), `DELETE FROM product_usage`)
				return e
			}
			return nil
		})
		if err != nil {
			serverError(w, r, err)
			return
		}
		s.audit(r.Context(), authOf(r).u.Username, "usage_settings_changed", "", "Optional local usage measurement settings changed.", s.clientIP(r))
	}
	enabled, err := s.usageEnabled(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT week,event,count(DISTINCT cohort),sum(count),sum(CASE WHEN days & (days-1) != 0 THEN 1 ELSE 0 END) FROM product_usage WHERE week>=? GROUP BY week,event HAVING count(DISTINCT cohort)>=5 ORDER BY week DESC,event`, time.Now().AddDate(0, 0, -84).Format("2006-01-02"))
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var week, event string
		var people, total, returning int
		if err = rows.Scan(&week, &event, &people, &total, &returning); err != nil {
			serverError(w, r, err)
			return
		}
		var repeatDays any
		if returning >= 5 {
			repeatDays = returning
		}
		out = append(out, map[string]any{"week": week, "event": event, "participants": people, "tasks": total, "repeat_days_participants": repeatDays})
	}
	if err = rows.Err(); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"enabled": enabled, "rows": out})
}
