#!/usr/bin/env bash
#
# Print agent directory names, one per line.
#
# An "agent" is any top-level directory that is not in EXCLUDE and is not
# hidden. Add new non-agent directories to EXCLUDE.

set -euo pipefail

EXCLUDE=(plugins skills scripts assets)

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

shopt -s nullglob
for entry in */; do
  name="${entry%/}"
  [[ "$name" == .* ]] && continue
  for ex in "${EXCLUDE[@]}"; do
    [[ "$name" == "$ex" ]] && continue 2
  done
  echo "$name"
done
