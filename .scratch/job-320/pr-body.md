# feat: run resource commands with an API key

> Draft. Suggested title: `feat: run resource commands with an API key (unclaimed environments, WORKOS_API_KEY, --api-key)`

## Why

An agent holding a one-shot environment from `workos env provision` (or the installer) could only use `workos api`. Every resource command (`workos organization`, `workos user`, `workos role`, …) failed with "uses your WorkOS dashboard session and does not accept API keys", because none of them can authenticate before an environment is claimed. Clerk's equivalent commands work before claiming. This PR makes them work with an API key.

## What changed

- **One seam picks the credential.** `resolveEnvScopedAuth()` in `src/lib/dashboard-operation.ts` asks `src/lib/resource-auth.ts` whether an API key applies. If none does, the existing session path runs unchanged: `requireCommandToken()` plus `resolveEnvironmentTarget()`.
- **REST adapters return the dashboard data shape.** On the API-key path, `executeDashboardOperation()` sends each catalog operation to a REST adapter in `src/lib/api-key-operations/`. The adapter calls the WorkOS REST API with the key and returns the same data shape the dashboard operation returns, using only the fields that operation's document selects. Each command's existing `--json` shaper then runs as before, so keys, casing and shapes match by construction. Enum casing goes through the same `enumOut()` on both paths.
- **No REST source means `null`.** A field REST has no source for comes back `null` and is never invented. Each one is listed in `src/lib/api-key-operations/known-gaps.ts`.
- **Missing REST endpoints fail with a structured error.** A command or input with no REST equivalent exits with `{"error":{"code":"api_key_unsupported","message":"…what's missing…"}}` before any write.
- **`--api-key` is now accepted** on the resource command groups. It's the same flag name and the same `resolveOptionalApiKey()` resolution that `workos api` and the still-REST commands use. It's registered in `help-json.ts` too.
- **The copy no longer says resource commands reject API keys.** `authRequiredApiKeySet` and `refreshFailedApiKeySet` are now in practice shown only by the account commands. They say the command manages your dashboard account and needs a login, and that resource commands such as `workos organization` and `workos user` run with the API key. No internal terms appear in the copy (checked against `LEAK_PATTERN`).
- **Docs** (README, CLAUDE.md) describe the new rule.

### Commands gated on the dashboard session, and what each does now

Every command below reached `requireCommandToken()`, either directly or through `runEnvScopedOperation` / `runTeamScopedOperation`.

**Environment-scoped resource commands now run on REST with a key:**

| Command | Subcommands on the API-key path |
| --- | --- |
| `organization` | create, update, get, list, delete |
| `user` | get, list, update, delete |
| `role` | list, get, create, update, delete, set-permissions, add-permission, remove-permission (with or without `--org`) |
| `permission` | list, get, create, update, delete |
| `membership` | list (`--user` / `--org`), get, create, update, delete, deactivate, reactivate |
| `invitation` | list (incl. `--org`), get, send, revoke, resend |
| `session` | list, revoke |
| `event` | list |
| `feature-flag` | list, get, enable, disable, add-target, remove-target |
| `org-domain` | get, create, verify, delete |
| `portal` | generate-link |
| `webhook` | list, create, delete |
| `config` | redirect add, cors add, homepage-url set |
| `authkit` | redirect-uris list/set, cors get/set |

**No REST equivalent, so they fail with `api_key_unsupported` on the key path:**
- `authkit logout-uris list|set`: sign-out redirect URIs have no WorkOS API endpoint.
- `branding get|set`: branding images have no WorkOS API endpoint.

**Account commands, session-only (no REST equivalent; they ignore the key):** `team` (members, invite, change-role, remove, resend-invite, update, set-mfa), `project` (create, rename, list), `environment` (list, use, create, rename), `whoami`.

## Precedence rule

The first match wins:

1. `--api-key <key>`
2. `WORKOS_API_KEY`
3. The active profile's stored key, **only if that profile is an unclaimed environment.** A dashboard session can't reach an unclaimed environment, so its key is the only credential that works there.
4. Otherwise, the existing dashboard-session path, unchanged.

