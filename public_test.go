package main

import (
	"encoding/xml"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"
)

func TestPublicIndexingIsExplicitAndOriginIsValidated(t *testing.T) {
	for _, tc := range []struct {
		origin, indexing string
		valid            bool
	}{
		{"", "", true}, {"https://jiggered.example.com/", "true", true},
		{"http://localhost:8080", "false", true}, {"", "true", false},
		{"https://example.com/path", "true", false}, {"https://example.com?", "true", false},
		{"https://example.com?q=x", "true", false}, {"https://user:pass@example.com", "true", false},
		{"http://example.com", "false", false}, {"https://example.com", "maybe", false},
	} {
		t.Run(tc.origin+"/"+tc.indexing, func(t *testing.T) {
			t.Setenv("APP_PUBLIC_ORIGIN", tc.origin)
			t.Setenv("APP_PUBLIC_INDEXING", tc.indexing)
			var c config
			if err := c.loadPublicConfig(); (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
	e := newTestServer(t)
	anon := e.newClient()
	for _, route := range []string{"/", "/welcome", "/guides/spoon-theory", "/pricing"} {
		resp, body := anon.req("GET", route, nil)
		if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") || strings.Contains(string(body), `rel="canonical"`) {
			t.Fatalf("default deployment %s must be readable but not indexable", route)
		}
	}
	for _, route := range []string{"/sitemap.xml", "/llms.txt"} {
		if anon.do("GET", route, nil) != http.StatusNotFound {
			t.Fatalf("default deployment exposes %s", route)
		}
	}
	_, robots := anon.req("GET", "/robots.txt", nil)
	if strings.Contains(string(robots), "Sitemap:") || strings.Contains(string(robots), "Disallow: /\n") {
		t.Fatal("non-indexable pages must remain crawlable to observe noindex, without sitemap advertising")
	}
}

func TestPublicSitemapPagesAreCompleteAndPrivatePagesStayOut(t *testing.T) {
	e := newTestServer(t, func(c *config) { c.publicOrigin = "https://jiggered.example.com"; c.publicIndex = true })
	anon := e.newClient()
	resp, body := anon.req("GET", "/sitemap.xml", nil)
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/xml") {
		t.Fatal("sitemap is not public XML")
	}
	var sitemap struct {
		NS   string `xml:"xmlns,attr"`
		URLs []struct {
			Loc     string `xml:"loc"`
			Lastmod string `xml:"lastmod"`
		} `xml:"url"`
	}
	if err := xml.Unmarshal(body, &sitemap); err != nil {
		t.Fatal(err)
	}
	if sitemap.NS != "http://www.sitemaps.org/schemas/sitemap/0.9" || len(sitemap.URLs) != 9 {
		t.Fatalf("unexpected sitemap: %s", body)
	}
	titles := map[string]bool{}
	for _, entry := range sitemap.URLs {
		u, err := url.Parse(entry.Loc)
		if err != nil || u.Scheme != "https" || u.Host != "jiggered.example.com" || u.Path == "/" || u.RawQuery != "" || u.Fragment != "" || entry.Lastmod != "" {
			t.Fatalf("invalid canonical sitemap entry %+v", entry)
		}
		resp, html := anon.req("GET", u.Path, nil)
		s := string(html)
		if resp.StatusCode != 200 || resp.Header.Get("X-Robots-Tag") != "index, follow" {
			t.Fatalf("not indexable: %s", u.Path)
		}
		for _, want := range []string{`lang="en"`, `<meta name="description"`, `rel="canonical" href="` + entry.Loc + `"`, `property="og:url" content="` + entry.Loc + `"`, `name="twitter:image" content="https://jiggered.example.com/icon-512.png"`, `href="/guides/spoon-theory"`, `href="/docs/getting-started"`} {
			if !strings.Contains(s, want) {
				t.Errorf("%s lacks %s", u.Path, want)
			}
		}
		title := regexp.MustCompile(`<title>([^<]+)</title>`).FindStringSubmatch(s)
		if len(title) != 2 || titles[title[1]] {
			t.Fatalf("missing or repeated title for %s", u.Path)
		}
		titles[title[1]] = true
		if len(regexp.MustCompile(`<h1(?:\s|>)`).FindAllString(s, -1)) != 1 || strings.Contains(s, "{{") || strings.Contains(s, "ZgotmplZ") {
			t.Errorf("broken rendered HTML at %s", u.Path)
		}
		if strings.Contains(s, "/app.js") || strings.Contains(s, "/style.css") || strings.Contains(s, "<script type=\"application/ld+json\"") {
			t.Errorf("%s loads private CSS/JS or unsupported inline schema", u.Path)
		}
	}
	_, robots := anon.req("GET", "/robots.txt", nil)
	if !strings.Contains(string(robots), "Sitemap: https://jiggered.example.com/sitemap.xml") || strings.Contains(string(robots), "Disallow: /login") {
		t.Fatal("robots policy does not advertise sitemap or allow account noindex to be read")
	}
	_, llms := anon.req("GET", "/llms.txt", nil)
	if !strings.Contains(string(llms), "https://jiggered.example.com/guides/spoon-theory") || strings.Contains(string(llms), "/api/") {
		t.Fatal("llms index has wrong public links")
	}
	for _, route := range []string{"/login", "/register", "/healthz"} {
		resp, _ := anon.req("GET", route, nil)
		if !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") {
			t.Errorf("%s became indexable", route)
		}
	}
	if anon.do("GET", "/api/docs", nil) != http.StatusUnauthorized {
		t.Fatal("personal records became public")
	}
	resp, _ = e.signedInAdmin().req("GET", "/", nil)
	if resp.Header.Get("X-Jiggered-App") != "1" || !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") {
		t.Fatal("private home lost privacy/cache behavior")
	}
}

