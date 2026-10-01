package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
)

// Public text (scripts, styles, pages) is compressed once and served compressed to browsers that accept it. Nothing
// private is: API responses and anything built from a person's data stay as they are, because compressing a response
// that mixes secrets with text an attacker can influence can leak the secret through its size. Fonts and images are
// already compressed and are left alone.

// acceptsGzip reports whether the request's Accept-Encoding allows gzip (an explicit q=0 refuses it).
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(strings.Join(r.Header.Values("Accept-Encoding"), ","), ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		if q, ok := strings.CutPrefix(strings.ReplaceAll(strings.ToLower(params), " ", ""), "q="); ok {
			if v, err := strconv.ParseFloat(q, 64); err == nil && v <= 0 {
				return false
			}
		}
		return true
	}
	return false
}

// compressibleFile says whether a static file is text worth compressing.
func compressibleFile(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".js", ".css", ".html", ".json", ".svg", ".webmanifest":
		return true
	}
	return false
}

// gzipCache keeps each compressed body, keyed by what it was made from, for the life of the process. Public files
// are few and small, so this is a fixed, tiny amount of memory and the work happens once per file.
type gzipCache struct{ m sync.Map }

func (c *gzipCache) get(key string, raw func() ([]byte, error)) []byte {
	if v, ok := c.m.Load(key); ok {
		return v.([]byte)
	}
	b, err := raw()
	if err != nil {
		return nil
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	zw.Write(b)
	if zw.Close() != nil || buf.Len() >= len(b) { // not worth sending
		c.m.Store(key, []byte(nil))
		return nil
	}
	c.m.Store(key, buf.Bytes())
	return buf.Bytes()
}

// serveCompressed writes body in gzip form with its own validator, and answers a matching If-None-Match with 304.
// etag is the identity representation's tag; the compressed one is a different representation and gets a different tag.
func serveCompressed(w http.ResponseWriter, r *http.Request, contentType, etag string, body []byte) {
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Encoding", "gzip")
	if etag != "" {
		tag := strings.TrimSuffix(etag, `"`) + `-gzip"`
		h.Set("ETag", tag)
		if inm := r.Header.Get("If-None-Match"); inm != "" && tagMatches(inm, tag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		return
	}
	w.Write(body)
}

func contentTypeOf(name string) string {
	if strings.HasSuffix(name, ".webmanifest") {
		return "application/manifest+json"
	}
	if t := mime.TypeByExtension(path.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// pageTag is a strong tag for a generated page, derived from its exact bytes.
func pageTag(page []byte) string {
	sum := sha256.Sum256(page)
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}
