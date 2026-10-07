package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestUsageConsentSuppressionAndDeletion(t *testing.T) {
	e := newTestServer(t)
	c := e.newClient()
	c.login(adminName, adminPass)
	c.do("POST", "/api/me/usage", map[string]string{"event": "capture_saved"})
	var n int
	e.s.db.QueryRow(`SELECT count(*) FROM product_usage`).Scan(&n)
	if n != 0 {
		t.Fatal("default measurement collected data")
	}
	if st := c.do("PUT", "/api/admin/usage", map[string]any{"enabled": true, "password": adminPass}); st != 200 {
		t.Fatal(st)
	}
	if st := c.do("PUT", "/api/me/usage-consent", map[string]bool{"enabled": true}); st != 200 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/me/usage", map[string]string{"event": "capture_saved"}); st != 204 {
		t.Fatal(st)
	}
	if st := c.do("POST", "/api/me/usage", map[string]string{"event": "private_note"}); st != 400 {
		t.Fatal("unbounded event accepted", st)
	}
	if st := c.do("POST", "/api/me/usage", map[string]string{"event": "capture_saved", "notes": "secret"}); st != 400 {
		t.Fatal("extra content accepted", st)
	}
	e.s.db.QueryRow(`SELECT count(*) FROM product_usage`).Scan(&n)
	if n != 1 {
		t.Fatal("consented event missing", n)
	}
	body := c.mustBody("GET", "/api/admin/usage")
	if strings.Contains(body, "capture_saved") {
		t.Fatal("small cohort exposed", body)
	}
	if st := c.do("PUT", "/api/me/usage-consent", map[string]bool{"enabled": false}); st != 200 {
		t.Fatal(st)
	}
	e.s.db.QueryRow(`SELECT count(*) FROM product_usage`).Scan(&n)
	if n != 0 {
		t.Fatal("disable did not erase", n)
	}
}

// The admin usage view reads only complete weeks with enough participants, and never person-level rows.
func TestAdminUsageAggregatesClearsAndSwitchesOff(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	var out map[string]any
	admin.getJSON("/api/admin/usage", &out)
	if out["enabled"] != false {
		t.Fatalf("enabled before switching on: %v", out)
	}
	if st := admin.do("PUT", "/api/admin/usage", map[string]any{"enabled": true, "password": adminPass}); st != 200 {
		t.Fatal(st)
	}
	// Six consenting cohorts this week, one of whom is more than a week-day apart; one old week is ignored.
	week := usageWeek(time.Now())
	for i := 0; i < 6; i++ {
		if _, err := e.s.db.Exec(`INSERT INTO product_usage(cohort,week,event,count,days) VALUES(?,?, 'capture_saved', ?, 3)`, fmt.Sprint("cohort", i), week, i+1); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.s.db.Exec(`INSERT INTO product_usage(cohort,week,event,count,days) VALUES('c',?,'capture_saved',99,1)`, usageWeek(time.Now().AddDate(0, 0, -91))); err != nil {
		t.Fatal(err)
	}
	admin.getJSON("/api/admin/usage", &out)
	rows, _ := out["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("rows = %v", out["rows"])
	}
	row, _ := rows[0].(map[string]any)
	if row["week"] != week || row["event"] != "capture_saved" || row["participants"] != float64(6) || row["tasks"] != float64(21) || row["repeat_days_participants"] != float64(6) {
		t.Fatalf("aggregated row = %v", row)
	}
	// Switching off with clear wipes the table as well.
	if st := admin.do("PUT", "/api/admin/usage", map[string]any{"enabled": false, "password": adminPass, "clear": true}); st != 200 {
		t.Fatal(st)
	}
	admin.getJSON("/api/admin/usage", &out)
	if out["enabled"] != false {
		t.Fatalf("enabled after switching off: %v", out)
	}
	rows, _ = out["rows"].([]any)
	if len(rows) != 0 {
		t.Fatalf("rows after clearing = %v", out["rows"])
	}
	if n := countRows(t, e, "SELECT count(*) FROM product_usage"); n != 0 {
		t.Fatalf("clear left %d rows", n)
	}
}
