package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"time"
)

var (
	errUserExists = errors.New("that username is taken")
	errNoUser     = errors.New("no such user")
	errLastAdmin  = errors.New("that would leave no active admin")
)

type user struct {
	ID         int64  `json:"id"`
	Username   string `json:"username"`
	Role       string `json:"role"`
	Disabled   bool   `json:"disabled"`
	MustChange bool   `json:"must_change_password"`
	CreatedAt  int64  `json:"created_at"`
	LastLogin  int64  `json:"last_login_at"` // 0 = never
}

// userStat is what an admin sees about an account: counts and sizes, never contents.
type userStat struct {
	user
	Docs     int   `json:"docs"`
	Bytes    int64 `json:"bytes"`
	Sessions int   `json:"sessions"`
}

const userCols = "id, username, role, disabled, must_change_password, created_at, COALESCE(last_login_at, 0)"

type rowScanner interface{ Scan(dest ...any) error }

func scanUser(row rowScanner) (*user, error) {
	var u user
	var disabled, must int
	err := row.Scan(&u.ID, &u.Username, &u.Role, &disabled, &must, &u.CreatedAt, &u.LastLogin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNoUser
	}
	if err != nil {
		return nil, err
	}
	u.Disabled, u.MustChange = disabled != 0, must != 0
	return &u, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// loginUser finds an account by (already normalised) name together with its
// bcrypt hash. An unknown name is (nil, nil, nil), not an error.
func (s *server) loginUser(ctx context.Context, name string) (*user, []byte, error) {
	if name == "" || len(name) > 64 {
		return nil, nil, nil
	}
	var hash string
	row := s.db.QueryRowContext(ctx, "SELECT "+userCols+", password_hash FROM users WHERE username = ?", name)
	var u user
	var disabled, must int
	err := row.Scan(&u.ID, &u.Username, &u.Role, &disabled, &must, &u.CreatedAt, &u.LastLogin, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	u.Disabled, u.MustChange = disabled != 0, must != 0
	return &u, []byte(hash), nil
}

func (s *server) userByID(ctx context.Context, id int64) (*user, error) {
	return scanUser(s.db.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE id = ?", id))
}

func (s *server) userByName(ctx context.Context, name string) (*user, error) {
	return scanUser(s.db.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE username = ?", normUsername(name)))
}

func (s *server) passwordHash(ctx context.Context, id int64) ([]byte, error) {
	var h string
	err := s.db.QueryRowContext(ctx, "SELECT password_hash FROM users WHERE id = ?", id).Scan(&h)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNoUser
	}
	return []byte(h), err
}

func (s *server) createUser(ctx context.Context, name, hash, role string, mustChange bool) (*user, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var taken int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE username = ?", name).Scan(&taken); err != nil {
		return nil, err
	}
	if taken > 0 {
		return nil, errUserExists
	}
	now := time.Now().Unix()
	res, err := tx.ExecContext(ctx, "INSERT INTO users(username, password_hash, role, must_change_password, created_at) VALUES(?, ?, ?, ?, ?)",
		name, hash, role, boolInt(mustChange), now)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &user{ID: id, Username: name, Role: role, MustChange: mustChange, CreatedAt: now}, nil
}

func (s *server) listUsers(ctx context.Context) ([]userStat, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.username, u.role, u.disabled, u.must_change_password, u.created_at, COALESCE(u.last_login_at, 0),
		  (SELECT count(*) FROM docs d WHERE d.user_id = u.id),
		  (SELECT COALESCE(sum(size), 0) FROM docs d WHERE d.user_id = u.id),
		  (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?)
		FROM users u ORDER BY u.username`, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []userStat{}
	for rows.Next() {
		var st userStat
		var disabled, must int
		if err := rows.Scan(&st.ID, &st.Username, &st.Role, &disabled, &must, &st.CreatedAt, &st.LastLogin, &st.Docs, &st.Bytes, &st.Sessions); err != nil {
			return nil, err
		}
		st.Disabled, st.MustChange = disabled != 0, must != 0
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *server) userCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n)
	return n, err
}

// withUserTx loads the account inside a write transaction and hands it to fn,
// so checks like "is this the last admin" can't race with the change.
func (s *server) withUserTx(ctx context.Context, id int64, fn func(tx *sql.Tx, u *user) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	u, err := scanUser(tx.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE id = ?", id))
	if err != nil {
		return err
	}
	if err := fn(tx, u); err != nil {
		return err
	}
	return tx.Commit()
}

// guardLastAdmin refuses a change that would leave the instance with no active admin.
func guardLastAdmin(ctx context.Context, tx *sql.Tx, u *user) error {
	if u.Role != roleAdmin || u.Disabled {
		return nil
	}
	var others int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?", u.ID).Scan(&others); err != nil {
		return err
	}
	if others == 0 {
		return errLastAdmin
	}
	return nil
}

// setPassword replaces the password and signs the account out everywhere except
// the session whose public id is keepSID ("" keeps none).
func (s *server) setPassword(ctx context.Context, id int64, hash string, mustChange bool, keepSID string) error {
	return s.withUserTx(ctx, id, func(tx *sql.Tx, _ *user) error {
		if _, err := tx.ExecContext(ctx, "UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?", hash, boolInt(mustChange), id); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ? AND sid != ?", id, keepSID)
		return err
	})
}

func (s *server) setRole(ctx context.Context, id int64, role string) error {
	return s.withUserTx(ctx, id, func(tx *sql.Tx, u *user) error {
		if u.Role == role {
			return nil
		}
		if err := guardLastAdmin(ctx, tx, u); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE users SET role = ? WHERE id = ?", role, id)
		return err
	})
}

// setDisabled blocks or restores sign-in. Disabling also ends every session.
func (s *server) setDisabled(ctx context.Context, id int64, disabled bool) error {
	return s.withUserTx(ctx, id, func(tx *sql.Tx, u *user) error {
		if u.Disabled == disabled {
			return nil
		}
		if disabled {
			if err := guardLastAdmin(ctx, tx, u); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", id); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, "UPDATE users SET disabled = ? WHERE id = ?", boolInt(disabled), id)
		return err
	})
}

// deleteUser removes the account and, by cascade, all of its docs and sessions.
func (s *server) deleteUser(ctx context.Context, id int64) error {
	return s.withUserTx(ctx, id, func(tx *sql.Tx, u *user) error {
		if err := guardLastAdmin(ctx, tx, u); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "DELETE FROM users WHERE id = ?", id)
		return err
	})
}

// revokeSessions ends the account's sessions except the one whose public id is
// exceptSID ("" ends them all) and says how many it ended.
func (s *server) revokeSessions(ctx context.Context, userID int64, exceptSID string) (int64, error) {
	res, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ? AND sid != ?", userID, exceptSID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

const (
	auditKeepFor = 180 * 24 * time.Hour
	auditMaxRows = 10000 // for each of the two kinds of event below
)

// auditSelfService matches the events a person can cause at will about themselves: signing in or failing to,
// changing their own password, signing their devices out, importing. They are kept under a cap of their own, so
// a flood of them can't push the record of what an admin did out of the log. Everything else (admin and
// command-line actions, settings, backups) has a cap that only an admin can fill.
const auditSelfService = `(action IN ('login', 'login_failed', 'login_refused', 'password_check_failed', 'password_changed', 'session_revoked', 'import')
	OR (action = 'sessions_revoked' AND actor = target))`

// audit records who did what. Best effort: a failure to log never fails the request.
func (s *server) audit(ctx context.Context, actor, action, target, detail, ip string) {
	_, err := s.db.ExecContext(context.WithoutCancel(ctx),
		"INSERT INTO audit_log(at, actor, action, target, detail, ip) VALUES(?, ?, ?, ?, ?, ?)",
		time.Now().Unix(), actor, action, target, detail, ip)
	if err != nil {
		log.Printf("audit log: %v", err)
	}
}

// prune drops expired sessions and old audit entries (by age, and by count within each kind of event).
func (s *server) prune() {
	now := time.Now()
	s.db.Exec("DELETE FROM sessions WHERE expires_at < ?", now.Unix())
	s.db.Exec("DELETE FROM audit_log WHERE at < ?", now.Add(-auditKeepFor).Unix())
	for _, kind := range []string{auditSelfService, "NOT " + auditSelfService} {
		s.db.Exec("DELETE FROM audit_log WHERE "+kind+" AND id <= (SELECT id FROM audit_log WHERE "+kind+" ORDER BY id DESC LIMIT 1 OFFSET ?)", auditMaxRows)
	}
}
