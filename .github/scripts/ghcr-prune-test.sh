#!/usr/bin/env bash
# Checks the prune rule against a fake registry.
set -euo pipefail
source "$(dirname "$0")/ghcr-prune.sh"

old=2020-01-01T00:00:00Z
new=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DRY_RUN=false KEEP_DAYS=14
# index sha:idx (tagged) -> children sha:amd, sha:arm, sha:att; sha:orphan and sha:newer are untagged.
list_versions() {
  cat <<JSON
[{"id":1,"name":"sha:idx","created_at":"$old","tags":["latest"]},
 {"id":2,"name":"sha:amd","created_at":"$old","tags":[]},
 {"id":3,"name":"sha:arm","created_at":"$old","tags":[]},
 {"id":4,"name":"sha:att","created_at":"$old","tags":[]},
 {"id":5,"name":"sha:orphan","created_at":"$old","tags":[]},
 {"id":6,"name":"sha:newer","created_at":"$new","tags":[]}]
JSON
}
fetch_manifest() {
  case $1 in
    sha:idx) echo '{"manifests":[{"digest":"sha:amd"},{"digest":"sha:arm"},{"digest":"sha:att"}]}' ;;
    *) echo '{"layers":[]}' ;;
  esac
}
deleted=()
delete_version() { deleted+=("$1"); }

prune >/dev/null
[ "${deleted[*]}" = 5 ] || { echo "FAIL: expected only version 5 deleted, got: ${deleted[*]:-none}"; exit 1; }

deleted=()
fetch_manifest() { return 1; }
if prune >/dev/null 2>&1; then echo "FAIL: unreadable manifest should abort"; exit 1; fi
[ ${#deleted[@]} -eq 0 ] || { echo "FAIL: deleted despite unreadable manifest"; exit 1; }
echo "ghcr-prune: ok"
