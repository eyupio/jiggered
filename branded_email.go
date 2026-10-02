package main

import (
	"bytes"
	"fmt"
	"html/template"
	"mime"
	"mime/multipart"
	"net/mail"
	"net/textproto"
	"strings"
	"time"
)

// One self-contained visual identity for account messages, tests and backup alerts.
// No remote images, fonts or tracking pixels; the text alternative retains every instruction.
var emailTemplate = template.Must(template.New("email").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{.Subject}}</title></head>
<body style="margin:0;padding:0;background:#f8f9f4;color:#203c31;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8f9f4"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 12px 24px;font-family:Georgia,serif;font-size:34px;font-weight:bold;letter-spacing:-1px;color:#285c46">jiggered<span style="color:#64825a">.</span></td></tr>
<tr><td style="background:#fffefb;border:1px solid #d9e1d4;border-radius:16px;padding:32px">
<p style="margin:0 0 16px;color:#52655a;font-size:11px;font-weight:bold;letter-spacing:2px">YOUR OWN RHYTHM</p>
<h1 style="margin:0 0 24px;font-family:Georgia,serif;font-size:28px;line-height:1.25;color:#203c31">{{.Subject}}</h1>
{{range .Paragraphs}}<p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#52655a;white-space:pre-line">{{.}}</p>{{end}}
{{if .URL}}<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:8px;background:#285c46"><a href="{{.URL}}" style="display:inline-block;padding:15px 24px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold">{{.Label}}</a></td></tr></table>
<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#52655a">If the button doesn’t work, copy this link into your browser:</p>
<p style="font-size:12px;line-height:1.6;word-break:break-all"><a href="{{.URL}}" style="color:#285c46">{{.URL}}</a></p>{{end}}
</td></tr>
<tr><td style="padding:24px 12px;font-size:12px;line-height:1.7;color:#52655a">A little understanding goes a long way.<br>Jiggered · Your energy. Your pace. Your rhythm.<br>A personal log, not a medical device.</td></tr>
</table></td></tr></table></body></html>`))

func brandedEmail(cfg emailSettings, subject, body, actionURL, label string) ([]byte, error) {
	subject = strings.NewReplacer("\r", " ", "\n", " ").Replace(subject)
	var rich bytes.Buffer
	data := struct {
		Subject    string
		Paragraphs []string
		URL, Label string
	}{subject, strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n\n"), actionURL, label}
	if err := emailTemplate.Execute(&rich, data); err != nil {
		return nil, err
	}
	var parts bytes.Buffer
	writer := multipart.NewWriter(&parts)
	text := "Jiggered — Your energy. Your pace. Your rhythm.\n\n" + subject + "\n\n" + body
	if actionURL != "" {
		text += "\n\n" + label + ":\n" + actionURL
	}
	text += "\n\nA little understanding goes a long way.\nA personal log, not a medical device."
	for _, part := range []struct{ kind, body string }{{"text/plain", text}, {"text/html", rich.String()}} {
		header := textproto.MIMEHeader{"Content-Type": {part.kind + "; charset=UTF-8"}, "Content-Transfer-Encoding": {"8bit"}}
		out, err := writer.CreatePart(header)
		if err != nil {
			return nil, err
		}
		if _, err = out.Write([]byte(strings.ReplaceAll(strings.ReplaceAll(part.body, "\r\n", "\n"), "\n", "\r\n"))); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	from := (&mail.Address{Name: "Jiggered", Address: cfg.From}).String()
	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=%q\r\n\r\n", from, strings.Join(cfg.To, ", "), mime.QEncoding.Encode("UTF-8", subject), time.Now().Format(time.RFC1123Z), writer.Boundary())
	return append([]byte(headers), parts.Bytes()...), nil
}
