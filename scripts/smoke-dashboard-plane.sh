#!/usr/bin/env bash
# Live smoke test for the dashboard-plane resource commands (organization, user,
# role, permission, membership, invitation, session, event, feature-flag,
# org-domain, portal, webhook, config) against the real WorkOS API.
#
# Prereq: `workos auth login` (device flow) with the environment you want to
# target set as the active env. Then:
#
#   ./scripts/smoke-dashboard-plane.sh                    # read-only (safe)
#   ./scripts/smoke-dashboard-plane.sh --mutate           # + CRUD round-trips in a disposable org
#   ./scripts/smoke-dashboard-plane.sh --config-writes    # + config redirect/cors add (snapshot & restore)
#   ./scripts/smoke-dashboard-plane.sh --branding-writes  # + branding image upload (multipart; see below)
#   ./scripts/smoke-dashboard-plane.sh --keep             # don't clean up created resources
#
# --branding-writes is the only tier that uploads files. It exercises the
# GraphQL multipart transport, which is what an MCP client cannot do. It
# REPLACES the environment's real logo/icon/favicon with generated test images
# and CANNOT restore them: the API returns asset paths, not the original bytes,
# and there is no re-upload-from-URL operation. Run it on a sandbox environment
# you do not mind re-branding.
#
# Env overrides:
#   WORKOS_BIN              command to invoke the CLI (default: node <repo>/dist/bin.js)
#   SMOKE_EVENT_TYPES       comma-separated event types for `event list` (default: user.created)
#   SMOKE_BRANDING_ENV_ID   environment for --branding-writes (default: the active one).
#                           Point this at a throwaway environment so the tier
#                           never rebrands anything you care about. Creating one:
#                           `workos project create scratch --yes` gives a fresh
#                           project whose environments start with no branding.
#
# Exit code: 0 if every executed test passed, 1 otherwise.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUTATE=0 CONFIG_WRITES=0 BRANDING_WRITES=0 KEEP=0
for a in "$@"; do
  case "$a" in
    --mutate) MUTATE=1 ;;
    --config-writes) CONFIG_WRITES=1 ;;
    --branding-writes) BRANDING_WRITES=1 ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $a (see --help)"; exit 2 ;;
  esac
done

if [ -n "${WORKOS_BIN:-}" ]; then
  # shellcheck disable=SC2206
  BIN=($WORKOS_BIN)
else
  [ -f "$REPO/dist/bin.js" ] || { echo "dist/bin.js not found — run: pnpm build"; exit 1; }
  BIN=(node "$REPO/dist/bin.js")
fi

# The migrated commands must run on the OAuth token alone; surface any REST
# leftovers by removing the API-key plane from the environment entirely.
if [ -n "${WORKOS_API_KEY:-}" ]; then
  echo "note: WORKOS_API_KEY is set — unsetting it for this run (migrated commands must not need it)"
  unset WORKOS_API_KEY
fi
unset WORKOS_FORCE_TTY 2>/dev/null || true

WORK="$(mktemp -d "${TMPDIR:-/tmp}/workos-smoke.XXXXXX")"
c_g=$'\033[32m' c_r=$'\033[31m' c_y=$'\033[33m' c_d=$'\033[2m' c_0=$'\033[0m'
N=0 NPASS=0 NFAIL=0 NSKIP=0
FAILURES=()
LAST=""

say() { printf '\n%s\n' "$1"; }

# t <label> <cmd...>: expects exit 0 AND valid JSON on stdout; sets $LAST to the output file.
t() {
  local label="$1"; shift
  N=$((N+1)); LAST=""
  local out="$WORK/$N.out" err="$WORK/$N.err" rc=0
  "$@" >"$out" 2>"$err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    NFAIL=$((NFAIL+1)); FAILURES+=("$label")
    printf '  %sFAIL%s  %s  %s(exit %d)%s\n' "$c_r" "$c_0" "$label" "$c_d" "$rc" "$c_0"
    head -4 "$err" | sed 's/^/          /'
    return 1
  fi
  if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$out" 2>/dev/null; then
    NFAIL=$((NFAIL+1)); FAILURES+=("$label")
    printf '  %sFAIL%s  %s  %s(exit 0 but stdout is not JSON)%s\n' "$c_r" "$c_0" "$label" "$c_d" "$c_0"
    head -4 "$out" | sed 's/^/          /'
    return 1
  fi
  NPASS=$((NPASS+1))
  printf '  %sok%s    %s\n' "$c_g" "$c_0" "$label"
  LAST="$out"
}

