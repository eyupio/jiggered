package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

// Secrets use a separate volume key: a database snapshot never contains the key that opens them.
type remoteSettings struct {
	Encrypt            bool   `json:"encrypt"`
	EncryptionPassword string `json:"encryption_password"`
	Enabled            bool   `json:"enabled"`
	Endpoint           string `json:"endpoint"`
	Region             string `json:"region"`
	Bucket             string `json:"bucket"`
	Prefix             string `json:"prefix"`
	PathStyle          bool   `json:"path_style"`
	AllowHTTP          bool   `json:"allow_http"`
	AccessKey          string `json:"access_key"`
	SecretKey          string `json:"secret_key"`
	IntervalHours      int    `json:"interval_hours"`
	Keep               int    `json:"keep"`
	Verify             bool   `json:"verify"`
}
type emailSettings struct {
	Enabled   bool     `json:"enabled"`
	Host      string   `json:"host"`
	Port      int      `json:"port"`
	TLS       string   `json:"tls"`
	Username  string   `json:"username"`
	Password  string   `json:"password"`
	From      string   `json:"from"`
	To        []string `json:"to"`
	OnSuccess bool     `json:"on_success"`
	OnFailure bool     `json:"on_failure"`
}
type accountSettings struct {
	Registration bool   `json:"registration"`
	Recovery     bool   `json:"recovery"`
	PublicURL    string `json:"public_url"`
	// Who runs this server, shown on the public pages so a visitor knows whose server holds their log. Both are optional. No-index opts the public pages out of search.
	OperatorName    string `json:"operator_name"`
	OperatorContact string `json:"operator_contact"`
	// Public pages are indexable by default once a public origin is known; this opts out. Zero value keeps older rows indexable.
	NoIndex bool `json:"no_index"`
}
type rehearsalSettings struct {
	Date    string `json:"date"`
	Outcome string `json:"outcome"`
}
type serviceSettings struct {
	Rehearsal     rehearsalSettings `json:"rehearsal"`
	Accounts      accountSettings   `json:"accounts"`
	Remote        remoteSettings    `json:"remote"`
	Email         emailSettings     `json:"email"`
	Revision      int               `json:"revision"`
	Instance      string            `json:"instance"`
	ScheduledFrom int64             `json:"scheduled_from"`
}
type backupRun struct {
	Uploaded             bool   `json:"uploaded"`
	Verified             bool   `json:"verified"`
	VerificationRequired bool   `json:"verification_required"`
	Retained             bool   `json:"retained"`
	ID                   int64  `json:"id"`
	Started              int64  `json:"started"`
	Finished             int64  `json:"finished"`
	Status               string `json:"status"`
	Key                  string `json:"key"`
	Bytes                int64  `json:"bytes"`
	Message              string `json:"message"`
	Email                string `json:"email"`
}

