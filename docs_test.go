package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestDocIDAllowList(t *testing.T) {
	for id, want := range map[string]bool{
		"d-2026-10-01": true, "d-2024-02-29": true, "e-1790000000000": true, "e-1": true, "settings": true,
		"d-2026-13-01": false, "d-2025-02-29": false, "d-2026-1-1": false, "d-2026-10-01x": false,
		"e-": false, "e-abc": false, "e-" + strings.Repeat("9", 21): false,
		"t-fretboard": true, "t-a": true, "t-1": false, "t-": false, "t-Fretboard": false, "t-fret_board": false, "t-" + strings.Repeat("a", 32): false,
		"x-1": false, "": false, "../etc": false, "settings2": false, "D-2026-10-01": false,
		strings.Repeat("a", 65): false, "a b": false,
	} {
		if validDocID(id) != want {
			t.Errorf("validDocID(%q) != %v", id, want)
		}
	}
}

func TestPutGetDeleteAndRevisions(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	if got := c.docs(); len(got) != 0 {
		t.Fatalf("new account has docs: %v", got)
	}

	st, out := c.putDoc("d-2026-10-01", `{"status":"amber"}`)
	if st != 200 || out["rev"] != float64(1) {
		t.Fatalf("create = %d %v", st, out)
	}
	st, out = c.putDoc("d-2026-10-01", `{"status":"green"}`)
	if st != 200 || out["rev"] != float64(2) {
		t.Fatalf("update = %d %v", st, out)
	}
	got := c.docs()["d-2026-10-01"]
	if got.Rev != 2 || string(got.Body) != `{"status":"green"}` {
		t.Errorf("stored = rev %d %s", got.Rev, got.Body)
	}
	if st := c.do("DELETE", "/api/docs/d-2026-10-01", nil); st != 204 {
		t.Errorf("delete = %d", st)
	}
	if st := c.do("DELETE", "/api/docs/d-2026-10-01", nil); st != 204 {
		t.Errorf("deleting what is already gone = %d, want 204 (idempotent)", st)
	}
	if len(c.docs()) != 0 {
		t.Error("doc still listed after delete")
	}
	if _, out := c.putDoc("d-2026-10-01", `{"status":"red"}`); out["rev"] != float64(3) {
		t.Errorf("recreating carries on from the deleted revision (2): %v", out)
	}
}

func TestOptimisticConcurrency(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	id := "d-2026-10-01"

	if st, out := c.putDoc(id, `{"n":1}`, "If-None-Match", "*"); st != 200 || out["rev"] != float64(1) {
		t.Fatalf("create if absent = %d %v", st, out)
	}
	// Creating again must fail and hand back what is there, so the client can merge.
	st, out := c.putDoc(id, `{"n":2}`, "If-None-Match", "*")
	if st != 409 || out["rev"] != float64(1) || fmt.Sprint(out["body"]) != "map[n:1]" {
		t.Fatalf("create when present = %d %v", st, out)
	}
	if st, out := c.putDoc(id, `{"n":3}`, "If-Match", `"1"`); st != 200 || out["rev"] != float64(2) {
		t.Fatalf("update at the right rev = %d %v", st, out)
	}
	st, out = c.putDoc(id, `{"n":4}`, "If-Match", `"1"`)
	if st != 409 || out["rev"] != float64(2) || fmt.Sprint(out["body"]) != "map[n:3]" {
		t.Fatalf("update at a stale rev = %d %v", st, out)
	}
	if got := c.docs()[id]; string(got.Body) != `{"n":3}` {
		t.Errorf("a refused write changed the doc: %s", got.Body)
	}
	if st, _ := c.putDoc(id, `{"n":5}`, "If-Match", "2"); st != 200 {
		t.Errorf("unquoted If-Match = %d", st)
	}
	// Rev 0 means "I think this doesn't exist".
	if st, out := c.putDoc("d-2026-10-02", `{}`, "If-Match", `"0"`); st != 200 || out["rev"] != float64(1) {
		t.Errorf("If-Match 0 on a new doc = %d %v", st, out)
	}
	st, _ = c.putDoc("d-2026-10-02", `{}`, "If-Match", `"0"`)
	if st != 409 {
		t.Errorf("If-Match 0 on an existing doc = %d, want 409", st)
	}
	// A write that expects the doc to exist when someone deleted it.
	c.do("DELETE", "/api/docs/d-2026-10-02", nil)
	st, out = c.putDoc("d-2026-10-02", `{}`, "If-Match", `"1"`)
	if st != 409 || out["rev"] != float64(0) || out["body"] != nil {
		t.Errorf("update of a deleted doc = %d %v, want 409 with rev 0 and no body", st, out)
	}
	for _, bad := range [][2]string{{"If-Match", "abc"}, {"If-Match", "-1"}, {"If-None-Match", "abc"}} {
		if st, _ := c.putDoc("d-2026-10-03", `{}`, bad[0], bad[1]); st != 400 {
			t.Errorf("%s: %s = %d, want 400", bad[0], bad[1], st)
		}
	}
}

