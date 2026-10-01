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
	"testing"
	"time"
)

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
func (w *blockingWriter) WriteHeader(int)     {}
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

func TestAuditLimitIsCappedAt500(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	if _, err := e.s.db.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 700)
		INSERT INTO audit_log(at, actor, action) SELECT 1, 'x', 'filler' FROM n`); err != nil {
		t.Fatal(err)
	}
	for limit, want := range map[string]int{"501": 500, "100000": 500, "500": 500, "5": 5, "0": 100, "-3": 100, "junk": 100} {
		var got []auditOut
		admin.getJSON("/api/admin/audit?limit="+limit, &got)
		if len(got) != want {
			t.Errorf("limit=%s returned %d rows, want %d", limit, len(got), want)
		}
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

func (d *deadlineRecorder) SetReadDeadline(t time.Time) error  { d.read = t; return nil }
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
