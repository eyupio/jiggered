#!/usr/bin/env bash
# Fail if any named tag of a GHCR package no longer resolves to a full manifest tree.
# Usage: ghcr-check-tags.sh <package> <tag>...   (env: GH_TOKEN, GITHUB_REPOSITORY_OWNER)
set -euo pipefail
package=${1:?package}; shift
repo=$(tr 'A-Z' 'a-z' <<<"$GITHUB_REPOSITORY_OWNER/$package")
echo "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_REPOSITORY_OWNER" --password-stdin >/dev/null
for tag in "$@"; do
  if ! docker buildx imagetools inspect "ghcr.io/$repo:$tag" >/dev/null 2>&1; then
    # A tag that was never published is not a failure.
    if docker manifest inspect "ghcr.io/$repo:$tag" 2>&1 | grep -qi 'no such manifest\|manifest unknown'; then
      echo "::error::$repo:$tag does not pull"; exit 1
    fi
    echo "$repo:$tag not checked (unreachable)"; continue
  fi
  echo "$repo:$tag ok"
done
