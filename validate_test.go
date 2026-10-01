package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

// One list of documents, sent down every way a document can arrive. A valid one must be accepted by all of them and
// come back out exactly as it went in (unknown fields included); an invalid one must be refused by all of them.
var validDocs = []struct{ name, id, body string }{
	{"modern day", "d-2026-10-01", `{"date":"2026-10-01","status":"amber","poorSleep":true,"budget":12,"sleepPenalty":2,"entries":[{"id":"x1","a":"Walk","c":-2,"t":"09:00"},{"id":"x2","a":"Call","c":3,"t":""}]}`},
	{"sparse legacy day", "d-2026-10-02", `{"status":"green"}`},
	{"day with no check-in", "d-2026-10-03", `{"status":null,"entries":[]}`},
	{"day with fields from a newer client", "d-2026-10-04", `{"status":"red","futureField":{"nested":[1,2,3]},"entries":[{"a":"Rest","c":-1,"mood":"fine"}]}`},
	{"episode", "e-1790000000001", `{"when":"2026-10-01T09:00","endedAt":"2026-10-01T09:30","symptoms":["Headache"],"before":["Poor sleep"],"notes":"fine","duration":"Under 15 min"}`},
	{"legacy episode with only notes", "e-1790000000002", `{"notes":"old export"}`},
	{"episode with fields from a newer client", "e-1790000000003", `{"when":"2026-10-01T09:00","symptoms":[],"extension":[1,2]}`},
	{"sparse legacy settings", "settings", `{"budget":3}`},
	{"settings with an unknown field", "settings", `{"budget":9,"activities":[{"a":"Walk","c":-1}],"somethingNew":true}`},
	{"settings with a group for a name no longer in the list", "settings", `{"budget":9,"symptoms":["Renamed"],"symptomGroups":{"Old name":"Head"},"triggers":["Heat"],"triggerGroups":{"Old trigger":"Body"}}`},
}

var invalidDocs = []struct{ name, id, body string }{
	{"activity points out of range", "d-2026-10-01", `{"entries":[{"a":"Fictional activity","c":999}]}`},
	{"entries is not a list", "d-2026-10-01", `{"entries":"broken"}`},
	{"unknown status", "d-2026-10-01", `{"status":"purple"}`},
	{"date does not match the id", "d-2026-10-01", `{"date":"2026-10-02"}`},
	{"poorSleep is text", "d-2026-10-01", `{"poorSleep":"yes"}`},
	{"budget of zero", "d-2026-10-01", `{"budget":0}`},
	{"activity time is not HH:MM", "d-2026-10-01", `{"entries":[{"a":"Walk","c":1,"t":"9am"}]}`},
	{"activity with no name", "d-2026-10-01", `{"entries":[{"a":"  ","c":1}]}`},
	{"episode time is not a time", "e-1790000000001", `{"when":"yesterday"}`},
	{"symptoms hold a number", "e-1790000000001", `{"symptoms":["Headache",7]}`},
	{"settings budget too large", "settings", `{"budget":99}`},
	{"settings group with surrounding spaces", "settings", `{"budget":9,"symptoms":["Dizzy"],"symptomGroups":{"Dizzy":" Head "}}`},
	{"a JSON array, not an object", "e-1790000000001", `[1,2]`},
}

func sameJSON(t *testing.T, got, want string) bool {
	t.Helper()
	var a, b any
	if json.Unmarshal([]byte(got), &a) != nil || json.Unmarshal([]byte(want), &b) != nil {
		return false
	}
	return reflect.DeepEqual(a, b)
}

func TestValidDocumentsAreAcceptedEverywhereAndKeptAsSent(t *testing.T) {
	for _, tc := range validDocs {
		t.Run(tc.name, func(t *testing.T) {
			e := newTestServer(t)
			c := e.signedInAdmin()

			if st, out := c.putDoc(tc.id, tc.body); st != 200 {
				t.Fatalf("PUT = %d %v", st, out)
			}
			if got := string(c.docs()[tc.id].Body); !sameJSON(t, got, tc.body) {
				t.Errorf("PUT changed the document:\n got  %s\n want %s", got, tc.body)
			}

			// Export it, then bring it back into a different account by import and by restore.
			exported := c.mustBody("GET", "/api/export")
			other, _ := e.addUser("receiver", roleUser)
			if st, out := postImport(other, "add", exported); st != 200 || out["imported"] != float64(1) || out["invalid"] != float64(0) {
				t.Errorf("import of its own export = %d %v", st, out)
			}
			resp, b := other.req("POST", "/api/restore/preview?mode=add", exported)
			if resp.StatusCode != 200 {
				t.Errorf("restore preview of its own export = %d %s", resp.StatusCode, b)
			}
			if got := string(other.docs()[tc.id].Body); !sameJSON(t, got, tc.body) {
				t.Errorf("import changed the document:\n got  %s\n want %s", got, tc.body)
			}
		})
	}
}

func TestInvalidDocumentsAreRefusedEverywhere(t *testing.T) {
	for _, tc := range invalidDocs {
		t.Run(tc.name, func(t *testing.T) {
			e := newTestServer(t)
			c := e.signedInAdmin()

			if st, out := c.putDoc(tc.id, tc.body); st != 400 && st != 422 {
				t.Errorf("PUT = %d %v, want it refused", st, out)
			}
			if n := len(c.docs()); n != 0 {
				t.Errorf("a refused PUT stored %d documents", n)
			}
			file := `{"` + tc.id + `":` + tc.body + `}`
			if st, out := postImport(c, "add", file); st != 200 || out["imported"] != float64(0) || out["invalid"] != float64(1) {
				t.Errorf("import = %d %v, want 0 imported and 1 invalid", st, out)
			}
			if resp, b := c.req("POST", "/api/restore/preview?mode=add", file); resp.StatusCode != 422 {
				t.Errorf("restore preview = %d %s, want 422", resp.StatusCode, b)
			}
			if n := len(c.docs()); n != 0 {
				t.Errorf("a refused document reached storage (%d documents)", n)
			}
		})
	}
}

// Refusing a save must not cost the person the change: the client keeps a refused write in Recovery, which relies on
// this being a 4xx that is not a conflict.
func TestARefusedSaveIsAClientErrorWithAReason(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	resp, b := c.req("PUT", "/api/docs/d-2026-10-01", `{"entries":[{"a":"Walk","c":999}]}`, "If-None-Match", "*")
	var out map[string]any
	json.Unmarshal(b, &out)
	if resp.StatusCode != 422 || out["error"] == nil || out["rev"] != nil {
		t.Errorf("= %d %v, want 422 with an error and no conflict body", resp.StatusCode, out)
	}
}
