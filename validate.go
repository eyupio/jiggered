package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// validateDoc is the one definition of a valid document. It checks the fields the app knows about and leaves everything
// else alone, so older records and fields from newer clients are accepted and kept exactly as sent. It runs on every
// way a document can arrive: a save (PUT), a legacy import, and a restore preview or commit. A save or an imported
// record that fails is refused; a restore with any failing record is rejected whole.
func validateDoc(id string, raw json.RawMessage) error {
	if !validDocID(id) || len(raw) > maxBodySize {
		return fmt.Errorf("unsupported record id or record too large")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return fmt.Errorf("record must be a JSON object")
	}
	if id == "settings" {
		factory, _ := webFS.ReadFile("web/defaults.json")
		var d productDefaults
		json.Unmarshal(factory, &d)
		if err := json.Unmarshal(raw, &d); err != nil {
			return fmt.Errorf("settings field has the wrong type")
		}
		// A penalty the document leaves out falls back to its default, but never above the budget: that is how the
		// app reads a short settings document, so an older one such as {"budget":3} is valid.
		if _, ok := fields["sleepPenalty"]; !ok {
			d.SleepPenalty = min(d.SleepPenalty, d.Budget)
		}
		for name, p := range map[string]**int{"amberPenalty": &d.AmberPenalty, "redPenalty": &d.RedPenalty} {
			if _, ok := fields[name]; !ok && *p != nil {
				v := min(**p, d.Budget)
				*p = &v
			}
		}
		// A group set for a name that is no longer in the list is dropped when the app reads settings, and a renamed
		// item in the shared defaults leaves exactly that behind, so it is read the same way here, not refused.
		d.SymptomGroups = pruneGroups(d.SymptomGroups, d.Symptoms)
		d.TriggerGroups = pruneGroups(d.TriggerGroups, d.Triggers)
		return d.validate()
	}
	var value map[string]any
	json.Unmarshal(raw, &value)
	for _, field := range []string{"when", "endedAt", "whenZone", "endZone", "notes", "onset", "duration", "date"} {
		if v, ok := value[field]; ok {
			if _, ok := v.(string); !ok {
				return fmt.Errorf("%s must be text", field)
			}
		}
	}
	for _, field := range []string{"symptoms", "before"} {
		if v, ok := value[field]; ok {
			list, ok := v.([]any)
			if !ok {
				return fmt.Errorf("%s must be a list", field)
			}
			for _, n := range list {
				if _, ok := n.(string); !ok {
					return fmt.Errorf("%s must contain text", field)
				}
			}
		}
	}
	for _, field := range []string{"when", "endedAt"} {
		if v, ok := value[field].(string); ok && v != "" {
			if _, err := time.Parse("2006-01-02T15:04", v); err != nil {
				if _, err := time.Parse("2006-01-02T15:04:05", v); err != nil {
					return fmt.Errorf("%s must be a valid local date and time", field)
				}
			}
		}
	}
	if strings.HasPrefix(id, "d-") {
		if v, ok := value["date"]; ok && v != id[2:] {
			return fmt.Errorf("date does not match record id")
		}
		if v, ok := value["status"]; ok && v != nil && v != "green" && v != "amber" && v != "red" {
			return fmt.Errorf("unknown check-in status")
		}
		if v, ok := value["poorSleep"]; ok {
			if _, ok := v.(bool); !ok {
				return fmt.Errorf("poorSleep must be true or false")
			}
		}
		for _, field := range []string{"budget", "sleepPenalty"} {
			if v, ok := value[field]; ok {
				n, ok := v.(float64)
				if !ok || n != float64(int(n)) || n < 0 || n > 30 || field == "budget" && n < 1 {
					return fmt.Errorf("%s must be a valid whole number", field)
				}
			}
		}
		if v, ok := value["entries"]; ok {
			list, ok := v.([]any)
			if !ok {
				return fmt.Errorf("entries must be a list")
			}
			ids := map[string]bool{}
			for _, entry := range list {
				e, ok := entry.(map[string]any)
				if !ok {
					return fmt.Errorf("activity must be an object")
				}
				a, ok := e["a"].(string)
				if !ok || strings.TrimSpace(a) == "" || utf8.RuneCountInString(a) > 60 {
					return fmt.Errorf("activity needs a name of 1–60 characters")
				}
				n, ok := e["c"].(float64)
				if !ok || n != float64(int(n)) || n < -10 || n > 10 {
					return fmt.Errorf("activity points must be a whole number from −10 to 10")
				}
				if v, ok := e["id"]; ok {
					id, ok := v.(string)
					if !ok || id == "" || ids[id] {
						return fmt.Errorf("activity ids must be distinct text")
					}
					ids[id] = true
				}
				if v, ok := e["t"]; ok {
					t, ok := v.(string)
					if !ok {
						return fmt.Errorf("activity time must be text")
					}
					if t != "" {
						if _, err := time.Parse("15:04", t); err != nil {
							return fmt.Errorf("activity time must be HH:MM or empty")
						}
					}
				}
			}
		}
	}
	return nil
}