// Many devices saving the same doc: every success must get its own revision and
// the final doc must be one of them, never a mix.
func TestConcurrentWritesNeverLoseTheRevisionOrder(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	c.putDoc("d-2026-10-01", `{"n":0}`)

	var wg sync.WaitGroup
	var won atomic.Int64
	seen := sync.Map{}
	for i := 1; i <= 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for { // the client's loop: read the rev, try, on conflict retry from the new rev
				rev := c.docs()["d-2026-10-01"].Rev
				st, out := c.putDoc("d-2026-10-01", fmt.Sprintf(`{"n":%d}`, i), "If-Match", fmt.Sprint(rev))
				if st == 200 {
					won.Add(1)
					if _, dup := seen.LoadOrStore(out["rev"], true); dup {
						t.Errorf("revision %v handed out twice", out["rev"])
					}
					return
				}
			}
		}()
	}
	wg.Wait()
	if got := c.docs()["d-2026-10-01"].Rev; got != 21 || won.Load() != 20 {
		t.Errorf("final rev %d after %d successful writes, want 21 after 20", got, won.Load())
	}
}

func TestPutValidatesTheBody(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	for name, body := range map[string]string{
		"array": `[1,2]`, "string": `"x"`, "number": `3`, "null": `null`, "not json": `{`, "empty": ``,
	} {
		if st, _ := c.putDoc("d-2026-10-01", body); st != 400 {
			t.Errorf("%s body = %d, want 400", name, st)
		}
	}
	if st, _ := c.putDoc("d-2026-10-01", `{"pad":"`+strings.Repeat("x", maxBodySize)+`"}`); st != 413 {
		t.Errorf("oversize body = %d, want 413", st)
	}
	if st, _ := c.putDoc("not-allowed", `{}`); st != 400 {
		t.Errorf("unknown id = %d, want 400", st)
	}
	if st := c.do("DELETE", "/api/docs/not-allowed", nil); st != 400 {
		t.Errorf("delete unknown id = %d, want 400", st)
	}
	if got := c.docs(); len(got) != 0 {
		t.Errorf("rejected writes stored something: %v", got)
	}
}

func TestQuotas(t *testing.T) {
	oldDocs, oldBytes := maxDocsPerUser, maxBytesPerUser
	t.Cleanup(func() { maxDocsPerUser, maxBytesPerUser = oldDocs, oldBytes })
	maxDocsPerUser, maxBytesPerUser = 3, 200

	e := newTestServer(t)
	c := e.signedInAdmin()
	for _, d := range []string{"01", "02", "03"} {
		if st, _ := c.putDoc("d-2026-10-"+d, `{}`); st != 200 {
			t.Fatalf("within quota: %d", st)
		}
	}
	if st, _ := c.putDoc("d-2026-10-04", `{}`); st != 413 {
		t.Errorf("a fourth doc = %d, want 413", st)
	}
	if st, _ := c.putDoc("d-2026-10-01", `{"still":"fine"}`); st != 200 {
		t.Errorf("updating an existing doc at the doc limit = %d, want 200", st)
	}
	if st, out := c.putDoc("d-2026-10-02", `{"pad":"`+strings.Repeat("x", 250)+`"}`); st != 413 {
		t.Errorf("over the byte limit = %d %v, want 413", st, out)
	}
	if st := c.do("DELETE", "/api/docs/d-2026-10-03", nil); st != 204 {
		t.Fatal("delete")
	}
	if st, _ := c.putDoc("d-2026-10-04", `{}`); st != 200 {
		t.Errorf("room again after a delete = %d", st)
	}
	// Quotas are per account.
	other, _ := e.addUser("bob", roleUser)
	if st, _ := other.putDoc("d-2026-10-01", `{}`); st != 200 {
		t.Errorf("another account has its own quota: %d", st)
	}
}