func (s *server) initServices() error {
	// openDB must have applied all migrations before constructing a server.
	var err error
	var b [12]byte
	if _, err = rand.Read(b[:]); err != nil {
		return err
	}
	instance := hex.EncodeToString(b[:])
	cfg := serviceSettings{Remote: remoteSettings{Region: "us-east-1", Prefix: "jiggered/" + instance, PathStyle: true, IntervalHours: 24, Keep: 30, Verify: true}, Email: emailSettings{Port: 587, TLS: "starttls", To: []string{}, OnFailure: true}, Instance: instance}
	raw, _ := json.Marshal(cfg)
	_, err = s.db.Exec(`INSERT OR IGNORE INTO instance_settings(key,value,updated_at) VALUES('remote_services',?,?)`, string(raw), time.Now().Unix())
	return err
}
func (s *server) serviceKey(create bool) ([]byte, error) {
	p := filepath.Join(filepath.Dir(s.cfg.dbPath), ".jiggered-service-key")
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) && create {
		b = make([]byte, 32)
		if _, err = rand.Read(b); err != nil {
			return nil, err
		}
		f, e := os.CreateTemp(filepath.Dir(p), ".service-key-*")
		if e != nil {
			return nil, e
		}
		tmp := f.Name()
		defer os.Remove(tmp)
		if _, e = f.Write(b); e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			return nil, e
		}
		if e = os.Link(tmp, p); errors.Is(e, os.ErrExist) {
			return s.serviceKey(false)
		} else if e != nil {
			return nil, e
		}
		err = nil

	}
	if err != nil {
		return nil, errors.New("The credential key is unavailable. Restore .jiggered-service-key alongside the database, or clear the saved credentials and enter them again.")
	}
	if len(b) != 32 {
		return nil, errors.New("The credential key must contain 32 bytes.")
	}
	return b, nil
}
func (s *server) cryptSecret(value string, encrypt bool) (string, error) {
	if value == "" {
		return "", nil
	}
	key, err := s.serviceKey(encrypt)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if encrypt {
		nonce := make([]byte, gcm.NonceSize())
		if _, err = rand.Read(nonce); err != nil {
			return "", err
		}
		return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(value), []byte("jiggered-services-v1"))), nil
	}
	b, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(b) < gcm.NonceSize() {
		return "", errors.New("Saved credentials could not be opened.")
	}
	plain, err := gcm.Open(nil, b[:gcm.NonceSize()], b[gcm.NonceSize():], []byte("jiggered-services-v1"))
	if err != nil {
		return "", errors.New("Saved credentials could not be opened with this key. Re-enter them or restore the original credential key.")
	}
	return string(plain), nil
}
func (s *server) loadServices(ctx context.Context, decrypt bool) (serviceSettings, error) {
	var cfg serviceSettings
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM instance_settings WHERE key='remote_services'`).Scan(&raw)
	if err != nil {
		return cfg, err
	}
	if err = json.Unmarshal([]byte(raw), &cfg); err != nil {
		return cfg, err
	}
	if decrypt {
		for _, p := range []*string{&cfg.Remote.AccessKey, &cfg.Remote.SecretKey, &cfg.Email.Password, &cfg.Remote.EncryptionPassword} {
			*p, err = s.cryptSecret(*p, false)
			if err != nil {
				return cfg, err
			}
		}
	}
	return cfg, nil
}
func safeServices(cfg serviceSettings) map[string]any {
	ak, sk, pw := cfg.Remote.AccessKey != "", cfg.Remote.SecretKey != "", cfg.Email.Password != ""
	encryptedPassword := cfg.Remote.EncryptionPassword != ""
	cfg.Remote.EncryptionPassword = ""
	cfg.Remote.AccessKey = ""
	cfg.Remote.SecretKey = ""
	cfg.Email.Password = ""
	return map[string]any{"settings": cfg, "access_key_saved": ak, "secret_key_saved": sk, "smtp_password_saved": pw, "backup_password_saved": encryptedPassword}
}

var bucketPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.-]{1,62}$`)

