package main

import (
	"fmt"
	"strings"
	"testing"
)

func TestDefaultsAllowLongListsAndGroups(t *testing.T) {
	d := productDefaults{Budget: 10, SleepPenalty: 3, Locale: "en-GB", Symptoms: []string{}, Triggers: []string{}}
	for i := 0; i < 200; i++ {
		d.Activities = append(d.Activities, struct {
			ID string `json:"id,omitempty"`
			A  string `json:"a"`
			C  int    `json:"c"`
			G  string `json:"g,omitempty"`
		}{A: fmt.Sprintf("a%d", i), C: 1, G: "Work"})
	}
	if err := d.validate(); err != nil {
		t.Fatalf("200 grouped activities rejected: %v", err)
	}
	d.Activities[0].G = strings.Repeat("g", 31)
	if d.validate() == nil {
		t.Error("31-character group accepted")
	}
	d.Activities[0].G = ""
	d.Symptoms = make([]string, 201)
	if d.validate() == nil {
		t.Error("201 items accepted")
	}
}
