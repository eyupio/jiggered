package main

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"os"
	"strings"
	"testing"
)

func TestEveryEmailUsesBrandedAlternatives(t *testing.T) {
	for _, subject := range []string{"Verify your Jiggered account", "Reset your Jiggered password", "Verify your Jiggered recovery email", "Jiggered backup success", "Jiggered backup failed", "Jiggered test notification"} {
		action := ""
		if strings.HasPrefix(subject, "Verify") || strings.HasPrefix(subject, "Reset") {
			action = "https://jiggered.example/login#verify=abc123"
		}
		encoded, err := brandedEmail(emailSettings{From: "server@example.com", To: []string{"person@example.com"}}, subject, "First instruction.\n\n<script>never markup</script>", action, "Verify email")
		if err != nil {
			t.Fatal(err)
		}
		message, err := mail.ReadMessage(bytes.NewReader(encoded))
		if err != nil {
			t.Fatal(err)
		}
		from, _ := mail.ParseAddress(message.Header.Get("From"))
		if from.Name != "Jiggered" {
			t.Fatal(from)
		}
		kind, params, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
		if err != nil || kind != "multipart/alternative" {
			t.Fatal(kind, err)
		}
		reader := multipart.NewReader(message.Body, params["boundary"])
		for index := 0; index < 2; index++ {
			part, err := reader.NextPart()
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(part)
			if !bytes.Contains(body, []byte(subject)) {
				t.Fatal("missing subject")
			}
			if index == 0 {
				if !bytes.Contains(body, []byte("Jiggered")) {
					t.Fatal("plain branding missing")
				}
			} else {
				if !bytes.Contains(body, []byte("jiggered")) || bytes.Contains(body, []byte("<script>")) {
					t.Fatal("HTML branding/escaping")
				}
				if preview := os.Getenv("JIGGERED_EMAIL_PREVIEW"); preview != "" && subject == "Verify your Jiggered account" {
					if err := os.WriteFile(preview, body, 0600); err != nil {
						t.Fatal(err)
					}
				}
				if action != "" && !bytes.Contains(body, []byte(`href="`+action+`"`)) {
					t.Fatal("missing action link")
				}
			}
		}
	}
}

// The inbox list shows the first words of a message, and filters expect a Message-ID: the first visible text is the
// message itself, not the wordmark, and the headers are complete.
func TestEmailHasAPreheaderAndCompleteHeaders(t *testing.T) {
	encoded, err := brandedEmail(emailSettings{From: "server@example.com", To: []string{"person@example.com"}}, "Verify your Jiggered account", "Confirm your email to start using Jiggered. The link works once.\n\nDidn't ask for this? Ignore this email.", "https://jiggered.example/login#verify=abc", "Verify email")
	if err != nil {
		t.Fatal(err)
	}
	message, err := mail.ReadMessage(bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	if id := message.Header.Get("Message-ID"); !strings.HasPrefix(id, "<") || !strings.HasSuffix(id, "@example.com>") {
		t.Fatalf("Message-ID = %q", id)
	}
	if message.Header.Get("Auto-Submitted") != "auto-generated" {
		t.Fatal("missing Auto-Submitted")
	}
	_, params, _ := mime.ParseMediaType(message.Header.Get("Content-Type"))
	reader := multipart.NewReader(message.Body, params["boundary"])
	reader.NextPart() // plain text
	part, _ := reader.NextPart()
	html, _ := io.ReadAll(part)
	body := string(html)
	pre := strings.Index(body, "Confirm your email to start using Jiggered. The link works once.")
	wordmark := strings.Index(body, "jiggered<span")
	if pre < 0 || wordmark < 0 || pre > wordmark || !strings.Contains(body[:pre], "display:none") {
		t.Fatalf("the first text in the message should be a hidden preheader (pre=%d wordmark=%d)", pre, wordmark)
	}
}