func validateServices(cfg serviceSettings) error {
	if cfg.Rehearsal.Date != "" {
		date, err := time.Parse("2006-01-02", cfg.Rehearsal.Date)
		if err != nil || date.After(time.Now().UTC()) {
			return errors.New("Enter a completed rehearsal date, today or earlier.")
		}
	}
	if cfg.Rehearsal.Outcome != "" && cfg.Rehearsal.Outcome != "passed" && cfg.Rehearsal.Outcome != "needs_attention" {
		return errors.New("Choose a rehearsal outcome.")
	}
	if (cfg.Rehearsal.Date == "") != (cfg.Rehearsal.Outcome == "") {
		return errors.New("Supply both a rehearsal date and outcome, or clear both.")
	}

	if cfg.Remote.Encrypt && cfg.Remote.EncryptionPassword == "" {
		return errors.New("Set a backup encryption password before enabling encryption.")
	}
	if err := validateBackupPassword(cfg.Remote.EncryptionPassword); err != nil {
		return err
	}
	r := cfg.Remote
	e := cfg.Email
	if cfg.Accounts.PublicURL != "" {
		u, err := url.Parse(cfg.Accounts.PublicURL)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
			return errors.New("Public URL must be an HTTPS origin, such as https://jiggered.example.com. Localhost HTTP is allowed for testing.")
		}
	}
	for _, f := range []struct {
		label, value string
		max          int
	}{{"Operator name", cfg.Accounts.OperatorName, 80}, {"Operator contact", cfg.Accounts.OperatorContact, 160}} {
		if len([]rune(f.value)) > f.max || strings.ContainsFunc(f.value, unicode.IsControl) {
			return fmt.Errorf("%s must be plain text of up to %d characters.", f.label, f.max)
		}
	}
	if (cfg.Accounts.Registration || cfg.Accounts.Recovery) && (!e.Enabled || cfg.Accounts.PublicURL == "") {
		return errors.New("Registration and password recovery need enabled SMTP and a trusted public URL.")
	}
	if r.IntervalHours < 1 || r.IntervalHours > 8760 {
		return errors.New("Backup interval must be between 1 and 8760 hours.")
	}
	if r.Keep < 0 || r.Keep > 1000 {
		return errors.New("Keep between 1 and 1000 backups, or 0 to disable automatic deletion.")
	}
	if len(r.Prefix) > 256 || strings.ContainsAny(r.Prefix, "\\\r\n") || strings.Contains(r.Prefix, "..") || strings.HasPrefix(r.Prefix, "/") {
		return errors.New("Use a relative S3 prefix without .. or backslashes.")
	}
	if r.Endpoint != "" {
		u, err := url.Parse(r.Endpoint)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && u.Scheme != "http") {
			return errors.New("Enter an S3 endpoint such as https://s3.eu-west-2.amazonaws.com, without a path, query or credentials.")
		}
		if u.Scheme == "http" && !r.AllowHTTP {
			return errors.New("S3 uses plain HTTP. Enable the explicit private-network HTTP option or use HTTPS.")
		}
	}
	if r.Enabled && (r.Endpoint == "" || !bucketPattern.MatchString(r.Bucket) || r.AccessKey == "" || r.SecretKey == "") {
		return errors.New("Enabled backups need an endpoint, valid bucket name, access key and secret key.")
	}
	if e.Port < 1 || e.Port > 65535 {
		return errors.New("SMTP port must be between 1 and 65535.")
	}
	if e.TLS != "starttls" && e.TLS != "tls" && e.TLS != "none" {
		return errors.New("Choose STARTTLS, implicit TLS or a local unencrypted relay.")
	}
	if e.Host != "" && (strings.ContainsAny(e.Host, "/\r\n\t ") || strings.Contains(e.Host, ":") && net.ParseIP(e.Host) == nil) {
		return errors.New("SMTP host must be a hostname or IP address, without a port.")
	}
	if e.TLS == "none" && (e.Username != "" || e.Password != "") {
		return errors.New("SMTP authentication requires TLS. Use an unauthenticated local relay or enable TLS.")
	}
	if len(e.To) > 20 {
		return errors.New("Use at most 20 notification recipients.")
	}
	for _, addr := range append(append([]string{}, e.To...), e.From) {
		if addr == "" && !e.Enabled {
			continue
		}
		a, err := mail.ParseAddress(addr)
		if err != nil || strings.ContainsAny(addr, "\r\n") || a.Address != addr {
			return errors.New("Use plain email addresses, without display names.")
		}
	}
	if e.Enabled && (e.Host == "" || e.From == "" || len(e.To) == 0) {
		return errors.New("Enabled email needs a host, sender and at least one recipient.")
	}
	for _, v := range []string{r.Region, r.AccessKey, r.SecretKey, e.Username, e.Password} {
		if len(v) > 2048 || strings.ContainsAny(v, "\r\n") {
			return errors.New("Credentials and region must be single-line values of at most 2048 characters.")
		}
	}
	return nil
}
func (s *server) adminGetServices(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.loadServices(r.Context(), false)
	if err != nil {
		serverError(w, r, err)
		return
	}
	result := safeServices(cfg)
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,started,finished,status,object_key,bytes,message,email,uploaded,verified,verification_required,retained FROM remote_backup_runs ORDER BY id DESC LIMIT 25`)
	if err != nil {
		serverError(w, r, err)
		return
	}
	defer rows.Close()
	runs := []backupRun{}
	for rows.Next() {
		var v backupRun
		if err = rows.Scan(&v.ID, &v.Started, &v.Finished, &v.Status, &v.Key, &v.Bytes, &v.Message, &v.Email, &v.Uploaded, &v.Verified, &v.VerificationRequired, &v.Retained); err != nil {
			serverError(w, r, err)
			return
		}
		runs = append(runs, v)
	}
	if err = rows.Err(); err != nil {
		serverError(w, r, err)
		return
	}
	rows.Close()
	result["runs"] = runs
	var usable, verified int64
	if err = s.db.QueryRowContext(r.Context(), `SELECT COALESCE(MAX(CASE WHEN uploaded=1 AND (verification_required=0 OR verified=1) THEN finished END),0),COALESCE(MAX(CASE WHEN verified=1 THEN finished END),0) FROM remote_backup_runs`).Scan(&usable, &verified); err != nil {
		serverError(w, r, err)
		return
	}
	result["last_usable"] = usable
	result["last_verified"] = verified
	mail, err := s.mailStatus(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	result["mail"] = mail
	var last int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(MAX(started),0) FROM remote_backup_runs`).Scan(&last); err != nil {
		serverError(w, r, err)
		return
	}
	if cfg.Remote.Enabled {
		if last < cfg.ScheduledFrom {
			last = cfg.ScheduledFrom
		}
		result["next_at"] = last + int64(cfg.Remote.IntervalHours)*3600
	}
	writeJSON(w, 200, result)
}
func (s *server) adminSaveServices(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Password    string          `json:"password"`
		Settings    serviceSettings `json:"settings"`
		ClearS3     bool            `json:"clear_s3"`
		ClearEmail  bool            `json:"clear_email"`
		ClearBackup bool            `json:"clear_backup"`
	}
	if !readJSON(w, r, &in) || !s.verifyOwnPassword(w, r, authOf(r).u, in.Password) {
		return
	}
	s.serviceMu.Lock()
	defer s.serviceMu.Unlock()
	old, err := s.loadServices(r.Context(), false)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if old.Revision != in.Settings.Revision {
		jsonError(w, 409, "Settings changed in another session. Reload before saving.")
		return
	}
	cfg := in.Settings
	cfg.Instance = old.Instance
	cfg.ScheduledFrom = old.ScheduledFrom
	// Preserve ciphertext unless a secret is supplied or explicitly cleared. Validation uses placeholders for preserved secrets.
	secrets := []struct {
		value    *string
		old      string
		clear    bool
		preserve bool
	}{{&cfg.Remote.AccessKey, old.Remote.AccessKey, in.ClearS3, false}, {&cfg.Remote.SecretKey, old.Remote.SecretKey, in.ClearS3, false}, {&cfg.Email.Password, old.Email.Password, in.ClearEmail, false}, {&cfg.Remote.EncryptionPassword, old.Remote.EncryptionPassword, in.ClearBackup, false}}
	for i := range secrets {
		p := &secrets[i]
		if p.clear {
			*p.value = ""
		} else if *p.value == "" && p.old != "" {
			p.preserve = true
			*p.value = "[saved credential]"
		}
	}
	if err = validateServices(cfg); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	for _, p := range secrets {
		if p.preserve {
			*p.value = p.old
		} else {
			*p.value, err = s.cryptSecret(*p.value, true)
			if err != nil {
				jsonError(w, 400, err.Error())
				return
			}
		}
	}
	if cfg.Remote.Enabled && (!old.Remote.Enabled || cfg.Remote.IntervalHours != old.Remote.IntervalHours) {
		cfg.ScheduledFrom = time.Now().Unix()
	}
	cfg.Revision++
	raw, _ := json.Marshal(cfg)
	res, err := s.db.ExecContext(r.Context(), `UPDATE instance_settings SET value=?,updated_at=? WHERE key='remote_services' AND json_extract(value,'$.revision')=? AND EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=? AND role='admin' AND disabled=0 AND must_change_password=0 AND EXISTS (SELECT 1 FROM sessions WHERE user_id=users.id AND token_hash=? AND sid=? AND expires_at>?))`, string(raw), time.Now().Unix(), old.Revision, authOf(r).u.ID, string(authOf(r).verified), authOf(r).hash, authOf(r).sid, time.Now().Unix())
	if err != nil {
		serverError(w, r, err)
		return
	}
	if n, _ := res.RowsAffected(); n != 1 {
		jsonError(w, 409, "Configuration or your account changed. Reload and try again.")
		return
	}
	s.audit(r.Context(), authOf(r).u.Username, "remote_settings_changed", "", "backup and email configuration", s.clientIP(r))
	writeJSON(w, 200, safeServices(cfg))
}
func remoteClient(r remoteSettings) (*s3Client, error) {
	if r.Endpoint == "" || !bucketPattern.MatchString(r.Bucket) {
		return nil, errors.New("Save a valid S3 endpoint and bucket first.")
	}
	return newS3Client(r.Endpoint, r.Region, r.Bucket, r.AccessKey, r.SecretKey, &r.PathStyle, nil)
}
func backupPrefix(cfg serviceSettings) string {
	return strings.Trim(cfg.Remote.Prefix, "/") + "/backup-" + cfg.Instance + "-"
}
func ownedBackup(cfg serviceSettings, key string) bool {
	prefix := backupPrefix(cfg)
	if !strings.HasPrefix(key, prefix) {
		return false
	}
	tail := strings.TrimPrefix(key, prefix)
	return regexp.MustCompile(`^\d{8}T\d{6}Z-[0-9a-f]{16}\.(db|zip|zip\.enc)$`).MatchString(tail)
}