Consequences:
- A **claimed** profile's stored key never switches the path. A signed-in user keeps today's behavior unless they pass a key explicitly. A signed-out user with a claimed profile still gets exit 4, as before.
- With a key, **`--environment-id` is refused** (`invalid_argument`). The key decides the environment, and silently ignoring the flag could act on the wrong one.
- `environment create|rename` are environment-scoped dashboard operations behind an account command, so they stay session-only even with a key set.

## Known differences on the API-key path

Keys and shapes are identical on both paths. These values differ because REST has no source for them (all are `null` on the key path, and all are in `API_KEY_ACCEPTED` / `API_KEY_NULL_FIELDS`):

| Field | Reason |
| --- | --- |
| `organization.usersCount` | REST organizations carry no member count |
| `user.sessionCount`, `user.hasPassword` | not in REST users |
| `user.emailVerifiedAt` | REST has only an `email_verified` boolean. The human view still shows Verified: Yes from it. |
| `user.authenticationFactors[].lastVerifiedAt` | REST auth factors carry no last-verified time |
| `membership.type` | REST memberships carry no type |
| `event.updatedAt` | REST events carry only a creation time |
| `feature-flag` get: `accessType`, `organizationTargets`, `userTargets` | the REST flag endpoints expose neither |
| `org-domain`: `verificationContent`, `domainCaptureEnabled` | REST returns the verification prefix/token separately, and has no capture flag |
| `portal`: `id`, `state`, `expiresAt` | REST `generate_link` returns only the URL |
| `session.impersonator` id/firstName/lastName | REST names an impersonator by email only |
| `session.provider` for OAuth sign-ins | REST reports every OAuth provider as plain `oauth`, so `GoogleOAuth` etc. can't be named |
| `config homepage-url set`: `applicationId` | REST never exposes the AuthKit application ID |

Some fields are filled with extra REST reads rather than nulled. They are bounded per page and memoized per call:
- user `identities`: the user's memberships, with role IDs and names resolved from slugs. An organization's own role wins over an environment role with the same slug, as on the dashboard;
- user get `authenticationFactors`;
- organization names on invitations and sessions.

Behavioral differences (not output fields):
- **Search filters are exact matches.** `organization list --domain`, `user list --email` and `invitation list --email` use REST's exact-match filters (domain, email). The dashboard does a search.
- **New domains start pending.** `org-domain create` on REST creates the domain `pending` (it needs DNS verification). The dashboard adds it verified. The output reports the real state.
- **Order, full lists and statuses are explicit.** Every key-path list sends an order (your `--order`, else `desc`, which returns the same newest-first rows as REST's `normal` default), so `after` is always the next page. Reads that must return a complete list (permissions, a user's memberships, redirect URIs, CORS origins) follow it to the end, and `config redirect add` still refuses to merge over more than one page of URIs. Membership listings and `membership delete` include every status (`active,inactive,pending`), so a deactivated membership is listed and can be deleted, as on the dashboard.
- **`membership list --org` pages over memberships.** Its cursors are membership IDs on the key path and user IDs on the session path. They're opaque either way, and each path accepts its own cursors.
- **`feature-flag add-target|remove-target` call REST's target endpoints directly.** REST can't list a flag's targets, so there's no read-merge-write, and remove-target can't pre-check that the target exists.
- **Redirect URIs and CORS have limits on REST.**
  - `authkit redirect-uris set` diffs the list. It creates what's missing **first** and only then deletes what's dropped, so a rejected URI or a failed request never leaves fewer working URIs (at worst an extra one remains).
  - `--default` is accepted only for a URI that is already the default, because REST can't choose one.
  - `authkit cors set` can't remove origins, because REST has no delete.
  - `--dry-run` is refused, because REST has no validate-only mode.
  - All of these fail before any write.
