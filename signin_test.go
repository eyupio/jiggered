package main

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// postLogin signs in with no cookie jar and without following the redirect, and says where it was sent.
// Unlike the client helpers it is safe to call from a goroutine.
func postLogin(base, name, pw, xff string) string {
	form := url.Values{"username": {name}, "password": {pw}}
	r, _ := http.NewRequest("POST", base+"/login", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	hc := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := hc.Do(r)
	if err != nil {
		return "error: " + err.Error()
	}
	resp.Body.Close()
	return resp.Header.Get("Location")
}

// slowHashing makes each bcrypt long enough that a whole burst of requests is in flight before the first
// answer comes back, which is what a real attacker gets with the real cost.
func slowHashing(t *testing.T) {
	old := bcryptCost
	bcryptCost = 10
	t.Cleanup(func() { bcryptCost = old })
}

// burst runs fn(i) for i in [0, n) at the same time and tallies what each returned.
func burst(n int, fn func(i int) string) map[string]int {
	var wg sync.WaitGroup
	var mu sync.Mutex
	tally := map[string]int{}
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got := fn(i)
			mu.Lock()
			tally[got]++
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	return tally
}

// The limits count a guess as soon as it is allowed to start, not when its answer comes back: otherwise a burst
// of requests all pass the check before any failure is recorded, and the "ten tries" are really dozens.

func TestBurstFromOneAddressCannotOutrunTheAddressLockout(t *testing.T) {
	slowHashing(t)
	e := newTestServer(t)
	tally := burst(40, func(i int) string {
		return postLogin(e.ts.URL, fmt.Sprintf("ghost%d", i), "wrong-wrong", "")
	})
	if tally["/login?e=bad"] > 10 {
		t.Errorf("%d guesses were checked from one address in one burst, want at most 10 (%v)", tally["/login?e=bad"], tally)
	}
	if tally["/login?e=locked"] == 0 {
		t.Errorf("nothing was refused up front (%v)", tally)
	}
}

func TestBurstAtOneAccountCannotOutrunTheAccountLockout(t *testing.T) {
	slowHashing(t)
	e := newTestServer(t)
	e.set("trust_proxy", "true")
	e.addUser("alice", roleUser)
	burst(40, func(i int) string { // every guess from its own address, so only the account's budget applies
		return postLogin(e.ts.URL, "alice", "wrong-wrong", fmt.Sprintf("198.51.100.%d", i+1))
	})
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'login_failed' AND target = 'alice'"); n > 10 {
		t.Errorf("%d wrong passwords were checked against one account in one burst, want at most 10", n)
	}
}

func TestBurstOfPasswordChecksCannotOutrunTheLockout(t *testing.T) {
	slowHashing(t)
	e := newTestServer(t)
	c := e.signedInAdmin()
	burst(30, func(int) string {
		r, _ := http.NewRequest("POST", e.ts.URL+"/api/me/password", strings.NewReader(`{"current":"wrong-guess","new":"brand-new-pass"}`))
		r.Header.Set("X-Requested-With", "jiggered")
		r.Header.Set("Content-Type", "application/json")
		resp, err := c.hc.Do(r)
		if err != nil {
			return err.Error()
		}
		resp.Body.Close()
		return fmt.Sprint(resp.StatusCode)
	})
	if n := countRows(t, e, "SELECT count(*) FROM audit_log WHERE action = 'password_check_failed'"); n > 10 {
		t.Errorf("%d wrong current passwords were checked in one burst, want at most 10", n)
	}
}

func TestAReservedAttemptIsGivenBackWhenThePasswordWasRight(t *testing.T) {
	e := newTestServer(t)
	for i := 0; i < 9; i++ {
		e.newClient().login("nobody", "wrong-wrong")
	}
	for i := 0; i < 5; i++ { // right password: must not use up the tenth try
		if loc := e.newClient().login(adminName, adminPass); loc != "/" {
			t.Fatalf("sign-in %d: %q", i, loc)
		}
	}
	if loc := e.newClient().login("nobody", "wrong-wrong"); loc != "/login?e=bad" {
		t.Errorf("the tenth wrong guess should still be checked: %q", loc)
	}
	if loc := e.newClient().login(adminName, adminPass); loc != "/login?e=locked" {
		t.Errorf("after ten wrong guesses the address is locked: %q", loc)
	}
}

func TestALockedAccountLooksLikeAnUnknownOne(t *testing.T) {
	e := newTestServer(t)
	e.set("trust_proxy", "true")
	e.addUser("alice", roleUser)
	for i := 0; i < 10; i++ {
		e.newClient().login("alice", "wrong-wrong", "X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i+1))
	}
	locked := e.newClient().login("alice", "password-alice", "X-Forwarded-For", "198.51.100.200")
	unknown := e.newClient().login("ghost", "wrong-wrong", "X-Forwarded-For", "198.51.100.201")
	if locked != unknown {
		t.Errorf("a locked account answers %q but an unknown name %q: that tells a stranger which names exist", locked, unknown)
	}
}