// Requests start a bounded background job, so closing a tab cannot interrupt an upload.
func (s *server) adminServiceAction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Password string `json:"password"`
		Action   string `json:"action"`
		Key      string `json:"key"`
	}
	if !readJSON(w, r, &in) || !s.verifyOwnPassword(w, r, authOf(r).u, in.Password) {
		return
	}
	cfg, err := s.loadServices(r.Context(), true)
	if err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	actor := authOf(r).u.Username
	switch in.Action {
	case "backup":
		if !cfg.Remote.Enabled {
			jsonError(w, 400, "Enable and save remote backups first.")
			return
		}
		id, err := s.startRemoteBackup(cfg, actor)
		if err != nil {
			jsonError(w, 409, err.Error())
			return
		}
		s.audit(r.Context(), actor, "remote_backup_started", "", "manual", s.clientIP(r))
		writeJSON(w, 202, map[string]any{"id": id})
	case "test_s3", "test_email", "list", "download":
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		if in.Action == "test_email" {
			err = s.sendNotification(ctx, cfg.Email, "Jiggered test notification", "Your Jiggered email settings are working. No health data is included.")
			if err != nil {
				jsonError(w, 400, "Email test failed: "+err.Error())
				return
			}
			s.audit(r.Context(), actor, "email_test_sent", "", "configured recipients", s.clientIP(r))
			writeJSON(w, 200, map[string]string{"message": "Test email accepted by the SMTP server."})
			return
		}
		c, e := remoteClient(cfg.Remote)
		if e != nil {
			jsonError(w, 400, e.Error())
			return
		}
		if in.Action == "test_s3" {
			key := backupPrefix(cfg) + "probe-" + fmt.Sprint(time.Now().UnixNano())
			body := "Jiggered connection test\n"
			sum := sha256.Sum256([]byte(body))
			err = c.put(ctx, key, strings.NewReader(body), int64(len(body)), hex.EncodeToString(sum[:]))
			if err == nil {
				reader, _, e := c.get(ctx, key)
				err = e
				if e == nil {
					b, e := io.ReadAll(io.LimitReader(reader, 1024))
					reader.Close()
					err = e
					if err == nil && string(b) != body {
						err = errors.New("The test object was changed in transit.")
					}
				}
				cleanupCtx, done := context.WithTimeout(context.Background(), 15*time.Second)
				e = c.remove(cleanupCtx, key)
				done()
				if e != nil {
					err = fmt.Errorf("The probe could not be deleted; check DeleteObject permission: %w", e)
				}
			}
			if err == nil {
				_, err = c.list(ctx, backupPrefix(cfg), 1)
			}
			if err != nil {
				jsonError(w, 400, "S3 test failed: "+err.Error())
				return
			}
			writeJSON(w, 200, map[string]string{"message": "S3 write, read, delete and list checks passed."})
			return
		}
		if in.Action == "list" {
			objects, e := c.list(ctx, backupPrefix(cfg), 0)
			if e != nil {
				jsonError(w, 400, e.Error())
				return
			}
			owned := []s3Object{}
			for _, o := range objects {
				if ownedBackup(cfg, o.Key) {
					owned = append(owned, o)
				}
			}
			sort.Slice(owned, func(i, j int) bool { return owned[i].Key > owned[j].Key })
			truncated := len(owned) > 200
			if truncated {
				owned = owned[:200]
			}
			writeJSON(w, 200, map[string]any{"objects": owned, "truncated": truncated})
			return
		}
		if !ownedBackup(cfg, in.Key) {
			jsonError(w, 400, "Choose a backup belonging to this instance and prefix.")
			return
		}
		cancel()
		ctx, cancel = context.WithTimeout(r.Context(), 10*time.Minute)
		defer cancel()
		reader, size, e := c.get(ctx, in.Key)
		if e != nil {
			jsonError(w, 400, e.Error())
			return
		}
		defer reader.Close()
		http.NewResponseController(w).SetWriteDeadline(time.Now().Add(10 * time.Minute))
		w.Header().Set("Content-Type", backupContentType(in.Key))
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(in.Key)))
		w.Header().Set("Cache-Control", "no-store")
		if size >= 0 {
			w.Header().Set("Content-Length", fmt.Sprint(size))
		}
		s.audit(r.Context(), actor, "remote_backup_downloaded", "", "whole database", s.clientIP(r))
		io.Copy(w, reader)
	default:
		jsonError(w, 400, "Unknown backup or notification action.")
	}
}
func (s *server) startRemoteBackup(cfg serviceSettings, actor string) (int64, error) {
	if !s.backupMu.TryLock() {
		return 0, errors.New("A backup is already running.")
	}
	row, err := s.db.Exec(`INSERT INTO remote_backup_runs(started,status) VALUES(?,'running')`, time.Now().Unix())
	if err != nil {
		s.backupMu.Unlock()
		return 0, err
	}
	id, err := row.LastInsertId()
	if err != nil {
		s.backupMu.Unlock()
		return 0, err
	}
	s.serviceJobs.Add(1)
	go func() { defer s.serviceJobs.Done(); defer s.backupMu.Unlock(); s.runRemoteBackup(cfg, id, actor) }()
	return id, nil
}
func (s *server) runRemoteBackup(cfg serviceSettings, id int64, actor string) {
	parent := s.serviceCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Minute)
	defer cancel()
	key := ""
	var size int64
	uploaded, verified, retained := false, false, false
	err := func() error {
		c, err := remoteClient(cfg.Remote)
		if err != nil {
			return err
		}
		tmp, err := snapshotToTemp(s.db, s.cfg.dbPath)
		if err != nil {
			return err
		}
		defer os.Remove(tmp)
		password := ""
		if cfg.Remote.Encrypt {
			password = cfg.Remote.EncryptionPassword
		}
		archive, err := archiveBackup(tmp, password)
		if err != nil {
			return err
		}
		defer os.Remove(archive)
		f, err := os.Open(archive)
		if err != nil {
			return err
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			return err
		}
		size = st.Size()
		h := sha256.New()
		if _, err = io.Copy(h, f); err != nil {
			return err
		}
		if _, err = f.Seek(0, 0); err != nil {
			return err
		}
		digest := hex.EncodeToString(h.Sum(nil))
		var nonce [8]byte
		if _, err = rand.Read(nonce[:]); err != nil {
			return err
		}
		key = backupPrefix(cfg) + time.Now().UTC().Format("20060102T150405Z") + "-" + hex.EncodeToString(nonce[:]) + backupExtension(password)
		if err = c.put(ctx, key, f, size, digest); err != nil {
			return err
		}
		uploaded = true
		if cfg.Remote.Verify {
			reader, _, err := c.get(ctx, key)
			if err != nil {
				return fmt.Errorf("Upload completed, but verification failed: %w", err)
			}
			check := sha256.New()
			n, err := io.Copy(check, io.LimitReader(reader, size+1))
			reader.Close()
			if err != nil {
				return err
			}
			if n != size || hex.EncodeToString(check.Sum(nil)) != digest {
				return errors.New("Uploaded backup did not pass SHA-256 verification. Retention was skipped.")
			}
		}
		verified = cfg.Remote.Verify
		if cfg.Remote.Keep > 0 {
			objects, err := c.list(ctx, backupPrefix(cfg), 0)
			if err != nil {
				return fmt.Errorf("Backup uploaded; retention listing failed: %w", err)
			}
			owned := []s3Object{}
			for _, o := range objects {
				if ownedBackup(cfg, o.Key) && o.Key != key {
					owned = append(owned, o)
				}
			}
			sort.Slice(owned, func(i, j int) bool { return owned[i].Key > owned[j].Key })
			for i := cfg.Remote.Keep - 1; i < len(owned); i++ {
				if err = c.remove(ctx, owned[i].Key); err != nil {
					return fmt.Errorf("Backup uploaded; retention deletion failed: %w", err)
				}
			}
		}
		retained = true
		return nil
	}()
	status, message := "success", "Backup uploaded."
	if cfg.Remote.Verify {
		message = "Backup uploaded and SHA-256 verified."
	}
	if err != nil {
		status = "failed"
		if uploaded && (!cfg.Remote.Verify || verified) {
			status = "warning"
		}
		message = err.Error()
	}
	// Persist independently of a cancelled upload context so interruption remains visible.
	doneCtx, done := context.WithTimeout(context.Background(), 10*time.Second)
	defer done()
	s.writeBackupHistory(doneCtx, id, "record completion", `UPDATE remote_backup_runs SET finished=?,status=?,object_key=?,bytes=?,message=?,uploaded=?,verified=?,verification_required=?,retained=? WHERE id=?`, time.Now().Unix(), status, key, size, message, uploaded, verified, cfg.Remote.Verify, retained, id)
	s.audit(doneCtx, actor, "remote_backup_"+status, "", message, "")
	emailStatus := "not requested"
	if cfg.Email.Enabled && ((err != nil && cfg.Email.OnFailure) || (err == nil && cfg.Email.OnSuccess)) {
		mailCtx, closeMail := context.WithTimeout(parent, 25*time.Second)
		mailErr := s.sendNotification(mailCtx, cfg.Email, "Jiggered backup "+status, message+"\n\nNo check-ins, episodes or credentials are included in this notification.")
		closeMail()
		emailStatus = "accepted by SMTP"
		if mailErr != nil {
			emailStatus = "failed: " + mailErr.Error()
		}
	}
	s.writeBackupHistory(doneCtx, id, "record email outcome", `UPDATE remote_backup_runs SET email=? WHERE id=?`, emailStatus, id)
	s.writeBackupHistory(doneCtx, id, "prune history", `DELETE FROM remote_backup_runs WHERE id NOT IN (SELECT id FROM remote_backup_runs ORDER BY id DESC LIMIT 100) AND id NOT IN (SELECT id FROM remote_backup_runs WHERE uploaded=1 AND (verification_required=0 OR verified=1) ORDER BY finished DESC LIMIT 1) AND id NOT IN (SELECT id FROM remote_backup_runs WHERE verified=1 ORDER BY finished DESC LIMIT 1)`)
}

