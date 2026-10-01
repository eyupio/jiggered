package main

import (
	"regexp"
	"strings"
	"testing"
)

// A CDN or browser that keeps an old app.js must never be able to run it against a new page: the page names its
// files by version, so a changed file has a new URL.

func TestPagesLoadVersionedAssets(t *testing.T) {
	e := newTestServer(t)
	login := e.newClient().mustBody("GET", "/login")
	c := e.signedInAdmin()
	index := c.mustBody("GET", "/")
	ver := regexp.MustCompile(`/v/([0-9a-f]{12})/style\.css`).FindStringSubmatch(login)
	if ver == nil {
		t.Fatalf("login page doesn't load a versioned stylesheet:\n%s", login)
	}
	for _, want := range []string{`/v/` + ver[1] + `/login.js`} {
		if !strings.Contains(login, want) {
			t.Errorf("login page lacks %s", want)
		}
	}
	for _, want := range []string{`/v/` + ver[1] + `/style.css`, `/v/` + ver[1] + `/app.js`} {
		if !strings.Contains(index, want) {
			t.Errorf("app page lacks %s", want)
		}
	}
	if strings.Contains(index, `"/app.js"`) || strings.Contains(index, `"/style.css"`) {
		t.Error("app page still names an unversioned script or stylesheet")
	}

	anon := e.newClient()
	resp, _ := anon.req("GET", "/v/"+ver[1]+"/style.css", nil)
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Cache-Control"), "immutable") {
		t.Errorf("current stylesheet: %d cc=%q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
	if st := anon.do("GET", "/v/"+ver[1]+"/login.js", nil); st != 200 {
		t.Errorf("login.js signed out: %d", st)
	}
	if st := anon.do("GET", "/v/"+ver[1]+"/app.js", nil); st != 303 {
		t.Errorf("app.js signed out = %d, want the same redirect as the unversioned one", st)
	}
	resp, _ = c.req("GET", "/v/"+ver[1]+"/today.js", nil)
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "javascript") {
		t.Errorf("module signed in: %d %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	resp, _ = c.req("GET", "/v/000000000000/today.js", nil)
	if resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("a page left open across an upgrade still gets its files, never cached: %d cc=%q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
}

func TestServiceWorkerListsVersionedFiles(t *testing.T) {
	e := newTestServer(t)
	_, b := e.newClient().req("GET", "/sw.js", nil)
	sw := string(b)
	ver := regexp.MustCompile(`"/v/([0-9a-f]{12})/app\.js"`).FindStringSubmatch(sw)
	if ver == nil {
		t.Fatalf("sw.js doesn't list the versioned app.js:\n%s", sw[:min(600, len(sw))])
	}
	if !strings.Contains(sw, `"jiggered-app-`+ver[1]+`"`) {
		t.Error("each release should use its own cache")
	}
	if strings.Contains(sw, `"/app.js"`) || strings.Contains(sw, `"/style.css"`) {
		t.Error("sw.js still lists unversioned files")
	}
}

func TestEncodedDotDotCannotReachPrivateFilesThroughTheFontsRoute(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	for _, p := range []string{"/fonts/%2e%2e/admin.js", "/fonts/..%2fapp.js", "/fonts/%2e%2e%2fadmin.js", "/v/x/%2e%2e/admin.js"} {
		resp, body := anon.req("GET", p, nil)
		if resp.StatusCode == 200 || strings.Contains(string(body), "export") {
			t.Errorf("signed-out GET %s = %d: private front-end code was served", p, resp.StatusCode)
		}
	}
}

func TestManifestHasItsOwnMediaType(t *testing.T) {
	e := newTestServer(t)
	if ct := e.newClient().mustHeader("GET", "/manifest.webmanifest", "Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Errorf("manifest served as %q", ct)
	}
}
