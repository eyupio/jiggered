package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Instance settings live in the database, not the environment: an admin can change them while the server runs,
// they survive upgrades and they travel with a backup. All the environment has to say is where the database is
// (APP_DB) and where to listen (APP_ADDR). The old variables below are read once, to fill in a setting the
// database has no value for yet; after that the database wins.

type instanceSettings struct {
	SecureCookie bool // session cookies are HTTPS-only
	TrustProxy   bool // take the client address from X-Forwarded-For
	ProxyHops    int  // how many trusted proxies sit in front
}

// Safe unless told otherwise: cookies need HTTPS, and no proxy header is believed.
var settingDefaults = instanceSettings{SecureCookie: true, TrustProxy: false, ProxyHops: 1}

var settingKeys = []string{"secure_cookie", "trust_proxy", "proxy_hops"}

// settingEnv is the variable older versions read each setting from.
var settingEnv = map[string]string{"secure_cookie": "APP_SECURE_COOKIE", "trust_proxy": "APP_TRUST_PROXY", "proxy_hops": "APP_PROXY_HOPS"}

// settingsCacheFor is how long a running server trusts what it last read, so a change made from the command
// line (another process) reaches it within a couple of seconds without a restart.
const settingsCacheFor = 2 * time.Second

func (st instanceSettings) strings() map[string]string {
	return map[string]string{
		"secure_cookie": strconv.FormatBool(st.SecureCookie),
		"trust_proxy":   strconv.FormatBool(st.TrustProxy),
		"proxy_hops":    strconv.Itoa(st.ProxyHops),
	}
}

// parseSetting checks a value and returns it in the form it is stored.
func parseSetting(key, value string) (string, error) {
	switch key {
	case "secure_cookie", "trust_proxy":
		b, err := strconv.ParseBool(strings.ToLower(strings.TrimSpace(value)))
		if err != nil {
			return "", fmt.Errorf("%s must be true or false", key)
		}
		return strconv.FormatBool(b), nil
	case "proxy_hops":
		n, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || n < 1 || n > 10 {
			return "", errors.New("proxy_hops must be a number from 1 to 10")
		}
		return strconv.Itoa(n), nil
	}
	return "", fmt.Errorf("unknown setting %q (the settings are %s)", key, strings.Join(settingKeys, ", "))
}

// boolish reads true/false the usual ways, in any case: 1, 0, yes, no, on, off.
func boolish(v string) (value, ok bool) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "yes", "y", "on", "t":
		return true, true
	case "false", "0", "no", "n", "off", "f":
		return false, true
	}
	return false, false
}

// seedFromEnv turns an older environment variable into a setting value, or says there is none.
func seedFromEnv(key, env string) (string, bool) {
	if env == "" {
		return "", false
	}
	switch key {
	case "secure_cookie": // secure unless clearly told otherwise
		b, ok := boolish(env)
		return strconv.FormatBool(!ok || b), true
	case "trust_proxy": // off unless clearly told otherwise
		b, ok := boolish(env)
		return strconv.FormatBool(ok && b), true
	}
	return env, true // proxy_hops: validated by loadConfig
}

type settingsCache struct {
	mu  sync.Mutex
	val instanceSettings
	at  time.Time
	ok  bool
}

func (s *server) loadSettings(ctx context.Context) (instanceSettings, error) {
	st := settingDefaults
	rows, err := s.db.QueryContext(ctx, "SELECT key, value FROM instance_settings")
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return st, err
		}
		switch k {
		case "secure_cookie":
			st.SecureCookie = v == "true"
		case "trust_proxy":
			st.TrustProxy = v == "true"
		case "proxy_hops":
			if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 10 {
				st.ProxyHops = n
			}
		}
	}
	return st, rows.Err()
}

// settings is what the request handlers consult. It never blocks for long and never fails: if the database
// can't be read it keeps using the last good values (or the safe defaults).
func (s *server) settings() instanceSettings {
	s.cache.mu.Lock()
	val, ok, fresh := s.cache.val, s.cache.ok, s.cache.ok && time.Since(s.cache.at) < settingsCacheFor
	s.cache.mu.Unlock()
	if fresh {
		return val
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	st, err := s.loadSettings(ctx)
	if err != nil {
		log.Printf("reading settings: %v", err)
		if ok {
			return val
		}
		return settingDefaults
	}
	s.cache.mu.Lock()
	s.cache.val, s.cache.at, s.cache.ok = st, time.Now(), true
	s.cache.mu.Unlock()
	return st
}

func (s *server) forgetSettings() {
	s.cache.mu.Lock()
	s.cache.ok = false
	s.cache.mu.Unlock()
}

// setSetting validates and stores one setting and returns the value as stored.
func (s *server) setSetting(ctx context.Context, key, value string) (string, error) {
	canon, err := parseSetting(key, value)
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO instance_settings(key, value, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, canon, time.Now().Unix())
	s.forgetSettings()
	return canon, err
}

// setSettings validates every value first, then stores them all in one transaction, so a request that is refused
// changes nothing. It returns the stored (canonical) values.
func (s *server) setSettings(ctx context.Context, in map[string]string) (map[string]string, error) {
	canon := make(map[string]string, len(in))
	for k, v := range in {
		c, err := parseSetting(k, v)
		if err != nil {
			return nil, err
		}
		canon[k] = c
	}
	if len(canon) == 0 {
		return canon, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	for k, c := range canon {
		if _, err := tx.ExecContext(ctx, `INSERT INTO instance_settings(key, value, updated_at) VALUES(?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, k, c, now); err != nil {
			return nil, err
		}
	}
	err = tx.Commit()
	s.forgetSettings()
	return canon, err
}

// storedSettings reports each setting's value and whether it was set explicitly (otherwise it is the default).
func (s *server) storedSettings(ctx context.Context) (values map[string]string, explicit map[string]bool, err error) {
	st, err := s.loadSettings(ctx)
	if err != nil {
		return nil, nil, err
	}
	explicit = map[string]bool{}
	rows, err := s.db.QueryContext(ctx, "SELECT key FROM instance_settings")
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, nil, err
		}
		if _, known := settingEnv[k]; known {
			explicit[k] = true
		}
	}
	return st.strings(), explicit, rows.Err()
}

// seedSettings fills in settings the database has no value for from the older environment variables, once.
// A value already in the database always wins, and says so in the log if the environment disagrees.
func (s *server) seedSettings(ctx context.Context) error {
	for _, k := range settingKeys {
		v, ok := s.cfg.seeds[k]
		if !ok {
			continue
		}
		res, err := s.db.ExecContext(ctx, "INSERT OR IGNORE INTO instance_settings(key, value, updated_at) VALUES(?, ?, ?)", k, v, time.Now().Unix())
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			log.Printf("copied %s=%s into the database as the setting %s. The database is the source now, so you can remove %s from your environment", settingEnv[k], v, k, settingEnv[k])
			s.audit(ctx, "system", "settings_imported", "", k+" = "+v, "")
			continue
		}
		var cur string
		if err := s.db.QueryRowContext(ctx, "SELECT value FROM instance_settings WHERE key = ?", k).Scan(&cur); err == nil && cur != v {
			log.Printf("ignoring %s=%s: the database already says %s = %s, and the database wins (change it in Admin, or with `jiggered settings set`)", settingEnv[k], v, k, cur)
		}
	}
	s.forgetSettings()
	return nil
}
