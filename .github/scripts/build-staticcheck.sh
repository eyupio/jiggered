#!/usr/bin/env bash
# Build the staticcheck release this repository pins, against a newer x/tools.
#
# Usage: build-staticcheck.sh <output-path>
#
# v0.8.1 pins an x/tools that cannot read Go 1.27 export data, so a plain
# `go install` of that release produces a checker that fails on this repository. Build the same release with a supported x/tools in a
# temporary checkout; the application's go.mod and go.sum stay untouched.
set -euo pipefail

output=${1:?usage: build-staticcheck.sh <output-path>}
mkdir -p "$(dirname "$output")"
output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT

git clone --quiet --depth 1 --branch v0.8.1 https://github.com/dominikh/go-tools.git "$src"
(cd "$src" && go get golang.org/x/tools@v0.50.0 && go build -o "$output" ./cmd/staticcheck)
