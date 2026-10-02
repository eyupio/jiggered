package main

import (
	"strings"
	"testing"
)

func TestPublicPresenceAndPrivateApp(t *testing.T) {
	e := newTestServer(t, func(c *config) { c.publicOrigin = "https://jiggered.example.com"; c.publicIndex = true })
	anon := e.newClient()
	for _, path := range []string{"/", "/welcome"} {
		resp, body := anon.req("GET", path, nil)
		if resp.StatusCode != 200 || !strings.Contains(string(body), "Track your energy") {
			t.Errorf("%s: want public landing, got %d", path, resp.StatusCode)
		}
		if resp.Header.Get("X-Robots-Tag") != "index, follow" || resp.Header.Get("X-Jiggered-App") != "" {
			t.Errorf("%s: landing indexing/cache headers = %v", path, resp.Header)
		}
		if !strings.Contains(string(body), `/presence.css"`) || strings.Contains(string(body), `src="/app.js"`) {
			t.Errorf("%s: incorrect public assets", path)
		}
	}
	resp, body := anon.req("GET", "/register", nil)
	if resp.StatusCode != 200 || !strings.Contains(string(body), `id="register-form"`) || !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") {
		t.Errorf("registration page = %d %v", resp.StatusCode, resp.Header)
	}
	admin := e.signedInAdmin()
	resp, body = admin.req("GET", "/", nil)
	if resp.Header.Get("X-Jiggered-App") != "1" || !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") || strings.Contains(string(body), "Track your energy") {
		t.Error("signed-in home must remain the private, offline-cacheable app")
	}
	if status := anon.do("GET", "/index.html", nil); status != 303 {
		t.Errorf("private app HTML exposed: %d", status)
	}
}
