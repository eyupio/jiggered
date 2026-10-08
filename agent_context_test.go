package main

import (
	"os"
	"strings"
	"testing"
)

// A Zoomies AI Context install or reinstall can write its block into CLAUDE.md as
// well as AGENTS.md. Claude Code expands the @AGENTS.md import, so a second copy is
// loaded twice and the two drift apart; fail on the reinstall pull request rather
// than after it merges.
func TestClaudeCodeLoadsOneZoomiesBlock(t *testing.T) {
	claude, err := os.ReadFile("CLAUDE.md")
	if err != nil {
		t.Fatal(err)
	}
	agents, err := os.ReadFile("AGENTS.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(claude), "\n@AGENTS.md\n") {
		t.Fatal("CLAUDE.md no longer imports AGENTS.md, so this test would count the wrong text")
	}
	loaded := strings.Replace(string(claude), "@AGENTS.md", string(agents), 1)
	for _, marker := range []string{
		"<!-- zoomies-ai-context:start -->",
		"<!-- zoomies-ai-context:end -->",
		"## Zoomies AI Context",
	} {
		if n := strings.Count(loaded, marker); n != 1 {
			t.Errorf("%q appears %d times in what Claude Code loads, want 1; keep the Zoomies block in AGENTS.md only", marker, n)
		}
	}
}
