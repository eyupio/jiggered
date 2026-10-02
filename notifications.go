package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// STARTTLS is mandatory in that mode; never silently fall back to cleartext.
func (s *server) sendNotification(ctx context.Context, cfg emailSettings, subject, body string) error {
	if cfg.Host == "" || cfg.From == "" || len(cfg.To) == 0 {
		return errors.New("Save an SMTP host, sender and recipients first.")
	}
	check := serviceSettings{Remote: remoteSettings{IntervalHours: 24}, Email: cfg}
	check.Email.Enabled = true
	if err := validateServices(check); err != nil {
		return err
	}
	address := net.JoinHostPort(cfg.Host, fmt.Sprint(cfg.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	var err error
	tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	if cfg.TLS == "tls" {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: tlsCfg}).DialContext(ctx, "tcp", address)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return errors.New("Could not connect to the SMTP server. Check host, port and TLS mode.")
	}
	defer conn.Close()
	deadline := time.Now().Add(25 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	client, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		return errors.New("SMTP greeting failed.")
	}
	defer client.Close()
	if cfg.TLS == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("This SMTP server does not offer STARTTLS. Choose the correct port and TLS mode.")
		}
		if err = client.StartTLS(tlsCfg); err != nil {
			return errors.New("SMTP TLS handshake failed. Check the server certificate and host name.")
		}
	}
	if cfg.Username != "" {
		if err = client.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return errors.New("SMTP authentication was refused. Check username and password or app password.")
		}
	}
	if err = client.Mail(cfg.From); err != nil {
		return errors.New("SMTP rejected the sender address.")
	}
	for _, to := range cfg.To {
		if err = client.Rcpt(to); err != nil {
			return errors.New("SMTP rejected a recipient address.")
		}
	}
	writer, err := client.Data()
	if err != nil {
		return errors.New("SMTP refused the message.")
	}
	// Normalise line endings and keep provider errors/credentials out of the message.
	subject = strings.NewReplacer("\r", " ", "\n", " ").Replace(subject)
	body = strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\n", "\r\n")
	_, err = fmt.Fprintf(writer, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", cfg.From, strings.Join(cfg.To, ", "), subject, time.Now().Format(time.RFC1123Z), body)
	if err != nil {
		return errors.New("SMTP message transfer failed.")
	}
	if err = writer.Close(); err != nil {
		return errors.New("SMTP did not accept the message.")
	}
	client.Quit()
	return nil
}