func TestExportIsAPlainMapAndImportReadsItBack(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	c.putDoc("d-2026-10-01", `{"status":"green","entries":[]}`)
	c.putDoc("e-1790000000000", `{"notes":"café ☕"}`)

	resp, b := c.req("GET", "/api/export", nil)
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Disposition"), `filename="jiggered-admin-`) {
		t.Fatalf("export = %d %q", resp.StatusCode, resp.Header.Get("Content-Disposition"))
	}
	var plain map[string]json.RawMessage
	if err := json.Unmarshal(b, &plain); err != nil || len(plain) != 2 || string(plain["d-2026-10-01"]) != `{"status":"green","entries":[]}` {
		t.Fatalf("export is not the plain {id: body} map: %s", b)
	}

	// Restore into a different account.
	other, _ := e.addUser("bob", roleUser)
	st, out := postImport(other, "", string(b))
	if st != 200 || out["imported"] != float64(2) || out["skipped"] != float64(0) || out["invalid"] != float64(0) {
		t.Fatalf("import = %d %v", st, out)
	}
	if got := other.docs(); len(got) != 2 || string(got["e-1790000000000"].Body) != `{"notes":"café ☕"}` || got["d-2026-10-01"].Rev != 1 {
		t.Errorf("imported docs = %v", got)
	}
}

func postImport(c *client, mode, body string) (int, map[string]any) {
	path := "/api/import"
	if mode != "" {
		path += "?mode=" + mode
	}
	resp, b := c.req("POST", path, body)
	var out map[string]any
	json.Unmarshal(b, &out)
	return resp.StatusCode, out
}

func TestImportModes(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	c.putDoc("d-2026-10-01", `{"status":"red"}`)
	file := `{"d-2026-10-01":{"status":"green"},"d-2026-10-02":{"status":"amber"},"junk":{},"e-5":[1],"d-2026-10-03":null}`

	st, out := postImport(c, "add", file)
	if st != 200 || out["imported"] != float64(1) || out["skipped"] != float64(1) || out["invalid"] != float64(3) {
		t.Fatalf("add = %d %v", st, out)
	}
	got := c.docs()
	if string(got["d-2026-10-01"].Body) != `{"status":"red"}` || got["d-2026-10-01"].Rev != 1 {
		t.Errorf("add mode must keep what is there: %v", got["d-2026-10-01"])
	}
	if string(got["d-2026-10-02"].Body) != `{"status":"amber"}` {
		t.Error("add mode must add what is missing")
	}

	st, out = postImport(c, "overwrite", file)
	if st != 200 || out["imported"] != float64(2) || out["skipped"] != float64(0) {
		t.Fatalf("overwrite = %d %v", st, out)
	}
	got = c.docs()
	if string(got["d-2026-10-01"].Body) != `{"status":"green"}` || got["d-2026-10-01"].Rev != 2 {
		t.Errorf("overwrite must replace and bump the revision: %v", got["d-2026-10-01"])
	}

	for name, body := range map[string]string{"array": `[]`, "not json": `nope`, "null": `null`, "empty": ``} {
		if st, _ := postImport(c, "", body); st != 400 {
			t.Errorf("%s file = %d, want 400", name, st)
		}
	}
	if st, _ := postImport(c, "wipe", `{}`); st != 400 {
		t.Errorf("unknown mode = %d, want 400", st)
	}
}

func TestImportIsAllOrNothing(t *testing.T) {
	oldDocs := maxDocsPerUser
	t.Cleanup(func() { maxDocsPerUser = oldDocs })
	maxDocsPerUser = 2

	e := newTestServer(t)
	c := e.signedInAdmin()
	st, out := postImport(c, "", `{"d-2026-10-01":{},"d-2026-10-02":{},"d-2026-10-03":{}}`)
	if st != 413 {
		t.Fatalf("over-quota import = %d %v, want 413", st, out)
	}
	if got := c.docs(); len(got) != 0 {
		t.Errorf("a refused import left %d docs behind", len(got))
	}
}

func TestImportIsAudited(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	postImport(c, "overwrite", `{"d-2026-10-01":{}}`)
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'import' AND actor = 'admin' AND detail LIKE 'overwrite: 1 imported%'"); n != 1 {
		t.Error("import should be in the audit log (counts only)")
	}
}

func TestDeleteNeedsTheCurrentRevisionWhenOneIsGiven(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	id := "e-1790000000000"
	c.putDoc(id, `{"n":1}`)
	c.putDoc(id, `{"n":2}`)
	resp, b := c.req("DELETE", "/api/docs/"+id, nil, "If-Match", `"1"`)
	if resp.StatusCode != 409 || !strings.Contains(string(b), `"rev":2`) || !strings.Contains(string(b), `"n":2`) {
		t.Fatalf("stale delete = %d %s, want 409 with the current copy", resp.StatusCode, b)
	}
	if st := c.do("DELETE", "/api/docs/"+id, nil, "If-Match", `"abc"`); st != 400 {
		t.Errorf("bad If-Match = %d, want 400", st)
	}
	if st := c.do("DELETE", "/api/docs/"+id, nil, "If-Match", `"2"`); st != 204 {
		t.Errorf("delete at the current rev = %d", st)
	}
	if st := c.do("DELETE", "/api/docs/"+id, nil, "If-Match", `"2"`); st != 204 {
		t.Errorf("deleting what is already gone = %d, want 204", st)
	}
	// A client from before this change sends no If-Match and still deletes.
	c.putDoc(id, `{"n":3}`)
	if st := c.do("DELETE", "/api/docs/"+id, nil); st != 204 || len(c.docs()) != 0 {
		t.Errorf("unconditional delete = %d, %d docs left", st, len(c.docs()))
	}
}

func TestImportAndRestoreContinueARevisionAfterDelete(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	id := "d-2026-10-01"
	c.putDoc(id, `{"n":1}`)
	c.putDoc(id, `{"n":2}`)
	c.do("DELETE", "/api/docs/"+id, nil)
	if st := c.do("POST", "/api/import?mode=add", map[string]any{id: map[string]any{"n": 9}}); st != 200 {
		t.Fatalf("import = %d", st)
	}
	if got := c.docs()[id]; got.Rev != 3 {
		t.Errorf("imported after a delete at rev 2 got rev %d, want 3", got.Rev)
	}
}

func TestDeletedRevisionsAreScopedToThePerson(t *testing.T) {
	e := newTestServer(t)
	a := e.signedInAdmin()
	b, _ := e.addUser("bea", "user")
	id := "d-2026-10-01"
	a.putDoc(id, `{"n":1}`)
	a.putDoc(id, `{"n":2}`)
	a.do("DELETE", "/api/docs/"+id, nil)
	if _, out := b.putDoc(id, `{"n":1}`); out["rev"] != float64(1) {
		t.Errorf("another person's deleted doc changed this one's revision: %v", out)
	}
	if n := countRows(t, e, "SELECT count(*) FROM doc_revs"); n != 1 {
		t.Errorf("doc_revs has %d rows, want 1", n)
	}
}

func TestToolDocsAreBounded(t *testing.T) {
	for body, ok := range map[string]bool{
		`{"v":1,"tool":"fretboard","items":{"a1":{"k":"card","t":"Sleep","x":0.5,"y":0.1,"s":"todo"}},"three":[{"id":"x","t":"Walk","done":false}]}`: true,
		`{"items":{}}`: true,
		`{"items":{"a1":{"k":"card","t":"Sleep","x":1.5,"y":0.1}}}`: false,
		`{"items":{"a1":"Sleep"}}`:                                  false,
		`{"items":[]}`:                                              false,
		`{"items":{"bad id":{"t":"Sleep"}}}`:                        false,
		`{"items":{"a1":{"t":"` + strings.Repeat("x", 241) + `"}}}`: false,
		`{"three":{}}`:                                              false,
		`{"three":[{"t":1}]}`:                                       false,
		`{"future":"field"}`:                                        true,
	} {
		if err := validateDoc("t-fretboard", []byte(body)); (err == nil) != ok {
			t.Errorf("validateDoc(t-fretboard, %s) = %v, want ok=%v", body, err, ok)
		}
	}
}
