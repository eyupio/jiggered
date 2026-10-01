package main

import (
	"encoding/json"
	"testing"
)

func TestProductDefaultsPermissionsOrderingAndIsolation(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	user, _ := e.addUser("alice", "user")
	user.putDoc("settings", `{"budget":7,"activities":[{"a":"Personal","c":0}]}`)
	resp, b := admin.req("GET", "/api/defaults", nil)
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode, string(b))
	}
	tag := resp.Header.Get("ETag")
	var defaults productDefaults
	if err := json.Unmarshal(b, &defaults); err != nil {
		t.Fatal(err)
	}
	defaults.Activities[0], defaults.Activities[1] = defaults.Activities[1], defaults.Activities[0]
	defaults.Symptoms = []string{"Custom", "Other"}
	defaults.Budget = 12
	if st := user.do("PUT", "/api/admin/defaults", defaults, "If-Match", tag); st != 403 {
		t.Fatal("regular user write", st)
	}
	if st := e.newClient().do("GET", "/api/defaults", nil); st != 401 {
		t.Fatal("anonymous read", st)
	}
	if st := admin.do("PUT", "/api/admin/defaults", defaults, "If-Match", tag); st != 200 {
		t.Fatal("admin save", st)
	}
	if st := admin.do("PUT", "/api/admin/defaults", defaults, "If-Match", tag); st != 409 {
		t.Fatal("stale write", st)
	}
	var got productDefaults
	user.getJSON("/api/defaults", &got)
	if got.Symptoms[0] != "Custom" || got.Activities[0].A != defaults.Activities[0].A {
		t.Fatal("order not preserved", got)
	}
	var docs listed
	user.getJSON("/api/docs", &docs)
	if string(docs["settings"].Body) != `{"budget":7,"activities":[{"a":"Personal","c":0}]}` {
		t.Fatal("personal choices changed")
	}
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action='defaults_changed'"); n != 1 {
		t.Fatal("audit", n)
	}
}
func TestProductDefaultsValidationAndPersistence(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	resp, b := admin.req("GET", "/api/defaults", nil)
	tag := resp.Header.Get("ETag")
	var d productDefaults
	json.Unmarshal(b, &d)
	for _, change := range []func(*productDefaults){func(d *productDefaults) { d.Budget = 31 }, func(d *productDefaults) { d.SleepPenalty = 31 }, func(d *productDefaults) { d.Locale = "GB" }, func(d *productDefaults) { d.Symptoms = []string{"Headache", "headache"} }, func(d *productDefaults) { d.Triggers = []string{" padded "} }, func(d *productDefaults) { d.Activities = nil }} {
		var v productDefaults
		json.Unmarshal(b, &v)
		change(&v)
		if st := admin.do("PUT", "/api/admin/defaults", v, "If-Match", tag); st != 400 {
			t.Fatal("invalid save", st, v)
		}
	}
	d.Activities[0].C = 0
	if st := admin.do("PUT", "/api/admin/defaults", d, "If-Match", tag); st != 200 {
		t.Fatal(st)
	}
	var stored string
	if err := e.s.db.QueryRow("SELECT value FROM instance_settings WHERE key='product_defaults'").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var got productDefaults
	json.Unmarshal([]byte(stored), &got)
	if got.Activities[0].C != 0 {
		t.Fatal("zero cost did not persist")
	}
}

func TestDamagedDefaultsCanBeRepairedInAdmin(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	if _, err := e.s.db.Exec("INSERT INTO instance_settings(key,value,updated_at) VALUES('product_defaults','broken JSON',1)"); err != nil {
		t.Fatal(err)
	}
	resp, b := admin.req("GET", "/api/defaults", nil)
	if resp.StatusCode != 200 || resp.Header.Get("X-Jiggered-Defaults-Fallback") != "true" {
		t.Fatal("cannot read fallback", resp.StatusCode, string(b))
	}
	var defaults productDefaults
	if err := json.Unmarshal(b, &defaults); err != nil {
		t.Fatal(err)
	}
	if st := admin.do("PUT", "/api/admin/defaults", defaults, "If-Match", resp.Header.Get("ETag")); st != 200 {
		t.Fatal("cannot repair", st)
	}
	resp, _ = admin.req("GET", "/api/defaults", nil)
	if resp.Header.Get("X-Jiggered-Defaults-Fallback") != "" {
		t.Fatal("defaults remain damaged")
	}
}

func TestProductDefaultsKeepSymptomAndTriggerGroups(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	resp, b := admin.req("GET", "/api/defaults", nil)
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode, string(b))
	}
	tag := resp.Header.Get("ETag")
	var d productDefaults
	if err := json.Unmarshal(b, &d); err != nil {
		t.Fatal(err)
	}
	if d.SymptomGroups["Headache"] == "" || d.TriggerGroups["Poor sleep"] == "" {
		t.Fatal("factory defaults carry groups", d.SymptomGroups)
	}
	d.Symptoms = []string{"Headache", "Cough"}
	d.SymptomGroups = map[string]string{"Headache": "Head", "Gone": "Dropped"}
	d.TriggerGroups = nil
	if st := admin.do("PUT", "/api/admin/defaults", d, "If-Match", tag); st != 200 {
		t.Fatal("save", st)
	}
	var got productDefaults
	admin.getJSON("/api/defaults", &got)
	if len(got.SymptomGroups) != 1 || got.SymptomGroups["Headache"] != "Head" {
		t.Fatal("unknown names should be dropped", got.SymptomGroups)
	}
	if got.TriggerGroups == nil {
		t.Fatal("an empty map must be stored as an object, not dropped")
	}
	d.SymptomGroups = map[string]string{"Headache": " padded "}
	resp, _ = admin.req("GET", "/api/defaults", nil)
	if st := admin.do("PUT", "/api/admin/defaults", d, "If-Match", resp.Header.Get("ETag")); st != 400 {
		t.Fatal("padded group name should be refused", st)
	}
}
