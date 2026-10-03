package main

import (
	"encoding/json"
	"testing"
)

func TestPlanningDocuments(t *testing.T) {
	for _, id := range []string{"p-2026-10-03", "p-2028-02-29"} {
		if !validDocID(id) {
			t.Errorf("valid plan ID rejected: %s", id)
		}
	}
	for _, id := range []string{"p-2026-02-29", "p-2026-13-01", "p-2026-1-03"} {
		if validDocID(id) {
			t.Errorf("invalid plan ID accepted: %s", id)
		}
	}
	good := `{"date":"2026-10-03","allowance":7,"entries":[{"id":"rest","a":"Quiet break","c":-2,"t":"12:00"}]}`
	if err := validateDoc("p-2026-10-03", json.RawMessage(good)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		`{"date":"2026-10-04"}`, `{"allowance":31}`, `{"allowance":-1}`, `{"allowance":1.5}`,
		`{"entries":[{"a":"Work","c":2}]}`,
		`{"entries":[{"id":"a","a":"Work","c":11}]}`,
		`{"entries":[{"id":"a","a":"Work","c":2,"t":"25:00"}]}`,
		`{"entries":[{"id":"a","a":"Work","c":2},{"id":"a","a":"Rest","c":-1}]}`,
	} {
		if validateDoc("p-2026-10-03", json.RawMessage(raw)) == nil {
			t.Errorf("invalid plan accepted: %s", raw)
		}
	}
}
