package main

import (
	"testing"
	"testing/fstest"
)

func BenchmarkServiceWorker(b *testing.B) {
	st := newStatic(fstest.MapFS{"app.js": {Data: []byte("x")}})
	sw := []byte(`const CACHE = "jiggered-app-v1";
const SHELL = ["/", "/app.js", "/style.css", "/tokens.css", "/login.js", "/tools.css"];
`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		st.serviceWorker(sw)
	}
}