# t_refuse <label> <cmd...>: negative test — the command MUST exit nonzero.
t_refuse() {
  local label="$1"; shift
  N=$((N+1))
  local rc=0
  "$@" >"$WORK/$N.out" 2>"$WORK/$N.err" || rc=$?
  if [ "$rc" -eq 0 ]; then
    NFAIL=$((NFAIL+1)); FAILURES+=("$label")
    printf '  %sFAIL%s  %s  %s(expected a refusal, got exit 0)%s\n' "$c_r" "$c_0" "$label" "$c_d" "$c_0"
    return 1
  fi
  NPASS=$((NPASS+1))
  printf '  %sok%s    %s  %s(refused, exit %d)%s\n' "$c_g" "$c_0" "$label" "$c_d" "$rc" "$c_0"
}

skip() { NSKIP=$((NSKIP+1)); printf '  %sskip%s  %s  %s(%s)%s\n' "$c_y" "$c_0" "$1" "$c_d" "$2" "$c_0"; }

# jget <file> <dot.path>: prints the value at path; exits 1 if absent.
jget() {
  node -e '
    const [f, p] = process.argv.slice(1);
    let v; try { v = JSON.parse(require("fs").readFileSync(f, "utf8")); } catch { process.exit(1); }
    for (const k of p.split(".")) { if (v == null) process.exit(1); v = v[/^\d+$/.test(k) ? Number(k) : k]; }
    if (v === undefined || v === null) process.exit(1);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
  ' "$1" "$2" 2>/dev/null
}

# ---------------------------------------------------------------- preflight
rc=0
"${BIN[@]}" whoami --json >"$WORK/whoami.json" 2>"$WORK/whoami.err" || rc=$?
if [ "$rc" -ne 0 ]; then
  echo "whoami failed (exit $rc):"
  head -6 "$WORK/whoami.err" | sed 's/^/  /'
  if [ "$rc" -eq 4 ]; then
    echo "Not logged in — run: workos auth login"
  elif grep -q environment_unresolved "$WORK/whoami.err" 2>/dev/null; then
    echo "The active env profile could not be mapped to a dashboard environment."
    echo "Switch to an environment that is claimed by your team: workos env switch"
  fi
  exit 1
fi
EMAIL="$(jget "$WORK/whoami.json" user.email || echo '?')"
TEAM="$(jget "$WORK/whoami.json" team.name || echo '?')"
ENV_ID="$(jget "$WORK/whoami.json" environment.id || echo '')"
ENV_NAME="$(jget "$WORK/whoami.json" environment.name || echo '?')"

echo "workos dashboard-plane smoke test"
echo "  bin:         ${BIN[*]}"
echo "  user:        $EMAIL  (team: $TEAM)"
echo "  environment: $ENV_NAME  ${ENV_ID:-<unresolved>}"
echo "  tiers:       reads$( [ $MUTATE -eq 1 ] && printf ' + mutate' )$( [ $CONFIG_WRITES -eq 1 ] && printf ' + config-writes' )$( [ $BRANDING_WRITES -eq 1 ] && printf ' + branding-writes' )"
echo "  raw output:  $WORK"
if [ -z "$ENV_ID" ]; then
  echo "could not resolve the active environment from whoami — aborting"
  exit 1
fi

