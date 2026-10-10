//go:build tools

// Package tools pins how staticcheck is built. Go 1.27.2 writes compiler export data at a newer
// version than the golang.org/x/tools that staticcheck v0.8.1 ships with can read, so every
// package failed to load with "export data version 5 is greater than maximum supported version 4".
// Building it against a newer golang.org/x/tools keeps every check and fixes the load. Drop this
// module and go back to `go install honnef.co/go/tools/cmd/staticcheck@<version>` once a staticcheck
// release builds against an x/tools that reads Go 1.27.2 export data on its own.
package tools

import _ "honnef.co/go/tools/cmd/staticcheck"
