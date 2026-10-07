package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
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

func TestStaleDeleteKeepsNewerDoc(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	id := "d-2026-10-01"
	c.putDoc(id, `{"status":"amber"}`)
	c.putDoc(id, `{"status":"green"}`) // rev 2, which the stale client has not seen
	if st := c.do("DELETE", "/api/docs/"+id, nil, "If-Match", `"1"`); st != 409 {
		t.Errorf("delete at a stale rev = %d, want 409", st)
	}
	if got := c.docs()[id]; got.Rev != 2 {
		t.Errorf("the newer doc was lost: %+v", got)
	}
}

func TestRevisionsSurviveDeleteAndRecreate(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	id := "d-2026-10-01"
	c.putDoc(id, `{"status":"amber"}`) // rev 1: what a second device still holds
	c.do("DELETE", "/api/docs/"+id, nil)
	if _, out := c.putDoc(id, `{"status":"red"}`); out["rev"] == float64(1) {
		t.Fatalf("recreated doc reused rev 1: %v", out)
	}
	if st, _ := c.putDoc(id, `{"status":"amber"}`, "If-Match", `"1"`); st != 409 {
		t.Errorf("a write holding the pre-delete rev = %d, want 409", st)
	}
	if got := c.docs()[id]; string(got.Body) != `{"status":"red"}` {
		t.Errorf("the recreated doc was overwritten: %s", got.Body)
	}
}

func TestTombstonesEscapeQuota(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	prior := maxDocIdentitiesPerUser
	maxDocIdentitiesPerUser = 2
	defer func() { maxDocIdentitiesPerUser = prior }()
	for i := 0; i < 2; i++ {
		id := fmt.Sprintf("e-%d", i)
		if st, _ := alice.putDoc(id, `{}`); st != 200 {
			t.Fatal(st)
		}
		if st := alice.do("DELETE", "/api/docs/"+id, nil); st != 204 {
			t.Fatal(st)
		}
	}
	if status, _ := alice.putDoc("e-99", `{}`); status != 413 {
		t.Fatal("new identity not bounded", status)
	}
	if status, _ := alice.putDoc("e-0", `{}`); status != 200 {
		t.Fatal("existing identity must be reusable", status)
	}
	alice.do("DELETE", "/api/docs/e-0", nil)
	n := countRows(t, e, "SELECT count(*) FROM doc_revs")
	if n != 2 || countRows(t, e, "SELECT count(*) FROM docs") != 0 {
		t.Fatal(n)
	}
}

func TestImportAdmissionAndBoundedDecoder(t *testing.T) {
	e := newTestServer(t)
	alice, _ := e.addUser("alice", roleUser)
	bob, _ := e.addUser("bob", roleUser)
	charlie, _ := e.addUser("charlie", roleUser)
	request := func(c *client) *http.Request {
		r := httptest.NewRequest("POST", "/api/import", nil)
		u, _ := e.s.userByName(t.Context(), map[*client]string{alice: "alice", bob: "bob", charlie: "charlie"}[c])
		return r.WithContext(context.WithValue(r.Context(), authKey{}, &authInfo{u: u}))
	}
	releaseA, ok := e.s.admitImport(httptest.NewRecorder(), request(alice))
	if !ok {
		t.Fatal("first upload refused")
	}
	defer releaseA()
	rec := httptest.NewRecorder()
	if _, ok = e.s.admitImport(rec, request(alice)); ok || rec.Code != 429 || rec.Header().Get("Retry-After") == "" {
		t.Fatal("duplicate account admitted")
	}
	releaseB, ok := e.s.admitImport(httptest.NewRecorder(), request(bob))
	if !ok {
		t.Fatal("second account refused")
	}
	defer releaseB()
	if _, ok = e.s.admitImport(httptest.NewRecorder(), request(charlie)); ok {
		t.Fatal("global capacity exceeded")
	}
	for _, body := range []string{`{"e-1":{},"e-1":{}}`, `{"e-1":{}} {}`, `[]`} {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/import", strings.NewReader(body))
		if _, ok := readExport(rec, r); ok || rec.Code != 400 {
			t.Fatal("malformed export accepted", body)
		}
	}
	old := maxDocsPerUser
	maxDocsPerUser = 2
	defer func() { maxDocsPerUser = old }()
	rec = httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/import", strings.NewReader(`{"e-1":{},"e-2":{},"e-3":{}}`))
	if _, ok := readExport(rec, r); ok || rec.Code != 413 {
		t.Fatal("record count not bounded")
	}
}