# ------------------------------------------------------------------- reads
say "— reads —"
t "organization list"            "${BIN[@]}" organization list --json
ORG_ID="$(jget "$LAST" organizations.0.id || true)"
t "user list"                    "${BIN[@]}" user list --json
USER_ID="$(jget "$LAST" users.0.id || true)"
t "role list"                    "${BIN[@]}" role list --json
ROLE_SLUG="$(jget "$LAST" roles.0.slug || true)"
t "permission list"              "${BIN[@]}" permission list --json
PERM_SLUG="$(jget "$LAST" permissions.0.slug || true)"
t "invitation list"              "${BIN[@]}" invitation list --json
INV_ID="$(jget "$LAST" invitations.0.id || true)"
t "feature-flag list"            "${BIN[@]}" feature-flag list --json
FLAG_SLUG="$(jget "$LAST" flags.0.slug || true)"
t "webhook list"                 "${BIN[@]}" webhook list --json
t "event list"                   "${BIN[@]}" event list --events "${SMOKE_EVENT_TYPES:-user.created}" --limit 5 --json
t "authkit branding get"         "${BIN[@]}" authkit branding get --json

if [ -n "$ORG_ID" ]; then
  t "organization get"           "${BIN[@]}" organization get "$ORG_ID" --json
  DOMAIN_ID="$(jget "$LAST" organization.domains.0.id || true)"
  t "membership list --org"      "${BIN[@]}" membership list --org "$ORG_ID" --json
else
  skip "organization get / membership list" "no organizations in this environment"
  DOMAIN_ID=""
fi
if [ -n "$USER_ID" ]; then
  t "user get"                   "${BIN[@]}" user get "$USER_ID" --json
  t "session list <user>"        "${BIN[@]}" session list "$USER_ID" --json
  t "membership list --user"     "${BIN[@]}" membership list --user "$USER_ID" --json
else
  skip "user get / session list / membership list --user" "no users in this environment"
fi
if [ -n "$ROLE_SLUG" ]; then t "role get" "${BIN[@]}" role get "$ROLE_SLUG" --json; else skip "role get" "no roles"; fi
if [ -n "$PERM_SLUG" ]; then t "permission get" "${BIN[@]}" permission get "$PERM_SLUG" --json; else skip "permission get" "no permissions"; fi
if [ -n "$FLAG_SLUG" ]; then t "feature-flag get" "${BIN[@]}" feature-flag get "$FLAG_SLUG" --json; else skip "feature-flag get" "no feature flags"; fi
if [ -n "$INV_ID" ]; then t "invitation get" "${BIN[@]}" invitation get "$INV_ID" --json; else skip "invitation get" "no invitations"; fi
if [ -n "$DOMAIN_ID" ]; then t "org-domain get" "${BIN[@]}" org-domain get "$DOMAIN_ID" --json; else skip "org-domain get" "no org domains visible; covered by --mutate"; fi

# ------------------------------------------------- environment targeting
say "— environment targeting —"
t        "explicit --environment-id matches active env" "${BIN[@]}" organization list --environment-id "$ENV_ID" --json
EXPLICIT_FIRST="$(jget "$LAST" organizations.0.id || true)"
if [ -n "$ORG_ID" ] && [ "$EXPLICIT_FIRST" != "$ORG_ID" ]; then
  echo "          ${c_y}warning:${c_0} implicit and explicit env targeting returned different first orgs ($ORG_ID vs $EXPLICIT_FIRST)"
fi
t_refuse "bogus --environment-id refused (no silent prod fallback)" "${BIN[@]}" organization list --environment-id env_smoke_bogus_0000 --json