// writeBackupHistory reports persistence failures without retrying an already completed transfer.
// Arguments may contain private values, so only the operation and run ID are logged.
func (s *server) writeBackupHistory(ctx context.Context, id int64, operation, query string, args ...any) error {
	_, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		log.Printf("backup history run %d: %s: %v", id, operation, err)
	}
	return err
}

// recoverInterruptedWork is what a starting server owes the tables a crash left half-done: account mail stuck
// 'sending' goes back to the queue (or fails, with its payload erased, once its retries are spent), and backup runs
// that never finished are marked interrupted rather than left looking live. The scheduler calls it once, first.
func (s *server) recoverInterruptedWork(ctx context.Context) {
	s.db.ExecContext(ctx, `UPDATE account_mail_deliveries SET status='queued' WHERE status='sending' AND attempts<4`)
	s.db.ExecContext(ctx, `UPDATE account_mail_deliveries SET status='failed',payload='',token_hash='' WHERE status='sending' AND attempts>=4`)

	s.writeBackupHistory(ctx, 0, "mark interrupted runs", `UPDATE remote_backup_runs SET status='interrupted',finished=?,message='Server stopped before this backup finished. Check the destination before retrying.' WHERE status='running'`, time.Now().Unix())
}
func (s *server) serviceScheduler(ctx context.Context) {
	s.recoverInterruptedWork(ctx)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		s.scheduleRemoteBackup(ctx, time.Now())
		s.db.ExecContext(ctx, `DELETE FROM account_mail_deliveries WHERE created<? AND status NOT IN ('queued','sending')`, time.Now().AddDate(0, 0, -7).Unix())
		s.db.ExecContext(ctx, `DELETE FROM product_usage WHERE week<?`, time.Now().AddDate(0, 0, -90).Format("2006-01-02"))
		s.kickAccountMail()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *server) scheduleRemoteBackup(ctx context.Context, now time.Time) {
	cfg, err := s.loadServices(ctx, false)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("backup scheduler: read settings: %v", err)
		}
		return
	}
	if !cfg.Remote.Enabled {
		return
	}
	var last int64
	if err = s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(started),0) FROM remote_backup_runs`).Scan(&last); err != nil {
		if ctx.Err() == nil {
			log.Printf("backup scheduler: read history: %v", err)
		}
		return
	}
	if last < cfg.ScheduledFrom {
		last = cfg.ScheduledFrom
	}
	if now.Unix() < last+int64(cfg.Remote.IntervalHours)*3600 {
		return
	}
	// A missing key produces a recorded failure and observes the same interval, avoiding retry storms.
	clear, err := s.loadServices(ctx, true)
	if err != nil {
		s.writeBackupHistory(ctx, 0, "record scheduler failure", `INSERT INTO remote_backup_runs(started,finished,status,message) VALUES(?,?,'failed',?)`, now.Unix(), now.Unix(), err.Error())
		return
	}
	if _, err := s.startRemoteBackup(clear, "system"); err != nil {
		log.Printf("backup scheduler: start backup: %v", err)
	}
}
