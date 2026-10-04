package main

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
)

// This registry is shared by page routes, navigation, sitemap and llms.txt.
// Dates are deliberately omitted: a release date is not a content modification date.
type publicPage struct {
	Path, File, Title, Description, Label string
}

var publicPages = []publicPage{
	{"/welcome", "landing.html", "Jiggered — Free Energy & Symptom Tracker", "Track daily energy, activities and symptom episodes with Jiggered. Review patterns in your personal log. Free to use, with email verification for new accounts.", "Home"},
	{"/features/energy-tracking", "public/energy.html", "Daily Energy Tracking & Personal Budgets | Jiggered", "Log daily energy, activities and rest with a personal points budget. Learn how Jiggered's check-ins work and how they relate to Spoon Theory.", "Energy tracking"},
	{"/features/symptom-tracking", "public/symptoms.html", "Track Symptom Episodes, Duration & Triggers | Jiggered", "Record symptom episodes, their duration and relevant circumstances. Review your personal history and export your observations with Jiggered.", "Symptom tracking"},
	{"/guides/spoon-theory", "public/spoons.html", "Spoon Theory & Personal Energy Budgets | Jiggered", "Learn what Spoon Theory means, read Christine Miserandino's original essay, and see how to log your own energy budget and activities in Jiggered.", "Spoon Theory"},
	{"/pricing", "public/pricing.html", "Jiggered Pricing & Account Availability", "Jiggered is free to use. Check account availability, email verification requirements, and MIT-licensed self-hosting options.", "Pricing & access"},
	{"/docs/getting-started", "public/start.html", "Start Your Energy & Symptom Log | Jiggered Guide", "Make your first energy check-in, log an activity, record a symptom episode and review your history. A practical guide to getting started with Jiggered.", "Getting started"},
	{"/docs/export-and-share", "public/export.html", "Export Your Symptom Diary to CSV or PDF | Jiggered", "Export days and symptom episodes as CSV, or preview a printable summary and save it as PDF. Choose what personal information you share.", "Export & share"},
	{"/docs/offline-use", "public/offline.html", "Use Jiggered Offline: Setup, Saving & Sync", "Set up Jiggered online, then record on a trusted device offline. Understand queued changes, server acknowledgement, storage limits and recovery.", "Offline use"},
	{"/privacy", "public/privacy.html", "Jiggered Privacy: Your Logs, Hosting & Data Control", "Understand account isolation, server operator access, device copies, backups, exports and account deletion before using Jiggered for personal records.", "Privacy"},
}

func (c *config) loadPublicConfig() error {
	c.publicOrigin = strings.TrimSpace(os.Getenv("APP_PUBLIC_ORIGIN"))
	if c.publicOrigin != "" {
		u, err := url.Parse(c.publicOrigin)
		if err != nil || u.Host == "" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
			return fmt.Errorf("APP_PUBLIC_ORIGIN must be an HTTPS origin without a path, query or fragment (localhost HTTP is allowed for testing)")
		}
		c.publicOrigin = strings.TrimRight(u.String(), "/")
	}
	if v := os.Getenv("APP_PUBLIC_INDEXING"); v != "" {
		var err error
		c.publicIndex, err = strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("APP_PUBLIC_INDEXING must be true or false")
		}
	}
	if c.publicIndex && c.publicOrigin == "" {
		return fmt.Errorf("APP_PUBLIC_INDEXING=true requires APP_PUBLIC_ORIGIN")
	}
	return nil
}

type publicSite struct {
	s      *server
	files  *static
	shared *template.Template
	pages  map[string]*template.Template
}

type publicData struct {
	publicPage
	URL, Origin, Image, Robots          string
	Index, Registration                 bool
	CTA, CTALabel, Availability, Status string
	Pages                               []publicPage
	Content                             template.HTML // exclusively rendered from trusted embedded templates below
}

func newPublicSite(s *server, files *static) *publicSite {
	p := &publicSite{s: s, files: files, pages: map[string]*template.Template{}}
	p.shared = template.Must(template.ParseFS(files.fsys, "public/layout.html"))
	for _, page := range publicPages {
		if page.Path == "/welcome" {
			p.pages[page.Path] = template.Must(template.Must(p.shared.Clone()).ParseFS(files.fsys, page.File))
		} else {
			p.pages[page.Path] = template.Must(template.ParseFS(files.fsys, page.File))
		}
	}
	return p
}

func (p *publicSite) routes(mux *http.ServeMux) {
	for _, page := range publicPages {
		mux.HandleFunc("GET "+page.Path, func(w http.ResponseWriter, r *http.Request) { p.page(w, r, page) })
	}
	mux.HandleFunc("GET /sitemap.xml", p.sitemap)
	mux.HandleFunc("GET /llms.txt", p.llms)
}

func (p *publicSite) data(r *http.Request, page publicPage) publicData {
	d := publicData{publicPage: page, Origin: p.s.cfg.publicOrigin, Index: p.s.cfg.publicIndex, Pages: publicPages,
		Robots: "noindex, follow", CTA: "/login", CTALabel: "Log in", Status: "SIGNUP AVAILABILITY UNKNOWN",
		Availability: "Account availability could not be checked. Open the account page to try again."}
	if d.Origin != "" {
		d.URL = d.Origin + page.Path
		d.Image = d.Origin + "/icon-512.png"
	}
	if d.Index {
		d.Robots = "index, follow"
	}
	settings, err := p.s.loadServices(r.Context(), false)
	if err == nil {
		d.Registration = settings.Accounts.Registration && settings.Email.Enabled
		if d.Registration {
			d.Status, d.CTA, d.CTALabel = "OPEN FOR REGISTRATION", "/register", "Create your free account"
			d.Availability = "Email verification is required."
		} else {
			d.Status = "REGISTRATION CLOSED"
			d.Availability = "Registration is currently closed. Existing members can sign in."
		}
	}
	return d
}

