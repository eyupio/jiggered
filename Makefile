# The checks CI runs, in one place. CONTRIBUTING.md explains each one.
.PHONY: check go-check web-check browser

check: go-check web-check

go-check:
	test -z "$$(gofmt -l .)" || { gofmt -d .; exit 1; }
	go vet ./...
	@command -v staticcheck >/dev/null || { echo 'install it: go install honnef.co/go/tools/cmd/staticcheck@v0.8.1'; exit 1; }
	staticcheck ./...
	CGO_ENABLED=0 go build ./...
	go test -race ./...

web-check:
	npm ci --prefix test
	npm --prefix test run check

# Compiles one fixture binary, then runs every browser scenario and the public-page check.
browser:
	npm ci --prefix test
	CGO_ENABLED=0 go build -o test/artifacts/jiggered-browser .
	JIGGERED_TEST_BINARY=$(CURDIR)/test/artifacts/jiggered-browser npm --prefix test run browser
	JIGGERED_TEST_BINARY=$(CURDIR)/test/artifacts/jiggered-browser node test/browser-public.cjs