# ----------------------------------------------------------------- mutate
CREATED_ORG="" CREATED_WEBHOOK="" CREATED_ROLE="" CREATED_PERM="" CREATED_MEMBERSHIP="" CREATED_INV="" CREATED_DOMAIN=""
cleanup() {
  [ "$KEEP" -eq 1 ] && { echo "(--keep: leftovers not removed: org=$CREATED_ORG webhook=$CREATED_WEBHOOK)"; return; }
  # Safety net only — the happy path deletes everything inline as tests.
  [ -n "$CREATED_WEBHOOK" ]    && "${BIN[@]}" webhook delete "$CREATED_WEBHOOK" --yes --json >/dev/null 2>&1 && echo "cleanup: removed leftover webhook $CREATED_WEBHOOK"
  [ -n "$CREATED_INV" ]        && "${BIN[@]}" invitation revoke "$CREATED_INV" --yes --json >/dev/null 2>&1 && echo "cleanup: revoked leftover invitation $CREATED_INV"
  [ -n "$CREATED_MEMBERSHIP" ] && "${BIN[@]}" membership delete "$CREATED_MEMBERSHIP" --yes --json >/dev/null 2>&1 && echo "cleanup: removed leftover membership $CREATED_MEMBERSHIP"
  [ -n "$CREATED_ROLE" ]       && "${BIN[@]}" role delete "$CREATED_ROLE" --org "$CREATED_ORG" --yes --json >/dev/null 2>&1 && echo "cleanup: removed leftover role $CREATED_ROLE"
  [ -n "$CREATED_PERM" ]       && "${BIN[@]}" permission delete "$CREATED_PERM" --yes --json >/dev/null 2>&1 && echo "cleanup: removed leftover permission $CREATED_PERM"
  [ -n "$CREATED_DOMAIN" ]     && "${BIN[@]}" org-domain delete "$CREATED_DOMAIN" --yes --json >/dev/null 2>&1 && echo "cleanup: removed leftover domain $CREATED_DOMAIN"
  [ -n "$CREATED_ORG" ]        && "${BIN[@]}" organization delete "$CREATED_ORG" --yes --json >/dev/null 2>&1 && echo "cleanup: removed leftover org $CREATED_ORG"
}
trap cleanup EXIT