- **Role permission changes are verified.** If the permissions replace returns 404, or the server afterwards holds anything other than the requested permissions, the command fails (`not_found` / `unexpected_result`) instead of reporting the requested list.

Enum mapping is taken from the vendored catalog's enum types, so both paths print the same value:
- **`session list` `provider`.** The session path emits the dashboard's `SessionProvider` value raw (`Password`, not normalized; this is pre-existing and pinned in the json-contract snapshot). The key path maps REST's `auth_method` to the same values: `password` → `Password`, `magic_code` → `MagicAuth`, `sso` → `SingleSignOn`, `passkey`, `impersonation`, `cross_app_auth`, `external_auth`, `migrated_session` likewise. `oauth` and `unknown` have no single dashboard value and come back `null` (a documented gap). Running `enumOut` on both paths would be the cleaner fix, but it changes signed-in output, so it's left for a follow-up.
- **`webhook` `state`.** REST `enabled`/`disabled` map to the dashboard's `Active`/`InActive`, so both paths print `active` / `in_active`.

## Parity results

**Offline (`src/commands/api-key-parity.spec.ts`, 24 parity tests plus 4 tests of the gate itself, all pass).**
- Every list and get command runs the real handler on both paths against the same entity:
  - organization, user, role (env and `--org`), permission, invitation (env and `--org`), membership (`--user`, `--org`, get), session, webhook, event, feature-flag, org-domain;
  - plus portal generate-link;
  - plus the edge cases: disabled webhooks (`InActive` vs `disabled`), every mapped session provider and an unnamed OAuth one, and an organization role shadowing an environment role's slug.
- The dashboard side is fed real dashboard casing (`Verified`, `Active`, `Environment`, metadata as `{key,value}` pairs).
- The REST side is fed real REST responses: snake_case keys, `verified`, `EnvironmentRole`, `enabled`, `password`, metadata as an object, plus the internal fields the shapers must drop (`stripe_customer_id`, `secret`, invitation `token`).
- The envelope and pagination must be deep-equal, and each entity must pass the shared gate below. Each test also names the gaps its fixture exercises, so it can't pass vacuously.

**One gate, offline and live.** Both use `apiKeyParityDiffs()` from `known-gaps.ts`. Every object must have the same keys on both sides, arrays the same length, and every leaf the same value. The only exception is a leaf path listed in `API_KEY_NULL_FIELDS` (for example `user.authenticationFactors[].lastVerifiedAt`, `session.impersonator.id`), which may be `null` on the key side. An element that loses its keys, an object that goes null as a whole, a lost ID or email, or a casing-only difference all fail.

**Live (`scripts/parity-smoke.ts --api-key`, new mode).** It runs each command's list/get on this branch twice, with the session and with `WORKOS_API_KEY`, and judges each entity with the same gate. It needs no `../main`. A check counts only when both sides returned real entities (rows that each carry their ID, or a non-empty entity), and a run that compared no entity at all exits 1. The session side is proven, not assumed: `whoami` (session-only) must succeed without a key, and every session-side command is pinned to that environment with `--environment-id`. The CLI refuses `--environment-id` whenever any API key applies, including an unclaimed profile's stored key, so the session side can't quietly run on REST and compare REST with itself. **Not run for this PR:** the session side needs a real `workos auth login`, and this work was kept away from the real `~/.workos` and Keychain. With no login it exits 2 before comparing anything (checked against a scratch HOME). Running it is a good pre-merge check:

```
workos auth login
export WORKOS_API_KEY=sk_test_…   # same environment the session targets
bun run scripts/parity-smoke.ts --api-key
```

## Real-command proof (from source, fresh unclaimed environment)

Setup:
- Run from the worktree with `HOME=$PWD/.scratch/home`, `--insecure-storage`, and `bun --preload ./src/test/force-insecure-storage.ts src/bin.ts …`. That's the preload the integration specs use, so startup never touches the Keychain.
- `WORKOS_TELEMETRY=false`, no `WORKOS_API_KEY`, and each command wrapped in `timeout 120`.
- The scratch home was deleted afterwards. Secrets are redacted.

