#!/bin/sh
# Read-only credential eligibility check. Never log credentials or API payloads.
set +x
set -eu

report() {
  printf '%s\n' "$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'usable=%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$2" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [ -z "${WORKOS_SMOKE_API_KEY:-}" ]; then
  report false '::warning::Live authenticated checks NOT RUN: WORKOS_SMOKE_API_KEY is missing. Credential/API configuration needs investigation (fork PRs may have no secrets).'
  exit 0
fi

base="${WORKOS_SMOKE_API_URL:-https://api.workos.com}"
curl_exit=0
# -q must be first: ignore curlrc (including redirects, retries and tracing).
# No --location, retries, response headers, body, or curl diagnostics.
status=$(curl -q --silent --connect-timeout 10 --max-time 20 \
  --proto '=http,https' --request GET \
  --header "Authorization: Bearer $WORKOS_SMOKE_API_KEY" \
  --output /dev/null --write-out '%{http_code}' \
  "${base%/}/connections?limit=1" 2>/dev/null) || curl_exit=$?

if [ "$curl_exit" -ne 0 ]; then
  report false '::error::Smoke credential preflight transport failure. Live authenticated checks NOT RUN; investigate credential/API connectivity.'
  exit 1
fi

case "$status" in
  200)
    report true 'Smoke credential preflight HTTP 200: eligible for live authenticated checks; this is not a live smoke pass.'
    ;;
  401)
    report false '::warning::Smoke credential preflight HTTP 401: live authenticated checks NOT RUN. Investigate the CI credential/API configuration; live checks have not passed.'
    ;;
  *)
    report false "::error::Smoke credential preflight HTTP $status (expected 200 or 401). Live authenticated checks NOT RUN; investigate the API response."
    exit 1
    ;;
esac
