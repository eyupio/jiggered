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

func TestActivityLengths(t *testing.T) {
	entry := func(extra string) (plan, day string) {
		row := `{"id":"a","a":"Work","c":2` + extra + `}`
		return `{"entries":[` + row + `]}`, `{"date":"2026-10-03","entries":[` + row + `]}`
	}
	for _, extra := range []string{
		`,"t":"09:00","dur":120`,
		`,"dur":45`,               // a length with no start time
		`,"t":"09:00","dur":null`, // how the app clears a length
		`,"t":"09:00"`,            // and no length at all
		`,"t":"09:00","dur":5`,    // the shortest
		`,"t":"00:00","dur":1440`, // the whole day
		`,"t":"23:00","dur":60`,   // finishes exactly at midnight
		`,"t":"","dur":90`,        // an empty time is no time
	} {
		plan, day := entry(extra)
		if err := validateDoc("p-2026-10-03", json.RawMessage(plan)); err != nil {
			t.Errorf("plan %s refused: %v", extra, err)
		}
		if err := validateDoc("d-2026-10-03", json.RawMessage(day)); err != nil {
			t.Errorf("day %s refused: %v", extra, err)
		}
	}
	for _, extra := range []string{
		`,"dur":0`, `,"dur":4`, `,"dur":1441`, `,"dur":-30`, `,"dur":1.5`,
		`,"dur":"60"`, `,"dur":true`, `,"dur":[60]`,
		`,"t":"23:30","dur":60`,   // would run past midnight
		`,"t":"00:01","dur":1440`, // so would this
		`,"t":"25:00","dur":60`,   // not a time
	} {
		plan, day := entry(extra)
		if validateDoc("p-2026-10-03", json.RawMessage(plan)) == nil {
			t.Errorf("plan %s accepted", extra)
		}
		if validateDoc("d-2026-10-03", json.RawMessage(day)) == nil {
			t.Errorf("day %s accepted", extra)
		}
	}
}
