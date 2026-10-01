package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func gunzip(t *testing.T, b []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func versionOf(t *testing.T, e *testEnv) string {
	t.Helper()
	m := regexp.MustCompile(`/v/([0-9a-f]{12})/style\.css`).FindStringSubmatch(e.newClient().mustBody("GET", "/login"))
	if m == nil {
		t.Fatal("no versioned stylesheet on the login page")
	}
	return m[1]
}

func TestPublicTextIsCompressedForBrowsersThatAcceptIt(t *testing.T) {
	e := newTestServer(t)
	anon, signedIn := e.newClient(), e.signedInAdmin()
	ver := versionOf(t, e)
	for _, file := range []string{"/style.css", "/login.js", "/early-nav.js", "/app.js", "/model.js"} {
		anon := anon
		if file != "/style.css" && file != "/login.js" {
			anon = signedIn // the rest of the app sits behind sign-in
		}
		path := "/v/" + ver + file
		plainResp, plain := anon.req("GET", path, nil, "Accept-Encoding", "identity")
		if plainResp.StatusCode != 200 || plainResp.Header.Get("Content-Encoding") != "" {
			t.Fatalf("%s identity = %d %q", file, plainResp.StatusCode, plainResp.Header.Get("Content-Encoding"))
		}
		resp, body := anon.req("GET", path, nil, "Accept-Encoding", "gzip, deflate, br")
		if resp.StatusCode != 200 || resp.Header.Get("Content-Encoding") != "gzip" {
			t.Fatalf("%s gzip = %d %q", file, resp.StatusCode, resp.Header.Get("Content-Encoding"))
		}
		if !bytes.Equal(gunzip(t, body), plain) {
			t.Errorf("%s: the compressed body does not decode to the plain one", file)
		}
		if len(body) >= len(plain) {
			t.Errorf("%s: compressed %d bytes is not smaller than %d", file, len(body), len(plain))
		}
		if resp.Header.Get("Content-Length") == "" || resp.Header.Get("Vary") == "" || !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
			t.Errorf("%s: headers = %v, want Content-Length and Vary: Accept-Encoding", file, resp.Header)
		}
		if plainResp.Header.Get("Vary") == "" || !strings.Contains(plainResp.Header.Get("Vary"), "Accept-Encoding") {
			t.Errorf("%s: the plain answer must also say Vary: Accept-Encoding, or a cache could mix the two", file)
		}
		if ct := resp.Header.Get("Content-Type"); ct != plainResp.Header.Get("Content-Type") {
			t.Errorf("%s: type %q differs from the plain answer's %q", file, ct, plainResp.Header.Get("Content-Type"))
		}
		if resp.Header.Get("Cache-Control") != plainResp.Header.Get("Cache-Control") {
			t.Errorf("%s: cache rules changed with compression", file)
		}
	}
}

func TestCompressedRepresentationHasItsOwnTagAndRevalidates(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	path := "/v/" + versionOf(t, e) + "/style.css"
	plain, _ := anon.req("GET", path, nil, "Accept-Encoding", "identity")
	gz, _ := anon.req("GET", path, nil, "Accept-Encoding", "gzip")
	if gz.Header.Get("ETag") == "" || gz.Header.Get("ETag") == plain.Header.Get("ETag") {
		t.Fatalf("the two representations share a tag: %q and %q", plain.Header.Get("ETag"), gz.Header.Get("ETag"))
	}
	if resp, body := anon.req("GET", path, nil, "Accept-Encoding", "gzip", "If-None-Match", gz.Header.Get("ETag")); resp.StatusCode != 304 || len(body) != 0 {
		t.Errorf("its own tag = %d with %d bytes, want 304", resp.StatusCode, len(body))
	}
	if resp, _ := anon.req("GET", path, nil, "Accept-Encoding", "gzip", "If-None-Match", plain.Header.Get("ETag")); resp.StatusCode != 200 {
		t.Errorf("the plain tag against the compressed form = %d, want 200 (a different representation)", resp.StatusCode)
	}
	if resp, _ := anon.req("GET", path, nil, "Accept-Encoding", "identity", "If-None-Match", plain.Header.Get("ETag")); resp.StatusCode != 304 {
		t.Errorf("the plain tag against the plain form = %d, want 304", resp.StatusCode)
	}
	if resp, body := anon.req("HEAD", path, nil, "Accept-Encoding", "gzip"); resp.StatusCode != 200 || len(body) != 0 || resp.Header.Get("Content-Encoding") != "gzip" {
		t.Errorf("HEAD = %d, %d body bytes, encoding %q", resp.StatusCode, len(body), resp.Header.Get("Content-Encoding"))
	}
}

