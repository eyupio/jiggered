package main

import "testing"

// The tag lets a returning device skip downloading an account that has not changed. It must change for every way the
// account can change, and never because of someone else's data.
func TestSnapshotTagAndNotModified(t *testing.T) {
	e := newTestServer(t)
	c := e.signedInAdmin()
	other, _ := e.addUser("bystander", roleUser)
	c.putDoc("d-2026-10-01", `{"status":"green"}`)

	tag := c.mustHeader("GET", "/api/docs", "ETag")
	if tag == "" || tag[:2] != "W/" {
		t.Fatalf("ETag = %q, want a weak tag", tag)
	}
	if again := c.mustHeader("GET", "/api/docs", "ETag"); again != tag {
		t.Errorf("an unchanged account gave a different tag: %q then %q", tag, again)
	}
	resp, body := c.req("GET", "/api/docs", nil, "If-None-Match", tag)
	if resp.StatusCode != 304 || len(body) != 0 {
		t.Errorf("current tag = %d with %d bytes, want 304 and no body", resp.StatusCode, len(body))
	}
	if resp.Header.Get("ETag") != tag {
		t.Error("a 304 should repeat the tag")
	}
	if resp, _ := c.req("GET", "/api/docs", nil, "If-None-Match", `W/"stale"`); resp.StatusCode != 200 {
		t.Errorf("a tag that is not current = %d, want 200", resp.StatusCode)
	}

	changed := func(what string, change func()) {
		t.Helper()
		change()
		next := c.mustHeader("GET", "/api/docs", "ETag")
		if next == tag {
			t.Errorf("%s did not change the tag", what)
		}
		resp, _ := c.req("GET", "/api/docs", nil, "If-None-Match", tag)
		if resp.StatusCode != 200 {
			t.Errorf("after %s the old tag still got %d, want 200", what, resp.StatusCode)
		}
		tag = next
	}
	changed("a save", func() { c.putDoc("d-2026-10-01", `{"status":"red"}`, "If-Match", `"1"`) })
	changed("a new document", func() { c.putDoc("d-2026-10-02", `{"status":"amber"}`) })
	changed("a delete", func() { c.do("DELETE", "/api/docs/d-2026-10-02", nil) })
	changed("a recreation after delete", func() { c.putDoc("d-2026-10-02", `{"status":"amber"}`) })
	changed("an import", func() { postImport(c, "overwrite", `{"d-2026-10-03":{"status":"green"}}`) })

	// Someone else's activity is none of this account's business, and must not look like a change.
	other.putDoc("d-2026-10-01", `{"status":"red"}`)
	other.do("DELETE", "/api/docs/d-2026-10-01", nil)
	if resp, _ := c.req("GET", "/api/docs", nil, "If-None-Match", tag); resp.StatusCode != 304 {
		t.Errorf("another person's changes made this account's tag stale (%d)", resp.StatusCode)
	}
}

func TestSnapshotRequiresSignIn(t *testing.T) {
	e := newTestServer(t)
	if resp, _ := e.newClient().req("GET", "/api/docs", nil, "If-None-Match", "*"); resp.StatusCode != 401 {
		t.Errorf("anonymous snapshot with a tag = %d, want 401", resp.StatusCode)
	}
}

func TestEmptyAccountSnapshotHasATagToo(t *testing.T) {
	c := newTestServer(t).signedInAdmin()
	tag := c.mustHeader("GET", "/api/docs", "ETag")
	if resp, _ := c.req("GET", "/api/docs", nil, "If-None-Match", tag); tag == "" || resp.StatusCode != 304 {
		t.Errorf("empty account: tag %q, conditional = %d", tag, resp.StatusCode)
	}
}