// serve sends one request through the whole app, as the signed-in client, to a ResponseWriter of the test's choosing.
func (e *testEnv) serve(c *client, w http.ResponseWriter, method, path string, body io.Reader, headers ...string) {
	e.t.Helper()
	req := httptest.NewRequest(method, path, body)
	req.Header.Set("X-Requested-With", "jiggered")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	u, _ := url.Parse(e.ts.URL)
	for _, ck := range c.hc.Jar.Cookies(u) {
		req.AddCookie(ck)
	}
	e.s.routes().ServeHTTP(w, req)
}

// blockingWriter is a client that has stopped reading its socket: the first write never returns until released.
type blockingWriter struct {
	h       http.Header
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *blockingWriter) Header() http.Header { return w.h }

func (w *blockingWriter) WriteHeader(int) {}

func (w *blockingWriter) Write(b []byte) (int, error) {
	w.once.Do(func() { close(w.entered) })
	<-w.release
	return len(b), nil
}

// The database has a single connection, so whoever holds it while talking to a slow client stops everyone else.
func TestAClientThatStopsReadingItsConflictDoesNotFreezeTheDatabase(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	c.putDoc("settings", map[string]string{"pad": strings.Repeat("x", 200000)})
	w := &blockingWriter{h: http.Header{}, entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		e.serve(c, w, "PUT", "/api/docs/settings", strings.NewReader(`{"x":1}`), "If-Match", `"999"`) // stale: answered with the whole 200 KB doc
		close(done)
	}()
	select {
	case <-w.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the conflict was never written")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := e.s.db.PingContext(ctx); err != nil {
		t.Errorf("while one client is slow to read its 409, nobody else can use the database: %v", err)
	}
	close(w.release)
	<-done
}

func TestIfMatchMustBeValidWhenPresent(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	c.putDoc("d-2026-10-01", `{"v":"original"}`)
	for _, header := range [][2]string{{"If-Match", `""`}, {"If-Match", `"`}, {"If-Match", `abc`}, {"If-Match", `-1`}, {"If-None-Match", `""`}, {"If-None-Match", `1`}} {
		if st, _ := c.putDoc("d-2026-10-01", `{"v":"overwritten"}`, header[0], header[1]); st != 400 {
			t.Errorf("%s: %s gave %d, want 400 (an unreadable precondition must not mean 'no precondition')", header[0], header[1], st)
		}
	}
	if got := string(c.docs()["d-2026-10-01"].Body); got != `{"v":"original"}` {
		t.Errorf("a malformed precondition changed the document: %s", got)
	}
	if st, _ := c.putDoc("d-2026-10-01", `{"v":"two"}`, "If-Match", `"1"`); st != 200 {
		t.Errorf(`If-Match: "1" should still work: %d`, st)
	}
	if st, _ := c.putDoc("d-2026-10-01", `{"v":"three"}`, "If-Match", `2`); st != 200 {
		t.Errorf("an unquoted revision should still work: %d", st)
	}
}