```
$ workos env provision --insecure-storage --json
{"status":"ok","message":"Environment provisioned","data":{"name":"unclaimed","type":"unclaimed","active":true,"apiKey":"sk_…REDACTED","clientId":"client_01M6SH09VVW8FK83WABDPS1YF8","claimToken":"…REDACTED","authkitDomain":"vast-sonnet-18-sandbox.authkit.app"}}
exit=0

$ workos organization list --json --insecure-storage
{"organizations":[{"id":"org_01M6SH09P7HB581EQQQKQYME31","name":"Test Organization","createdAt":"2026-11-06T22:52:22.375Z","usersCount":null,"allowProfilesOutsideOrganization":false,"externalId":null,"domains":[{"id":"org_domain_01M6SH09Q1BJCH2T5GEF90HRT2","domain":"example.com","state":"verified"}],"metadata":{}}],"pagination":{"before":null,"after":null}}
exit=0

$ workos user list --json --insecure-storage
{"users":[],"pagination":{"before":null,"after":null}}
exit=0
```

Both list commands ran with no login, using the unclaimed profile's key. Before this change, both would exit 4 with "does not accept API keys". `usersCount: null` is the documented gap. The user list is empty because the environment is brand new.

I also checked against a local fake API (`WORKOS_API_URL=http://127.0.0.1:<port>`, no external network):
- `--api-key` reaches the request as the bearer.
- `--api-key` with `--environment-id` exits 1 with `invalid_argument`.
- `branding get` with a key exits 1 with `api_key_unsupported`.
- `team members` with a key and no login still exits 4, with the reworded copy.
- `organization list --help` lists `--api-key`.

## Overlap with #269 and #270

- **#269 (`nicknisi/ax-agent-copy`, open).**
  - Overlapping files: `src/lib/command-auth.ts`, `src/utils/recovery-hints.ts`, `src/bin.ts` and `README.md`. This PR doesn't touch `recovery-hints.ts`.
  - `git merge-tree` shows one textual conflict, in `src/lib/command-auth.spec.ts`: #269 adds a test next to one this PR renames. It's easy to resolve.
  - Semantic follow-up: #269 adds `dashboardSessionRecovery`. Its second hint ("make the same request with an API key … through the API command") and its test asserting no "set WORKOS_API_KEY" hint were written when resource commands rejected keys. Once both land:
    - resource commands reach that hint only when no key is set, and setting `WORKOS_API_KEY` or passing `--api-key` now fixes them;
    - the account commands still need the session.
  - So the hint should be reworded for whichever PR merges second.
- **#270 (`fix/account-plane-forbidden-and-slim-team-query`).** It touches `command-auth.ts` (the `forbidden` copy only). It merges cleanly with this branch. This branch is cut from `origin/main`, not from #270, so #270's own changes (the slim team-environments query, sanitized server error codes, and their tests in `no-graphql-leak.spec.ts`, `dashboard-graphql.spec.ts` and `environment-target.spec.ts`) are not here. They land with #270; this PR deletes none of them. #270 also carries the slim `teamProjectsV2` query used by signed-in environment resolution, so whichever of the two PRs lands second rebases onto the other.
- Neither branch was touched.

## Security read: key scope

**The keys are full-scope.** The one-shot keys from `workos env provision` and the installer are full-scope secret keys for that (sandbox) environment. `WORKOS_API_KEY` / `--api-key` can be any key, including a production `sk_live_…`.

**What an agent holding one can now do through these commands:**
- **Organizations:** create, update, and delete. Delete cascades to the org's connections, directories and users.
- **Org domains:** add, verify and delete. Domain-based sign-in and capture stop working for a deleted domain.
- **Users:** read, including email, name, metadata and memberships. Update them, including changing a user's email. Delete them.
- **Sessions:** list and revoke.
- **RBAC:**
  - create, update and delete organization roles;
  - change any role's permissions, including environment roles;
  - create, update and delete permissions.