if [ "$MUTATE" -eq 1 ]; then
  TS="$(date +%s)"
  say "— mutations (disposable org cli-smoke-$TS) —"

  if t "organization create" "${BIN[@]}" organization create "cli-smoke-$TS" --json; then
    CREATED_ORG="$(jget "$LAST" organization.id)"
    t "organization update" "${BIN[@]}" organization update "$CREATED_ORG" "cli-smoke-$TS-renamed" --json

    # org-domain round trip
    if t "org-domain create" "${BIN[@]}" org-domain create "cli-smoke-$TS.example.com" --org "$CREATED_ORG" --json; then
      CREATED_DOMAIN="$(jget "$LAST" domain.id)"
      t "org-domain get (created)" "${BIN[@]}" org-domain get "$CREATED_DOMAIN" --json
      t "org-domain verify (restart verification)" "${BIN[@]}" org-domain verify "$CREATED_DOMAIN" --json
      t "org-domain delete" "${BIN[@]}" org-domain delete "$CREATED_DOMAIN" --yes --json && CREATED_DOMAIN=""
    fi

    # role + permission round trip (org-scoped role so it is deletable)
    if t "permission create" "${BIN[@]}" permission create --slug "smoke-$TS-perm" --name "Smoke Perm $TS" --yes --json; then
      CREATED_PERM="smoke-$TS-perm"
    fi
    # org-scoped role slugs must be prefixed "org-" (server-side rule)
    if t "role create (org-scoped)" "${BIN[@]}" role create --slug "org-smoke-$TS" --name "Smoke Role $TS" --org "$CREATED_ORG" --yes --json; then
      CREATED_ROLE="org-smoke-$TS"
      t "role get (created)" "${BIN[@]}" role get "$CREATED_ROLE" --org "$CREATED_ORG" --json
      t "role update" "${BIN[@]}" role update "$CREATED_ROLE" --name "Smoke Role $TS v2" --org "$CREATED_ORG" --yes --json
      if [ -n "$CREATED_PERM" ]; then
        t "role add-permission" "${BIN[@]}" role add-permission "$CREATED_ROLE" "$CREATED_PERM" --org "$CREATED_ORG" --yes --json
        t "role remove-permission" "${BIN[@]}" role remove-permission "$CREATED_ROLE" "$CREATED_PERM" --org "$CREATED_ORG" --yes --json
      fi
      t "role delete" "${BIN[@]}" role delete "$CREATED_ROLE" --org "$CREATED_ORG" --yes --json && CREATED_ROLE=""
    fi
    if [ -n "$CREATED_PERM" ]; then
      t "permission delete" "${BIN[@]}" permission delete "$CREATED_PERM" --yes --json && CREATED_PERM=""
    fi

    # membership round trip (adds an EXISTING user to the disposable org, then removes)
    if [ -n "$USER_ID" ]; then
      if t "membership create" "${BIN[@]}" membership create --org "$CREATED_ORG" --user "$USER_ID" --json; then
        t "membership list (find created)" "${BIN[@]}" membership list --org "$CREATED_ORG" --json
        CREATED_MEMBERSHIP="$(jget "$LAST" memberships.0.id || true)"
        if [ -n "$CREATED_MEMBERSHIP" ]; then
          t "membership get" "${BIN[@]}" membership get "$CREATED_MEMBERSHIP" --json
          t "membership deactivate" "${BIN[@]}" membership deactivate "$CREATED_MEMBERSHIP" --yes --json
          t "membership reactivate" "${BIN[@]}" membership reactivate "$CREATED_MEMBERSHIP" --json
          t "membership delete" "${BIN[@]}" membership delete "$CREATED_MEMBERSHIP" --yes --json && CREATED_MEMBERSHIP=""
        fi
      fi
    else
      skip "membership create/deactivate/reactivate/delete" "no existing user to enroll"
    fi

    # invitation round trip (example.com is a reserved, blackholed domain)
    if t "invitation send" "${BIN[@]}" invitation send --email "cli-smoke-$TS@example.com" --org "$CREATED_ORG" --json; then
      CREATED_INV="$(jget "$LAST" invitation.id)"
      t "invitation get (created)" "${BIN[@]}" invitation get "$CREATED_INV" --json
      t "invitation revoke" "${BIN[@]}" invitation revoke "$CREATED_INV" --yes --json && CREATED_INV=""
    fi

    # webhook round trip
    if t "webhook create" "${BIN[@]}" webhook create --url "https://example.com/cli-smoke-$TS" --events "${SMOKE_EVENT_TYPES:-user.created}" --json; then
      CREATED_WEBHOOK="$(jget "$LAST" webhookEndpoint.id)"
      t "webhook delete" "${BIN[@]}" webhook delete "$CREATED_WEBHOOK" --yes --json && CREATED_WEBHOOK=""
    fi

    t "portal generate-link (sso)" "${BIN[@]}" portal generate-link --intent sso --org "$CREATED_ORG" --json

    t "organization delete" "${BIN[@]}" organization delete "$CREATED_ORG" --yes --json && CREATED_ORG=""
  fi

  say "— mutations intentionally NOT exercised —"
  skip "feature-flag enable/disable/targets" "would flip real flags; no create op exists — test manually on a scratch flag"
  skip "user update/delete" "no user create in the CLI; would mutate real users"
  skip "session revoke" "would kill a real session"
  skip "invitation resend" "would send another email"
fi