func TestGeneratedPagesAreCompressedToo(t *testing.T) {
	e := newTestServer(t)
	for _, page := range []string{"/login", "/"} {
		c := e.newClient()
		if page == "/" {
			c = e.signedInAdmin()
		}
		_, plain := c.req("GET", page, nil, "Accept-Encoding", "identity")
		resp, body := c.req("GET", page, nil, "Accept-Encoding", "gzip")
		if resp.Header.Get("Content-Encoding") != "gzip" || !bytes.Equal(gunzip(t, body), plain) || len(body) >= len(plain) {
			t.Errorf("%s: encoding %q, decodes equal: %v, %d vs %d bytes", page, resp.Header.Get("Content-Encoding"), bytes.Equal(gunzip(t, body), plain), len(body), len(plain))
		}
		if resp.Header.Get("Cache-Control") != "no-store" || !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
			t.Errorf("%s: headers = %v", page, resp.Header)
		}
	}
}

func TestCompressionIsOnlyForPublicTextAndOnlyWhenAsked(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	ver := versionOf(t, e)
	for _, ae := range []string{"", "identity", "gzip;q=0", "gzip; q=0.0", "br, deflate"} {
		resp, _ := anon.req("GET", "/v/"+ver+"/style.css", nil, "Accept-Encoding", ae)
		if resp.Header.Get("Content-Encoding") != "" {
			t.Errorf("Accept-Encoding %q still got %q", ae, resp.Header.Get("Content-Encoding"))
		}
	}
	if resp, _ := anon.req("GET", "/v/"+ver+"/style.css", nil, "Accept-Encoding", "deflate, gzip;q=0.5"); resp.Header.Get("Content-Encoding") != "gzip" {
		t.Error("gzip with a lower but non-zero q should be used")
	}
	// Fonts are already compressed.
	if resp, _ := anon.req("GET", "/fonts/atkinson-400-latin-ext.woff2", nil, "Accept-Encoding", "gzip"); resp.StatusCode != 200 || resp.Header.Get("Content-Encoding") != "" {
		t.Errorf("font = %d, encoding %q", resp.StatusCode, resp.Header.Get("Content-Encoding"))
	}
	// Nothing a person's data goes into is compressed: API answers and the database download stay as they are.
	c := e.signedInAdmin()
	c.putDoc("d-2026-10-01", `{"status":"green"}`)
	for _, p := range []string{"/api/docs", "/api/me", "/api/export"} {
		if resp, _ := c.req("GET", p, nil, "Accept-Encoding", "gzip"); resp.Header.Get("Content-Encoding") != "" {
			t.Errorf("%s was compressed (%q)", p, resp.Header.Get("Content-Encoding"))
		}
	}
	if resp, _ := c.req("POST", "/api/admin/backup", map[string]any{"password": adminPass}, "Accept-Encoding", "gzip"); resp.Header.Get("Content-Encoding") != "" {
		t.Error("the backup download was compressed")
	}
}

func TestAcceptsGzip(t *testing.T) {
	for header, want := range map[string]bool{
		"": false, "gzip": true, "GZIP": true, "gzip, deflate, br": true, "br;q=1.0, gzip;q=0.8": true,
		"gzip;q=0": false, "gzip; q=0.0": false, "identity": false, "gzipped": false, "x-gzip": false,
	} {
		r, _ := newGet(header)
		if got := acceptsGzip(r); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
		}
	}
}

func newGet(acceptEncoding string) (*http.Request, error) {
	r, err := http.NewRequest("GET", "/", nil)
	if acceptEncoding != "" {
		r.Header.Set("Accept-Encoding", acceptEncoding)
	}
	return r, err
}