- **Memberships:** add a user to an organization with a role, change roles, deactivate, reactivate, delete.
- **Invitations:** send (real email), revoke, resend.
- **Webhooks:** create and delete endpoints. Creating one aimed at an outside URL streams future events there.
- **Events:** read the event feed, which includes user payloads.
- **Feature flags:** enable, disable, add and remove targets.
- **Admin Portal:** generate setup links, which grant SSO/Directory Sync setup access for an organization.
- **AuthKit config:** add redirect URIs and CORS origins, replace the redirect-URI list (deleting unlisted URIs), set the homepage URL. Adding a redirect URI for an attacker's domain is a classic way to steal sign-ins in a real app.

**What it could already do with `workos api`:** all of the above. `workos api` makes any authenticated REST request with the same key, so this PR adds no new capability. It adds convenience and discoverability. The real difference is confirmation:
- `workos api` requires `--yes` for **every** mutating request in agent, CI and JSON mode.
- The resource commands keep their own per-command posture:
  - destructive commands (deletes, revokes) need `--yes` non-interactively;
  - privilege changes (role/permission create and update, membership update and deactivate) need `--yes` non-interactively;
  - other writes need no `--yes`: org create/update, user update, invitation send/resend, webhook create, org-domain create/verify, portal links, flag enable/disable/targets, and the redirect/CORS/homepage config.
- That posture was already there for signed-in agents. What's new is that a key alone now reaches it.

**Recommendations** (not implemented; each needs a product call):
1. **On the API-key path in agent/CI mode, require `--yes` for every mutation,** matching `workos api`. At minimum, require it for the security-sensitive non-destructive writes: redirect URI / CORS / homepage changes, webhook create, portal link generation, invitation send. This is cheap to add in `resolveEnvScopedAuth()` / the adapters' write paths.
2. **Don't refuse destructive commands on an unclaimed key.** An unclaimed environment is a disposable sandbox the agent created itself. Blocking deletes there removes legitimate cleanup without stopping anything `workos api --yes` can already do.
3. **Treat live keys more strictly.** An `sk_live_` key passed via `WORKOS_API_KEY` or `--api-key` is the risky case. Consider always requiring `--yes` (or an extra confirmation) for mutations with a live key.
4. **Tell signed-in users when an exported key takes over.** A signed-in developer who has `WORKOS_API_KEY` exported for app work (common) now runs resource commands against that key's environment instead of their profile's. That follows the brief's rule (an explicit key wins), but it can surprise people. A one-line human-mode stderr notice would help, something like "Using WORKOS_API_KEY; unset it to use your dashboard login". Note that the shipped binary doesn't auto-load `.env` files (`--no-compile-autoload-dotenv`); running from source with Bun does.
5. **Prefer `WORKOS_API_KEY` over `--api-key` in docs for agents.** A flag value shows up in shell history and process lists. This is the same caveat as for the existing REST commands.

## Tests

- `src/commands/api-key-auth.spec.ts` covers:
  - path choice: unclaimed profile, `WORKOS_API_KEY` over a session, `--api-key` over both, a signed-in user with a claimed profile's stored key staying on the session, the `--environment-id` refusal, account commands staying on the session;
  - the unsupported errors and their leak check;
  - the REST requests and outputs for every command's mutations;
  - not-found and 401 handling.
- `src/commands/api-key-parity.spec.ts` covers JSON parity, described above.
- `src/lib/command-auth.spec.ts` covers:
  - the `resolveResourceApiKey()` precedence, against the real file-backed config store;
  - the updated copy. Two existing tests were renamed and updated, because their assertion that the copy says "does not accept API keys" is now the bug.
- Every new or changed test name contains "with an API key".
- `bunx vitest run src/lib/command-auth.spec.ts src/commands -t "with an API key"`: 69 passed.
- Existing suites for every touched command, plus `help-json`, `catalog` (incl. `no-graphql-leak`), `environment-target` and the bin integration specs: 1,323 passed.
- `bun run typecheck`: clean.
