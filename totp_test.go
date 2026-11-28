package main

import (
	"testing"
	"time"
)

// The acceptance window is a security boundary: one step either side of now
// is tolerated for clock drift, and anything further out is an overheard or
// replayed code that must be refused.
func TestMatchTOTPAcceptsOnlyWithinTheSkewWindow(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte("12345678901234567890"))
	const codeStep = int64(10)
	code, err := totpCode(secret, codeStep)
	if err != nil {
		t.Fatal(err)
	}
	at := func(step int64) time.Time { return time.Unix(step*int64(totpPeriod/time.Second)+5, 0) }

	cases := []struct {
		name string
		now  time.Time
		ok   bool
	}{
		{"same step", at(codeStep), true},
		{"one step late (phone clock behind)", at(codeStep + 1), true},
		{"one step early (phone clock ahead)", at(codeStep - 1), true},
		{"two steps late", at(codeStep + 2), false},
		{"two steps early", at(codeStep - 2), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			step, ok := matchTOTP(secret, code, tc.now)
			if ok != tc.ok {
				t.Fatalf("matchTOTP accepted=%v, want %v", ok, tc.ok)
			}
			if ok && step != codeStep {
				t.Fatalf("matched step %d, want %d (the step is what replay protection records)", step, codeStep)
			}
		})
	}
}

func TestMatchTOTPRefusesMalformedCodes(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte("12345678901234567890"))
	now := time.Unix(59, 0) // step 1, code 287082
	for _, code := range []string{"", "28708", "2870822", "28708x", "000000"} {
		if _, ok := matchTOTP(secret, code, now); ok {
			t.Errorf("code %q was accepted", code)
		}
	}
	if _, ok := matchTOTP(secret, "287-082", now); !ok {
		t.Error("a code with the hyphen some apps show was refused")
	}
	if _, ok := matchTOTP("not base32!", "287082", now); ok {
		t.Error("a corrupt stored secret must fail closed")
	}
}
