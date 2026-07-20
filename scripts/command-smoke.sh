#!/bin/sh
# Command-contract smoke for a compiled workos binary.
#
# Asserts the non-TTY contract documented in CLAUDE.md against real command
# executions: exit codes (0 success, 1 error, 4 auth required), structured
# JSON errors on stderr, and JSON output on stdout. Everything here is
# offline-safe — CI runs it inside a --network none container, and release
# smoke runs it on native hardware for every platform binary. Exit code 2
# (cancelled) needs an interactive session and is covered by unit tests.
#
# POSIX sh only: this runs in debian-slim and Alpine containers (no bash)
# and under Git Bash on the Windows runners.
#
# When WORKOS_API_KEY is provided, an authenticated section also runs: list
# plus a create → get → delete round-trip against that environment. CI passes
# a dedicated staging-environment key; fork PRs receive no secrets and skip
# it. The offline contract checks always run with the key withheld, so the
# exit-4 assertion stays deterministic.
#
# Usage: [WORKOS_API_KEY=sk_...] sh command-smoke.sh /path/to/workos
set -u

BIN="$1"
fails=0

pass() { echo "  ok: $1"; }
fail() {
  echo "FAIL: $1"
  fails=$((fails + 1))
}

# Sandbox the config/home so host auth state can never leak in; the Windows
# binary reads USERPROFILE, which needs a Windows-style path under Git Bash.
SANDBOX=$(mktemp -d)
if command -v cygpath >/dev/null 2>&1; then
  USERPROFILE=$(cygpath -w "$SANDBOX")
else
  USERPROFILE="$SANDBOX"
fi
export USERPROFILE
export HOME="$SANDBOX"
export WORKOS_TELEMETRY=false

# Withhold the key from the offline contract checks; the authenticated
# section reinjects it per command.
SMOKE_API_KEY="${WORKOS_API_KEY:-}"
unset WORKOS_API_KEY

ORG_ID=""
org_deleted=1
cleanup() {
  # Never orphan the round-trip organization in the shared staging
  # environment, even when a check between create and delete fails.
  if [ -n "$ORG_ID" ] && [ "$org_deleted" -eq 0 ]; then
    WORKOS_API_KEY="$SMOKE_API_KEY" "$BIN" organization delete "$ORG_ID" --insecure-storage >/dev/null 2>&1 || true
  fi
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

out=$("$BIN" --version 2>/dev/null)
code=$?
if [ "$code" -eq 0 ] && [ -n "$out" ]; then pass "--version prints a version ($out)"; else fail "--version (exit $code)"; fi

"$BIN" --help >/dev/null 2>&1
code=$?
if [ "$code" -eq 0 ]; then pass "--help exits 0"; else fail "--help (exit $code)"; fi

out=$("$BIN" auth status --json --insecure-storage 2>/dev/null)
code=$?
case "$out" in
  *'"authenticated"'*) json_ok=1 ;;
  *) json_ok=0 ;;
esac
if [ "$code" -eq 0 ] && [ "$json_ok" -eq 1 ]; then pass "auth status --json reports state, exit 0"; else fail "auth status --json (exit $code): $out"; fi

out=$("$BIN" skills list --json 2>/dev/null)
code=$?
case "$out" in
  '['* | '{'*) json_ok=1 ;;
  *) json_ok=0 ;;
esac
if [ "$code" -eq 0 ] && [ "$json_ok" -eq 1 ]; then pass "skills list --json emits JSON, exit 0"; else fail "skills list --json (exit $code)"; fi

out=$("$BIN" api ls users --json 2>/dev/null)
code=$?
case "$out" in
  *'"data"'*) json_ok=1 ;;
  *) json_ok=0 ;;
esac
if [ "$code" -eq 0 ] && [ "$json_ok" -eq 1 ]; then pass "api ls users --json lists endpoints from the embedded spec, exit 0"; else fail "api ls users --json (exit $code)"; fi

# Auth-required commands must exit 4 with a structured JSON error on stderr —
# the contract agents and CI pipelines depend on (gh CLI convention).
err=$("$BIN" organization list --json --insecure-storage 2>&1 >/dev/null)
code=$?
case "$err" in
  *'"error"'*'"code"'*) json_ok=1 ;;
  *) json_ok=0 ;;
esac
if [ "$code" -eq 4 ] && [ "$json_ok" -eq 1 ]; then pass "unauthenticated organization list exits 4 with structured error"; else fail "organization list contract (exit $code, want 4): $err"; fi

err=$("$BIN" definitely-not-a-command 2>&1 >/dev/null)
code=$?
case "$err" in
  *'"error"'*) json_ok=1 ;;
  *) json_ok=0 ;;
esac
if [ "$code" -eq 1 ] && [ "$json_ok" -eq 1 ]; then pass "unknown command exits 1 with structured error"; else fail "unknown command contract (exit $code, want 1): $err"; fi

# ---- Authenticated commands (opt-in via WORKOS_API_KEY) ----
if [ -n "$SMOKE_API_KEY" ]; then
  out=$(WORKOS_API_KEY="$SMOKE_API_KEY" "$BIN" organization list --json --insecure-storage 2>/dev/null)
  code=$?
  case "$out" in
    *'"data"'*) json_ok=1 ;;
    *) json_ok=0 ;;
  esac
  if [ "$code" -eq 0 ] && [ "$json_ok" -eq 1 ]; then pass "authenticated organization list exits 0 with data"; else fail "authenticated organization list (exit $code)"; fi

  ORG_NAME="cli-smoke-$$-$(date +%s)"
  out=$(WORKOS_API_KEY="$SMOKE_API_KEY" "$BIN" organization create "$ORG_NAME" --json --insecure-storage 2>/dev/null)
  code=$?
  # Org ids are org_<alphanumeric>; the closing-quote anchor keeps nested
  # org_domain_* ids from matching.
  ORG_ID=$(printf '%s' "$out" | sed -n 's/.*"id":"\(org_[A-Za-z0-9]*\)".*/\1/p')
  if [ "$code" -eq 0 ] && [ -n "$ORG_ID" ]; then
    org_deleted=0
    pass "organization create returns an id ($ORG_ID)"
  else
    fail "organization create (exit $code): $out"
  fi

  if [ -n "$ORG_ID" ]; then
    out=$(WORKOS_API_KEY="$SMOKE_API_KEY" "$BIN" organization get "$ORG_ID" --json --insecure-storage 2>/dev/null)
    code=$?
    case "$out" in
      *"$ORG_NAME"*) json_ok=1 ;;
      *) json_ok=0 ;;
    esac
    if [ "$code" -eq 0 ] && [ "$json_ok" -eq 1 ]; then pass "organization get returns the created organization"; else fail "organization get (exit $code)"; fi

    WORKOS_API_KEY="$SMOKE_API_KEY" "$BIN" organization delete "$ORG_ID" --json --insecure-storage >/dev/null 2>&1
    code=$?
    if [ "$code" -eq 0 ]; then
      org_deleted=1
      pass "organization delete cleans up"
    else
      fail "organization delete (exit $code) — cleanup trap will retry"
    fi
  fi
else
  echo "  (authenticated checks skipped: WORKOS_API_KEY not set)"
fi

if [ "$fails" -gt 0 ]; then
  echo "command-smoke: $fails check(s) failed"
  exit 1
fi
echo "command-smoke: all checks passed"