# ---------------------------------------------------------- config writes
if [ "$CONFIG_WRITES" -eq 1 ]; then
  TS="${TS:-$(date +%s)}"
  say "— config writes (snapshot & restore on the ACTIVE env's AuthKit app) —"

  # redirect: config redirect add merges over the list; restore via authkit redirect-uris set
  if t "authkit redirect-uris list (snapshot)" "${BIN[@]}" authkit redirect-uris list --json; then
    SNAP="$LAST"
    BEFORE_URIS=()
    while IFS= read -r u; do [ -n "$u" ] && BEFORE_URIS+=("$u"); done < <(node -e '
      const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      for (const e of d.redirectUris ?? []) console.log(typeof e === "string" ? e : e.uri);
    ' "$SNAP")
    DEFAULT_URI="$(node -e '
      const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const e = (d.redirectUris ?? []).find(x => x && x.isDefault);
      if (e) process.stdout.write(e.uri);
    ' "$SNAP")"
    if [ "${#BEFORE_URIS[@]}" -eq 0 ]; then
      skip "config redirect add" "current redirect-uri list is empty; cannot restore afterwards"
    else
      SMOKE_URI="https://cli-smoke-$TS.example.com/callback"
      t "config redirect add" "${BIN[@]}" config redirect add "$SMOKE_URI" --json
      RESTORE=()
      for u in "${BEFORE_URIS[@]}"; do RESTORE+=(--uri "$u"); done
      [ -n "$DEFAULT_URI" ] && RESTORE+=(--default "$DEFAULT_URI")
      t "restore redirect uris" "${BIN[@]}" authkit redirect-uris set "${RESTORE[@]}" --json
    fi
  fi

  # cors: same pattern
  if t "authkit cors get (snapshot)" "${BIN[@]}" authkit cors get --json; then
    SNAP="$LAST"
    BEFORE_ORIGINS=()
    while IFS= read -r o; do [ -n "$o" ] && BEFORE_ORIGINS+=("$o"); done < <(node -e '
      const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      for (const e of d.origins ?? []) console.log(typeof e === "string" ? e : e.origin);
    ' "$SNAP")
    if [ "${#BEFORE_ORIGINS[@]}" -eq 0 ]; then
      skip "config cors add" "current CORS list is empty; cannot restore afterwards"
    else
      t "config cors add" "${BIN[@]}" config cors add "https://cli-smoke-$TS.example.com" --json
      RESTORE=()
      for o in "${BEFORE_ORIGINS[@]}"; do RESTORE+=(--origin "$o"); done
      t "restore cors origins" "${BIN[@]}" authkit cors set "${RESTORE[@]}" --json
    fi
  fi

  skip "config homepage-url set" "no read-back exists to restore the current value — test manually"
fi

# -------------------------------------------------------- branding writes
# The multipart (`Upload`) path. Everything else in this script is a JSON
# request; this tier is the only coverage of the transport that lets a CLI set
# branding images at all — the reason this exists rather than living in the MCP
# server, which cannot carry file bytes over JSON tool arguments.
#
# The negative cases run first and cost nothing: they must be refused locally,
# before any upload. The positive case then uploads and proves the write landed
# by watching the stored asset paths change (each upload gets a fresh ULID
# filename, so a changed path means new bytes were actually stored).
if [ "$BRANDING_WRITES" -eq 1 ]; then
  # An explicit target keeps the one destructive tier off whatever environment
  # happens to be active.
  BR_ENV=()
  if [ -n "${SMOKE_BRANDING_ENV_ID:-}" ]; then
    BR_ENV=(--environment-id "$SMOKE_BRANDING_ENV_ID")
    say "— branding writes (uploads REAL images to $SMOKE_BRANDING_ENV_ID; not restorable) —"
  else
    say "— branding writes (uploads REAL images to the ACTIVE env $ENV_NAME; not restorable) —"
  fi

  IMG_DIR="$WORK/branding"
  mkdir -p "$IMG_DIR"
  # A genuine 1x1 PNG, so the server sees real image bytes rather than padding.
  node -e '
    const fs = require("fs");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    for (const name of ["logo.png", "icon.png", "favicon.png"]) {
      fs.writeFileSync(`${process.argv[1]}/${name}`, png);
    }
    // 400KB is the server cap; one byte over must be refused client-side.
    fs.writeFileSync(`${process.argv[1]}/too-big.png`, Buffer.alloc(400 * 1024 + 1, 1));
    fs.writeFileSync(`${process.argv[1]}/logo.bmp`, png);
  ' "$IMG_DIR"

  t_refuse "branding set with no images refused"      "${BIN[@]}" authkit branding set ${BR_ENV[@]+"${BR_ENV[@]}"} --json
  t_refuse "branding set rejects oversized image"     "${BIN[@]}" authkit branding set ${BR_ENV[@]+"${BR_ENV[@]}"} --logo "$IMG_DIR/too-big.png" --json
  t_refuse "branding set rejects unsupported type"    "${BIN[@]}" authkit branding set ${BR_ENV[@]+"${BR_ENV[@]}"} --logo "$IMG_DIR/logo.bmp" --json
  t_refuse "branding set rejects a missing file"      "${BIN[@]}" authkit branding set ${BR_ENV[@]+"${BR_ENV[@]}"} --logo "$IMG_DIR/nope.png" --json
  t_refuse "branding set refuses a bogus environment" "${BIN[@]}" authkit branding set --logo "$IMG_DIR/logo.png" --environment-id env_smoke_bogus_0000 --json

  if t "branding get (snapshot before upload)" "${BIN[@]}" authkit branding get ${BR_ENV[@]+"${BR_ENV[@]}"} --json; then
    BEFORE_LOGO="$(jget "$LAST" branding.lightLogoPath || echo '')"
    BEFORE_ICON="$(jget "$LAST" branding.lightLogoIconPath || echo '')"
    BEFORE_FAVICON="$(jget "$LAST" branding.lightFaviconPath || echo '')"

    if t "branding set (logo + icon + favicon, multipart upload)" \
      "${BIN[@]}" authkit branding set ${BR_ENV[@]+"${BR_ENV[@]}"} \
        --logo "$IMG_DIR/logo.png" \
        --icon "$IMG_DIR/icon.png" \
        --favicon "$IMG_DIR/favicon.png" \
        --json; then
      UPLOADED_COUNT="$(node -e '
        const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write(String((d.uploaded ?? []).length));
      ' "$LAST")"
      if [ "$UPLOADED_COUNT" != "3" ]; then
        echo "          ${c_y}warning:${c_0} expected 3 uploaded assets, got $UPLOADED_COUNT"
      fi

      # Read back: the stored paths must differ from the snapshot, which is
      # what proves the bytes reached S3 rather than the mutation merely
      # returning success.
      if t "branding get (read back after upload)" "${BIN[@]}" authkit branding get ${BR_ENV[@]+"${BR_ENV[@]}"} --json; then
        AFTER_LOGO="$(jget "$LAST" branding.lightLogoPath || echo '')"
        AFTER_ICON="$(jget "$LAST" branding.lightLogoIconPath || echo '')"
        AFTER_FAVICON="$(jget "$LAST" branding.lightFaviconPath || echo '')"

        for pair in "logo:$BEFORE_LOGO:$AFTER_LOGO" "icon:$BEFORE_ICON:$AFTER_ICON" "favicon:$BEFORE_FAVICON:$AFTER_FAVICON"; do
          label="${pair%%:*}"; rest="${pair#*:}"; before="${rest%%:*}"; after="${rest#*:}"
          N=$((N+1))
          if [ -n "$after" ] && [ "$before" != "$after" ]; then
            NPASS=$((NPASS+1))
            printf '  %sok%s    %s path changed after upload  %s(%s)%s\n' "$c_g" "$c_0" "$label" "$c_d" "$after" "$c_0"
          else
            NFAIL=$((NFAIL+1)); FAILURES+=("$label path unchanged after upload")
            printf '  %sFAIL%s  %s path unchanged after upload  %s(before=%s after=%s)%s\n' \
              "$c_r" "$c_0" "$label" "$c_d" "${before:-<unset>}" "${after:-<unset>}" "$c_0"
          fi
        done
      fi
    fi
  fi

  skip "restore previous branding images" "the API exposes asset paths, not the original bytes — re-upload manually if needed"
fi

# ---------------------------------------------------------------- summary
say "──────────────────────────────────────────────"
printf 'passed %s%d%s   failed %s%d%s   skipped %s%d%s\n' "$c_g" "$NPASS" "$c_0" "$c_r" "$NFAIL" "$c_0" "$c_y" "$NSKIP" "$c_0"
if [ "$NFAIL" -gt 0 ]; then
  echo "failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  echo "raw stdout/stderr for every test: $WORK"
  exit 1
fi
echo "raw stdout/stderr for every test: $WORK"
echo "not covered here: still-REST commands (connection, directory, api-key, audit-log, vault) and 'workos api' — those stay on WORKOS_API_KEY by design."