// A database that fails halfway through a scan must say so. Serving the rows read so far as the whole list would
// make the page replace its copy with a partial one.
func TestAScanThatFailsHalfwayIsAnErrorNotAShortList(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	for i := 0; i < 300; i++ {
		c.putDoc(fmt.Sprintf("e-%d", 1000+i), map[string]string{"pad": strings.Repeat("x", 500)})
	}
	e.s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	// One page from the middle of the docs table: the scan reads some rows, then hits it.
	var leaves []int
	rows, err := e.s.db.Query("SELECT pageno FROM dbstat WHERE name = 'docs' AND pagetype = 'leaf' ORDER BY pageno")
	if err != nil {
		t.Skipf("no dbstat to find the table's pages: %v", err)
	}
	for rows.Next() {
		var n int
		rows.Scan(&n)
		leaves = append(leaves, n)
	}
	rows.Close()
	if len(leaves) < 8 {
		t.Fatalf("only %d leaf pages", len(leaves))
	}
	page := leaves[len(leaves)/2]
	e.s.db.Close()
	f, err := os.OpenFile(e.dbPath, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	junk := make([]byte, 4096)
	rand.New(rand.NewSource(1)).Read(junk)
	f.WriteAt(junk, int64(page-1)*4096)
	f.Close()
	db, err := openRaw(e.dbPath)
	if err != nil {
		t.Fatal(err)
	}
	e.s.db = db
	t.Cleanup(func() { db.Close() })
	if st := c.do("GET", "/api/me", nil); st != 200 {
		t.Skipf("the session table was damaged too (%d); this test needs only the docs table to be", st)
	}
	for _, path := range []string{"/api/docs", "/api/export"} {
		resp, body := c.req("GET", path, nil)
		if resp.StatusCode == 200 {
			var out map[string]json.RawMessage
			json.Unmarshal(body, &out)
			t.Errorf("GET %s answered 200 with %d of 300 docs after the database failed mid-scan", path, len(out))
		}
	}
}

// deadlineRecorder remembers the read and write deadlines a handler asked for.
type deadlineRecorder struct {
	*httptest.ResponseRecorder
	read, write time.Time
}

func (d *deadlineRecorder) SetReadDeadline(t time.Time) error { d.read = t; return nil }

func (d *deadlineRecorder) SetWriteDeadline(t time.Time) error { d.write = t; return nil }

// The server-wide read and write limits are 30 seconds; a person on a slow connection needs longer to move 25 MB.
func TestBigTransfersAskForMoreTimeThanTheServerWideLimit(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	c.putDoc("d-2026-10-01", `{"v":1}`)
	for _, call := range []struct{ method, path, body string }{
		{"GET", "/api/docs", ""},
		{"GET", "/api/export", ""},
		{"POST", "/api/import", `{}`},
	} {
		rec := &deadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
		start := time.Now()
		e.serve(c, rec, call.method, call.path, strings.NewReader(call.body))
		if rec.Code != 200 {
			t.Fatalf("%s %s: %d", call.method, call.path, rec.Code)
		}
		if call.method == "POST" && rec.read.Sub(start) < time.Minute {
			t.Errorf("%s %s: read deadline %v from now, want a minute or more", call.method, call.path, rec.read.Sub(start))
		}
		if rec.write.Sub(start) < time.Minute {
			t.Errorf("%s %s: write deadline %v from now, want a minute or more", call.method, call.path, rec.write.Sub(start))
		}
	}
}

// What a person can export they can import: the upload limit has to cover the whole storage quota.
func TestAnExportOfAFullAccountCanBeImportedBack(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	in := map[string]map[string]string{}
	for i := 0; i < 70; i++ { // 70 x 250 KB = 17.5 MB: over the old 16 MiB limit, well inside the 25 MiB quota
		in[fmt.Sprintf("e-%d", 5000+i)] = map[string]string{"pad": strings.Repeat("y", 250000)}
	}
	b, _ := json.Marshal(in)
	if resp, body := c.req("POST", "/api/import", b); resp.StatusCode != 200 {
		t.Fatalf("importing %d bytes (inside the quota): %d %s", len(b), resp.StatusCode, body)
	}
	if n := len(c.docs()); n != 70 {
		t.Errorf("%d docs after import, want 70", n)
	}
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, errors.New("connection reset") }

// A body that couldn't be read is not a body that was too large.
func TestAnUnreadableBodyIsNotReportedAsTooLarge(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	for _, call := range []struct{ method, path string }{{"PUT", "/api/docs/d-2026-10-01"}, {"POST", "/api/import"}} {
		rec := httptest.NewRecorder()
		e.serve(c, rec, call.method, call.path, errReader{})
		if rec.Code == http.StatusRequestEntityTooLarge {
			t.Errorf("%s %s answered 413 for a read error", call.method, call.path)
		}
	}
	rec := httptest.NewRecorder()
	e.serve(c, rec, "PUT", "/api/docs/d-2026-10-01", strings.NewReader(`{"pad":"`+strings.Repeat("x", maxBodySize)+`"}`))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("a body that really is too large: %d, want 413", rec.Code)
	}
}
