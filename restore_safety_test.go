package main

import (
	"encoding/json"
	"testing"
)

func previewRestore(t *testing.T, c *client, mode, file string) map[string]any {
	t.Helper()
	resp, b := c.req("POST", "/api/restore/preview?mode="+mode, file)
	if resp.StatusCode != 200 {
		t.Fatalf("preview=%d %s", resp.StatusCode, b)
	}
	var result map[string]any
	json.Unmarshal(b, &result)
	return result
}
func TestRestorePreviewCommitAndScope(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	other, _ := e.addUser("restoreuser", roleUser)
	c.putDoc("d-2026-10-01", `{"status":"red"}`)
	file := `{"d-2026-10-01":{"status":"green"},"e-1":{"when":"2026-10-01T10:00","notes":"legacy"}}`
	p := previewRestore(t, c, "add", file)
	if p["additions"] != float64(1) || p["matches"] != float64(1) || p["overwrites"] != float64(0) {
		t.Fatalf("preview counts=%v", p)
	}
	if len(c.docs()) != 1 {
		t.Fatal("preview wrote records")
	}
	resp, b := other.req("POST", "/api/restore?mode=add", file, "If-Match", p["token"].(string))
	if resp.StatusCode != 409 {
		t.Fatalf("other account token=%d %s", resp.StatusCode, b)
	}
	resp, b = c.req("POST", "/api/restore?mode=add", file, "If-Match", p["token"].(string))
	if resp.StatusCode != 200 {
		t.Fatalf("restore=%d %s", resp.StatusCode, b)
	}
	if string(c.docs()["d-2026-10-01"].Body) != `{"status":"red"}` {
		t.Fatal("keep mode replaced existing")
	}
	p = previewRestore(t, c, "overwrite", file)
	if p["overwrites"] != float64(2) {
		t.Fatal(p)
	}
	resp, b = c.req("POST", "/api/restore?mode=overwrite", file, "If-Match", p["token"].(string))
	if resp.StatusCode != 200 {
		t.Fatalf("overwrite=%d %s", resp.StatusCode, b)
	}
	if string(c.docs()["d-2026-10-01"].Body) != `{"status":"green"}` {
		t.Fatal("overwrite did not replace")
	}
}
func TestRestoreRejectsStaleOrChangedPreview(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	file := `{"d-2026-10-01":{"status":"green"}}`
	p := previewRestore(t, c, "add", file)
	for _, tc := range []struct{ mode, file string }{{"overwrite", file}, {"add", `{"d-2026-10-02":{"status":"green"}}`}} {
		resp, _ := c.req("POST", "/api/restore?mode="+tc.mode, tc.file, "If-Match", p["token"].(string))
		if resp.StatusCode != 409 {
			t.Fatal("changed selection accepted")
		}
	}
	c.putDoc("e-1", `{"notes":"saved elsewhere"}`)
	resp, _ := c.req("POST", "/api/restore?mode=add", file, "If-Match", p["token"].(string))
	if resp.StatusCode != 409 || len(c.docs()) != 1 {
		t.Fatal("stale restore wrote records")
	}
}
func TestRestoreMalformedFieldsRejectEntireFile(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	for _, invalid := range []string{`{"entries":"broken"}`, `{"poorSleep":"yes"}`, `{"entries":[{"a":"walk","c":0,"t":"25:00"}]}`, `{"entries":[{"a":"walk","c":1,"id":"same"},{"a":"walk","c":1,"id":"same"}]}`, `{"date":"2026-10-02"}`} {
		file := `{"d-2026-10-01":` + invalid + `,"e-1":{"notes":"valid legacy"}}`
		for _, path := range []string{"/api/restore/preview", "/api/restore"} {
			resp, b := c.req("POST", path, file)
			if resp.StatusCode != 422 {
				t.Fatalf("invalid=%d %s", resp.StatusCode, b)
			}
		}
		if len(c.docs()) != 0 {
			t.Fatal("invalid file partially restored")
		}
	}
	for id, raw := range map[string]string{"settings": `{"budget":0}`, "e-1": `{"symptoms":"bad"}`, "e-2": `{"when":"2026-02-30T10:00"}`} {
		if validateRestoreDoc(id, json.RawMessage(raw)) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	if validateRestoreDoc("e-3", json.RawMessage(`{"notes":"old export"}`)) != nil {
		t.Fatal("legacy optional fields rejected")
	}
}
func TestRestoreQuotaPreviewDoesNotWrite(t *testing.T) {
	old := maxDocsPerUser
	maxDocsPerUser = 1
	t.Cleanup(func() { maxDocsPerUser = old })
	e := newTestServer(t)
	c := e.signedInAdmin()
	resp, _ := c.req("POST", "/api/restore/preview", `{"e-1":{},"e-2":{}}`)
	if resp.StatusCode != 413 || len(c.docs()) != 0 {
		t.Fatal("quota preview mutated data")
	}
}