func TestSignupAndSpoonTheoryAreInInitialHTML(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	_, body := anon.req("GET", "/welcome", nil)
	if !strings.Contains(string(body), "REGISTRATION CLOSED") || !strings.Contains(string(body), "currently closed") || strings.Contains(string(body), "CHECKING SIGNUP AVAILABILITY") {
		t.Fatal("initial HTML does not resolve closed signup")
	}
	if !strings.Contains(string(body), "Christine Miserandino") || !strings.Contains(string(body), `href="https://www.butyoudontlooksick.com/articles/written-by-christine/the-spoon-theory/"`) {
		t.Fatal("Spoon Theory attribution and original link are not in initial HTML")
	}
	_, err := e.s.db.Exec(`UPDATE instance_settings SET value=json_set(value,'$.accounts.registration',json('true'),'$.email.enabled',json('true')) WHERE key='remote_services'`)
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"/welcome", "/pricing"} {
		_, body = anon.req("GET", route, nil)
		if !strings.Contains(string(body), "OPEN FOR REGISTRATION") || !strings.Contains(string(body), `href="/register"`) || !strings.Contains(string(body), "Email verification is required") {
			t.Fatalf("%s does not resolve open signup", route)
		}
	}
	_, err = e.s.db.Exec(`UPDATE instance_settings SET value='broken' WHERE key='remote_services'`)
	if err != nil {
		t.Fatal(err)
	}
	_, body = anon.req("GET", "/welcome", nil)
	if !strings.Contains(string(body), "SIGNUP AVAILABILITY UNKNOWN") || !strings.Contains(string(body), "could not be checked") || strings.Contains(string(body), `href="/register"`) {
		t.Fatal("unavailable settings imply signup is open")
	}
}

func TestPublicAliasesAndUnknownPaths(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	for _, route := range []string{"/Welcome/", "/FEATURES/Energy-Tracking/"} {
		resp, _ := anon.req("GET", route+"?utm_source=test", nil)
		want := strings.ToLower(strings.TrimSuffix(route, "/")) + "?utm_source=test"
		if resp.StatusCode != 308 || resp.Header.Get("Location") != want {
			t.Fatalf("alias %s: %d %s", route, resp.StatusCode, resp.Header.Get("Location"))
		}
	}
	for _, route := range []string{"/missing-page", "/missing.js", "/public/spoons.html", "/landing.html", "/v/missing/missing.js"} {
		if anon.do("GET", route, nil) != 404 {
			t.Fatalf("missing/raw template %s did not return 404", route)
		}
	}
	if anon.do("GET", "/app.js", nil) != 303 {
		t.Fatal("known private module must remain protected")
	}
}
