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
# Usage: sh command-smoke.sh /path/to/workos
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
trap 'rm -rf "$SANDBOX"' EXIT

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

if [ "$fails" -gt 0 ]; then
  echo "command-smoke: $fails check(s) failed"
  exit 1
fi
echo "command-smoke: all checks passed"
