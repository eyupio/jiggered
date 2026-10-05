#!/usr/bin/env bash
# Delete untagged GHCR package versions that nothing refers to.
#
# Usage: ghcr-prune.sh <package>      (env: GH_TOKEN, GITHUB_REPOSITORY_OWNER, DRY_RUN, KEEP_DAYS)
#
# "Untagged" is not "unused": the per-platform and attestation manifests under a
# multi-platform tag are untagged package versions too. A version is kept when it
# is tagged, younger than KEEP_DAYS, or a child of a kept index. Deletes nothing
# if any manifest cannot be read.
set -euo pipefail

# Overridable by the test script.
list_versions() { # prints a JSON array of {id,name,created_at,tags}
  gh api --paginate "$API/versions?per_page=100" |
    jq -s '[.[][] | {id, name, created_at, tags: (.metadata.container.tags // [])}]'
}
fetch_manifest() { # $1 = digest; prints the manifest JSON
  curl -fsS -H "Authorization: Bearer $REG_TOKEN" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/$REPO/manifests/$1"
}
delete_version() { gh api -X DELETE "$API/versions/$1" >/dev/null; }

prune() {
  local versions keep cutoff manifest children count=0
  versions=$(list_versions)
  cutoff=$(date -u -d "-${KEEP_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)
  # Roots: tagged or recent versions.
  keep=$(jq -r --arg c "$cutoff" '.[] | select((.tags | length) > 0 or .created_at >= $c) | .name' <<<"$versions")
  local roots=$keep d
  for d in $roots; do
    manifest=$(fetch_manifest "$d") || { echo "cannot read manifest $d; deleting nothing" >&2; return 1; }
    children=$(jq -r '.manifests[]?.digest' <<<"$manifest")
    keep+=$'\n'"$children"
  done
  while IFS=$'\t' read -r id name; do
    grep -qxF "$name" <<<"$keep" && continue
    if [ "$DRY_RUN" = true ]; then
      echo "would delete $id $name"
    else
      echo "deleting $id $name"
      delete_version "$id"
    fi
    count=$((count + 1))
  done < <(jq -r --arg c "$cutoff" '.[] | select((.tags | length) == 0 and .created_at < $c) | [.id, .name] | @tsv' <<<"$versions")
  echo "$count version(s) $([ "$DRY_RUN" = true ] && echo 'would be ')deleted"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  PACKAGE=${1:?package name}
  DRY_RUN=${DRY_RUN:-true}
  KEEP_DAYS=${KEEP_DAYS:-14}
  OWNER=${GITHUB_REPOSITORY_OWNER:?}
  REPO=$(tr 'A-Z' 'a-z' <<<"$OWNER/$PACKAGE")
  if [ "$(gh api "/users/$OWNER" --jq .type)" = Organization ]; then
    API="/orgs/$OWNER/packages/container/$PACKAGE"
  else
    API="/users/$OWNER/packages/container/$PACKAGE"
  fi
  REG_TOKEN=$(curl -fsS -u "$OWNER:$GH_TOKEN" "https://ghcr.io/token?service=ghcr.io&scope=repository:$REPO:pull" | jq -r .token)
  prune
fi
