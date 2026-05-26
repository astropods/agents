#!/usr/bin/env bash
#
# Run all consistency checks for one agent directory:
#   - required files (astropods.yml, AGENT.md, README.md)
#   - ast spec validate
#   - TypeScript: biome check + tsc --noEmit
#   - Python:     ruff check + ruff format --check
#
# Environment:
#   SKIP_INSTALL=1    skip `bun install` (useful in pre-commit, where deps
#                     are assumed present)
#   SKIP_TYPECHECK=1  skip `tsc --noEmit`

set -uo pipefail

agent="${1:?usage: $0 <agent-dir>}"
agent="${agent%/}"

if [[ ! -d "$agent" ]]; then
  echo "::error::$agent is not a directory"
  exit 1
fi

if [[ ! -f "$agent/astropods.yml" ]]; then
  echo "::error::$agent has no astropods.yml — not an agent, or missing spec"
  exit 1
fi

fail=0
report() {
  local result="$1"; local label="$2"
  case "$result" in
    pass) printf '  ✓ %s\n' "$label" ;;
    warn) printf '  ! %s\n' "$label" ;;
    fail) printf '  ✗ %s\n' "$label"; fail=1 ;;
  esac
}

run() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    report pass "$label"
  else
    report fail "$label"
    "$@" || true  # re-run to surface the error output
  fi
}

# --- required docs -----------------------------------------------------------
for f in AGENT.md README.md; do
  [[ -f "$agent/$f" ]] && report pass "$f present" || report fail "$f missing"
done

# --- ast spec validate -------------------------------------------------------
if command -v ast >/dev/null 2>&1; then
  if (cd "$agent" && ast spec validate >/dev/null 2>&1); then
    report pass "ast spec validate"
  else
    report fail "ast spec validate"
    (cd "$agent" && ast spec validate) || true
  fi
else
  report warn "ast CLI not installed — skipping spec validation"
  echo "    install with: curl -fsSL https://astropods.com/install | sh"
  echo "    docs: https://docs.astropods.com"
fi

# --- language-specific -------------------------------------------------------
if [[ -f "$agent/package.json" ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    report fail "bun not installed"
  else
    if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
      (cd "$agent" && bun install --frozen-lockfile >/dev/null 2>&1) \
        && report pass "bun install" \
        || report fail "bun install"
    fi
    (cd "$agent" && bun run lint >/dev/null 2>&1) \
      && report pass "biome check" \
      || { report fail "biome check"; (cd "$agent" && bun run lint) || true; }
    if [[ "${SKIP_TYPECHECK:-0}" != "1" ]]; then
      (cd "$agent" && bun run typecheck >/dev/null 2>&1) \
        && report pass "tsc --noEmit" \
        || { report fail "tsc --noEmit"; (cd "$agent" && bun run typecheck) || true; }
    fi
  fi
elif [[ -f "$agent/requirements.txt" || -f "$agent/pyproject.toml" ]]; then
  if ! command -v ruff >/dev/null 2>&1; then
    report fail "ruff not installed"
  else
    (cd "$agent" && ruff check . >/dev/null 2>&1) \
      && report pass "ruff check" \
      || { report fail "ruff check"; (cd "$agent" && ruff check .) || true; }
    (cd "$agent" && ruff format --check . >/dev/null 2>&1) \
      && report pass "ruff format --check" \
      || { report fail "ruff format --check"; (cd "$agent" && ruff format --check .) || true; }
  fi
else
  report fail "no package.json, requirements.txt, or pyproject.toml"
fi

exit $fail