func (p *publicSite) page(w http.ResponseWriter, r *http.Request, page publicPage) {
	d := p.data(r, page)
	var body, result bytes.Buffer
	var err error
	if page.Path == "/welcome" {
		err = p.pages[page.Path].ExecuteTemplate(&result, "landing.html", d)
	} else {
		err = p.pages[page.Path].Execute(&body, d)
		if err == nil {
			d.Content = template.HTML(body.String()) // embedded source, escaped by html/template; no user HTML
			err = p.shared.ExecuteTemplate(&result, "page", d)
		}
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.Header().Set("X-Robots-Tag", d.Robots)
	serveHTML(w, r, p.files, p.files.versionPage(result.Bytes()))
}

// sitemapOrigin prefers existing deployment/account configuration and otherwise
// derives the origin from this request. Forwarded headers require trusted proxy settings.
func (p *publicSite) sitemapOrigin(r *http.Request) string {
	if p.s.cfg.publicOrigin != "" {
		return p.s.cfg.publicOrigin
	}
	if cfg, err := p.s.loadServices(r.Context(), false); err == nil && cfg.Accounts.PublicURL != "" {
		if u, err := url.Parse(cfg.Accounts.PublicURL); err == nil && u.Host != "" && u.User == nil && (u.Scheme == "https" || u.Scheme == "http") {
			return u.Scheme + "://" + u.Host
		}
	}
	host, scheme := r.Host, "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p.s.trustedProxyRequest(r, p.s.settings()) {
		if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
			host = strings.TrimSpace(forwarded)
		}
		if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
			scheme = proto
		}
	}
	if strings.ContainsAny(host, "/\\\\?#@, \t\r\n") || (scheme != "http" && scheme != "https") {
		return ""
	}
	u, err := url.Parse(scheme + "://" + host)
	if err != nil || u.Hostname() == "" || u.User != nil {
		return ""
	}
	return u.String()
}

func (p *publicSite) robots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// Both search and answer crawlers inherit this policy. No private data is exposed by robots rules.
	fmt.Fprint(w, "# Search and AI crawlers may read public pages; private data requires authentication.\nUser-agent: *\nDisallow: /api/\n")
	if origin := p.sitemapOrigin(r); origin != "" {
		fmt.Fprintf(w, "\nSitemap: %s/sitemap.xml\n", origin)
	}
	// Account pages can be crawled to observe their noindex headers; never include them in the sitemap.
}

func (p *publicSite) sitemap(w http.ResponseWriter, r *http.Request) {
	origin := p.sitemapOrigin(r)
	if origin == "" {
		http.NotFound(w, r)
		return
	}
	type entry struct {
		Loc string `xml:"loc"`
	}
	doc := struct {
		XMLName xml.Name `xml:"urlset"`
		NS      string   `xml:"xmlns,attr"`
		URLs    []entry  `xml:"url"`
	}{NS: "http://www.sitemaps.org/schemas/sitemap/0.9"}
	for _, page := range publicPages {
		doc.URLs = append(doc.URLs, entry{origin + page.Path})
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, xml.Header)
	xml.NewEncoder(w).Encode(doc)
}

func (p *publicSite) llms(w http.ResponseWriter, r *http.Request) {
	if !p.s.cfg.publicIndex || p.s.cfg.publicOrigin == "" {
		http.NotFound(w, r)
		return
	}
	d := p.data(r, publicPages[0])
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintf(w, "# Jiggered\n\nJiggered is a personal energy and symptom tracker. Record daily check-ins, activity and rest points, symptom episodes, and review or export your observations. It is not a medical device.\n\nFree to use. %s\nDeveloped by EyUp.io (https://eyup.io). Application source is MIT licensed. Source and Docker setup: https://github.com/eyupio/jiggered.\n\n## Public pages\n", d.Availability)
	for _, page := range publicPages {
		fmt.Fprintf(w, "- [%s](%s%s): %s\n", page.Label, d.Origin, page.Path, page.Description)
	}
}

func (p *publicSite) redirectAlias(w http.ResponseWriter, r *http.Request) bool {
	alias := strings.TrimSuffix(strings.ToLower(r.URL.Path), "/")
	for _, page := range publicPages {
		if alias == page.Path && r.URL.Path != page.Path {
			target := page.Path
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return true
		}
	}
	return false
}

func knownPrivateFile(fsys fs.FS, requestPath string) bool {
	if path.Clean(requestPath) != requestPath || strings.HasSuffix(requestPath, "/") {
		return false
	}
	name := strings.TrimPrefix(requestPath, "/")
	// Public templates are implementation details, never raw static pages or private assets.
	if name == "landing.html" || strings.HasPrefix(name, "public/") {
		return false
	}
	info, err := fs.Stat(fsys, name)
	return err == nil && !info.IsDir()
}
