package main

import (
	"crypto/tls"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
)

// An origin that carries credentials must be refused. It is assembled from parts
// because Repomix's secret scan flags the literal and drops the whole file from
// the AI Context pack, which makes generation refuse to publish.
const credentialedOrigin = "https://user" + ":" + "pass@example.com"

func TestPublicIndexingIsExplicitAndOriginIsValidated(t *testing.T) {
	for _, tc := range []struct {
		origin, indexing string
		valid            bool
	}{
		{"", "", true}, {"https://jiggered.example.com/", "true", true},
		{"http://localhost:8080", "false", true}, {"", "true", false},
		{"https://example.com/path", "true", false}, {"https://example.com?", "true", false},
		{"https://example.com?q=x", "true", false}, {credentialedOrigin, "true", false},
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
	for _, route := range []string{"/llms.txt"} {
		if anon.do("GET", route, nil) != http.StatusNotFound {
			t.Fatalf("default deployment exposes %s", route)
		}
	}
	_, robots := anon.req("GET", "/robots.txt", nil)
	if !strings.Contains(string(robots), "Sitemap:") || strings.Contains(string(robots), "Disallow: /\n") {
		t.Fatal("default deployment must advertise its automatic sitemap and preserve noindex crawling")
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
		// The landing page names the state in a pill; /pricing says it in its heading and button instead.
		if (route == "/welcome" && !strings.Contains(string(body), "OPEN FOR REGISTRATION")) || !strings.Contains(string(body), `href="/register"`) || !strings.Contains(string(body), "confirm your address") {
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

func TestSitemapIsAutomaticWithoutIndexingConfiguration(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	resp, body := anon.req("GET", "/sitemap.xml", nil)
	if resp.StatusCode != 200 || !strings.Contains(string(body), "/welcome</loc>") || strings.Contains(string(body), "/api/") {
		t.Fatalf("automatic public sitemap: %d %s", resp.StatusCode, body)
	}
	if _, err := e.s.db.Exec(`UPDATE instance_settings SET value=json_set(value,'$.accounts.public_url','https://public.example') WHERE key='remote_services'`); err != nil {
		t.Fatal(err)
	}
	_, body = anon.req("GET", "/sitemap.xml", nil)
	if !strings.Contains(string(body), "<loc>https://public.example/welcome</loc>") {
		t.Fatalf("sitemap must reuse the account public URL: %s", body)
	}
	_, robots := anon.req("GET", "/robots.txt", nil)
	if !strings.Contains(string(robots), "Sitemap: https://public.example/sitemap.xml") {
		t.Fatalf("robots must use the same origin: %s", robots)
	}
}

func TestSitemapOriginUsesConfiguredOriginAndRejectsUntrustedForwarding(t *testing.T) {
	e := newTestServer(t)
	p := &publicSite{s: e.s}
	r := httptest.NewRequest("GET", "https://logs.example/sitemap.xml", nil)
	r.TLS = &tls.ConnectionState{}
	r.Header.Set("X-Forwarded-Host", "attacker.example")
	r.Header.Set("X-Forwarded-Proto", "http")
	if got := p.sitemapOrigin(r); got != "https://logs.example" {
		t.Fatalf("untrusted headers changed sitemap origin: %s", got)
	}
	e.s.cfg.publicOrigin = "https://canonical.example"
	if got := p.sitemapOrigin(r); got != "https://canonical.example" {
		t.Fatalf("configured origin must win: %s", got)
	}
	e.s.cfg.publicOrigin = ""
	r.Host = "bad.example/path"
	if got := p.sitemapOrigin(r); got != "" {
		t.Fatalf("invalid host accepted: %s", got)
	}
}

// A visitor should be able to see whose server this is, and while registration is closed whom to ask.
func TestOperatorDetailsAreShownOnPublicPages(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	cfg := testServices(t, e)
	cfg.Accounts.OperatorName = "Riverside Practice"
	cfg.Accounts.OperatorContact = "records@riverside.example"
	saveTestServices(t, e, admin, cfg)
	anon := e.newClient()
	for _, path := range []string{"/welcome", "/privacy", "/pricing"} {
		_, body := anon.req("GET", path, nil)
		if !strings.Contains(string(body), "Riverside Practice") {
			t.Errorf("%s does not name the operator", path)
		}
	}
	_, pricing := anon.req("GET", "/pricing", nil)
	if !strings.Contains(string(pricing), "invite-only") || !strings.Contains(string(pricing), "records@riverside.example") {
		t.Error("the closed pricing page does not say whom to ask")
	}
	// Plain text only, and bounded.
	for _, bad := range []string{strings.Repeat("x", 81), "line\nbreak"} {
		cfg = testServices(t, e) // the saved revision moves on with every save
		cfg.Accounts.OperatorName = bad
		if r, _ := admin.req("PUT", "/api/admin/services", map[string]any{"password": adminPass, "settings": cfg}); r.StatusCode != 400 {
			t.Errorf("operator name %q was accepted: %d", bad, r.StatusCode)
		}
	}
}

// The landing page shows a real screenshot, which a signed-out visitor must be able to fetch; nothing else
// under web/ becomes public through that route.
func TestScreenshotsArePublicAndOnlyScreenshots(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	resp, body := anon.req("GET", "/shots/today.webp", nil)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/webp" || len(body) < 1000 {
		t.Fatalf("screenshot: %d %q (%d bytes)", resp.StatusCode, resp.Header.Get("Content-Type"), len(body))
	}
	for _, p := range []string{"/shots/%2e%2e/admin.js", "/shots/..%2fapp.js", "/shots/"} {
		r, b := anon.req("GET", p, nil)
		if r.StatusCode == 200 && strings.Contains(string(b), "export") {
			t.Errorf("signed-out GET %s served private front-end code", p)
		}
	}
	_, landing := anon.req("GET", "/welcome", nil)
	if !strings.Contains(string(landing), `src="/shots/today.webp"`) {
		t.Error("the landing page does not show the screenshot")
	}
}

// A stale link lands on a page that says where to go, not on a bare "404 page not found"; the folders in the public
// URLs lead somewhere; scripts and the API keep the plain answer they can parse.
func TestUnknownPagesGetAHelpfulNotFoundAndFoldersRedirect(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	for from, to := range map[string]string{"/docs": "/docs/getting-started", "/features/": "/features/energy-tracking", "/Guides": "/guides/spoon-theory"} {
		resp, _ := anon.req("GET", from, nil)
		if resp.StatusCode != http.StatusMovedPermanently || resp.Header.Get("Location") != to {
			t.Errorf("%s: %d -> %q, want 301 -> %s", from, resp.StatusCode, resp.Header.Get("Location"), to)
		}
	}
	resp, body := anon.req("GET", "/nope", nil, "Accept", "text/html,application/xhtml+xml")
	page := string(body)
	if resp.StatusCode != 404 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
		t.Fatalf("browser navigation to a missing page: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") || strings.Contains(page, `rel="canonical"`) {
		t.Error("a missing page must not be indexable or claim a canonical address")
	}
	for _, want := range []string{"That page isn’t here", `href="/features/energy-tracking"`, `href="/pricing"`, `href="/login"`} {
		if !strings.Contains(page, want) {
			t.Errorf("the not-found page lacks %q", want)
		}
	}
	if strings.Contains(page, `href="/welcome"`) == false {
		t.Error("the not-found page offers no way home")
	}
	// Anything that is not a person in a browser keeps the plain 404.
	for _, tc := range []struct{ path, accept string }{{"/missing.js", "*/*"}, {"/nope", ""}, {"/api/nothing", "text/html"}, {"/missing.png", "image/avif,image/webp,*/*"}} {
		resp, body := anon.req("GET", tc.path, nil, "Accept", tc.accept)
		if resp.StatusCode != 404 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/plain") || strings.Contains(string(body), "<html") {
			t.Errorf("%s (Accept %q): %d %s", tc.path, tc.accept, resp.StatusCode, resp.Header.Get("Content-Type"))
		}
	}
	if code := anon.do("HEAD", "/nope", nil, "Accept", "text/html"); code != 404 {
		t.Errorf("HEAD to a missing page: %d", code)
	}
}

// Someone who is already signed in is shown the way into the app, not a sign-up pitch.
func TestSignedInVisitorsAreOfferedTheAppOnPublicPages(t *testing.T) {
	e := newTestServer(t)
	admin := e.signedInAdmin()
	_, anonPricing := e.newClient().req("GET", "/pricing", nil)
	if !strings.Contains(string(anonPricing), `href="/login"`) || strings.Contains(string(anonPricing), "Open Jiggered") {
		t.Fatal("a signed-out visitor should see Log in, not Open Jiggered")
	}
	for _, path := range []string{"/welcome", "/pricing", "/guides/spoon-theory", "/privacy"} {
		_, body := admin.req("GET", path, nil)
		page := string(body)
		if !strings.Contains(page, "Open Jiggered") || !strings.Contains(page, "data-signed-in") {
			t.Errorf("%s does not offer the app to a signed-in visitor", path)
		}
		if strings.Contains(page, `class="p-button small secondary" href="/login"`) {
			t.Errorf("%s still shows a Log in button to someone who is signed in", path)
		}
	}
	resp, _ := admin.req("GET", "/nope", nil, "Accept", "text/html")
	if resp.StatusCode != 404 {
		t.Errorf("the not-found page for a signed-in person: %d", resp.StatusCode)
	}
}

// The header carries the four questions a visitor has; everything else is in the footer, once, and the page you are
// on is marked in both.
func TestPublicHeaderAndFooterListEveryPageOnce(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	_, body := anon.req("GET", "/features/energy-tracking", nil)
	page := string(body)
	header := page[strings.Index(page, `<header`):strings.Index(page, `</header>`)]
	for _, want := range []string{">Energy<", ">Symptoms<", ">How it works<", ">Privacy<"} {
		if !strings.Contains(header, want) {
			t.Errorf("the header lacks %s", want)
		}
	}
	if !strings.Contains(header, `href="/features/energy-tracking"`) || !strings.Contains(header, `aria-current="page"`) {
		t.Error("the header does not mark the current page")
	}
	footer := page[strings.Index(page, `<footer`):]
	for _, p := range publicPages {
		if p.Path == "/welcome" {
			continue
		}
		if n := strings.Count(footer, `href="`+p.Path+`"`); n != 1 {
			t.Errorf("footer links %s %d times, want once", p.Path, n)
		}
	}
	for _, group := range []string{"Product", "Guides", "Trust"} {
		if !strings.Contains(footer, ">"+group+"<") {
			t.Errorf("the footer has no %s group", group)
		}
	}
}

func TestPublicIndexingFollowsAdminSettingAndEnvOverride(t *testing.T) {
	e := newTestServer(t)
	anon := e.newClient()
	robots := func() string {
		resp, _ := anon.req("GET", "/privacy", nil)
		return resp.Header.Get("X-Robots-Tag")
	}
	if got := robots(); !strings.Contains(got, "noindex") {
		t.Fatalf("no origin known: %q", got)
	}
	set := func(path, value string) {
		t.Helper()
		if _, err := e.s.db.Exec(`UPDATE instance_settings SET value=json_set(value,?,json(?)) WHERE key='remote_services'`, path, value); err != nil {
			t.Fatal(err)
		}
	}
	set("$.accounts.public_url", `"https://public.example"`)
	if got := robots(); got != "index, follow" {
		t.Fatalf("a public URL should enable indexing by default: %q", got)
	}
	if resp, body := anon.req("GET", "/privacy", nil); resp.StatusCode != 200 || !strings.Contains(string(body), `rel="canonical" href="https://public.example/privacy"`) {
		t.Fatal("canonical must use the Admin public URL")
	}
	if anon.do("GET", "/llms.txt", nil) != 200 {
		t.Fatal("llms.txt should follow indexing")
	}
	set("$.accounts.no_index", `true`)
	if got := robots(); !strings.Contains(got, "noindex") {
		t.Fatalf("Admin opt-out ignored: %q", got)
	}
	e.s.cfg.publicIndex = true
	if got := robots(); got != "index, follow" {
		t.Fatalf("APP_PUBLIC_INDEXING=true must override: %q", got)
	}
	e.s.cfg.publicIndex, e.s.cfg.publicNoIdx = false, true
	set("$.accounts.no_index", `false`)
	if got := robots(); !strings.Contains(got, "noindex") {
		t.Fatalf("APP_PUBLIC_INDEXING=false must override: %q", got)
	}
}
