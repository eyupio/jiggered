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
