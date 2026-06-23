#!/usr/bin/env bash
#
# Run unit tests for one agent directory.
#
#   - TypeScript (package.json): `bun install`, then `bun run test:unit`
#     if defined, else `bun run test`, else `bun test` when *.test.ts files
#     exist.
#   - Python (requirements.txt / pyproject.toml): install deps + pytest,
#     then `python -m pytest`.
#
# Agents with no tests are skipped (exit 0) without installing anything.
# Exits non-zero only when tests actually fail.
#
# Environment:
#   SKIP_INSTALL=1   skip dependency install (deps assumed present)

set -uo pipefail

agent="${1:?usage: $0 <agent-dir>}"
agent="${agent%/}"

if [[ ! -d "$agent" ]]; then
  echo "::error::$agent is not a directory"
  exit 1
fi

cd "$agent"

has_files() {
  # true if any path matching the given find expression exists
  find . \( -path ./node_modules -o -path ./.venv -o -path ./venv \) -prune \
    -o "$@" -print 2>/dev/null | grep -q .
}

if [[ -f package.json ]]; then
  # Decide what to run before installing, so no-test agents skip cheaply.
  if jq -e '.scripts."test:unit"' package.json >/dev/null 2>&1; then
    run=(bun run test:unit)
  elif jq -e '.scripts.test' package.json >/dev/null 2>&1; then
    run=(bun run test)
  elif has_files -name '*.test.ts'; then
    run=(bun test)
  else
    echo "no unit tests for $agent — skipping"
    exit 0
  fi

  if ! command -v bun >/dev/null 2>&1; then
    echo "::error::bun not installed"
    exit 1
  fi
  [[ "${SKIP_INSTALL:-0}" == "1" ]] || bun install --frozen-lockfile

  echo "==> ${run[*]} ($agent)"
  "${run[@]}"

elif [[ -f requirements.txt || -f pyproject.toml ]]; then
  if ! has_files \( -name 'test_*.py' -o -name '*_test.py' \); then
    echo "no unit tests for $agent — skipping"
    exit 0
  fi

  py="$(command -v python3 || command -v python || true)"
  if [[ -z "$py" ]]; then
    echo "::error::python not installed"
    exit 1
  fi
  if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
    [[ -f requirements.txt ]] && "$py" -m pip install -r requirements.txt
    "$py" -m pip install pytest
  fi

  echo "==> $py -m pytest ($agent)"
  "$py" -m pytest

else
  echo "::error::$agent has no package.json, requirements.txt, or pyproject.toml"
  exit 1
fi
