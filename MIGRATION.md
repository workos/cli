# Migration guide: GraphQL resource commands (`--json` output)

## What changed

About a dozen `workos` resource commands moved from the REST backend to the
dashboard GraphQL account plane. This ships as one breaking release.

Command names, flags, and positionals are unchanged. `workos org list`,
`workos user get <id>`, `workos webhook create --url ...` all take the same
arguments they always did. The only thing that changed is the **`--json` output
shape**. If you script against `--json` with `jq` or in CI, read this guide. If
you only read the human-readable tables, nothing changes for you.

Why the change: the backend's vocabulary (enum casing, metadata encoding, field
names) was leaking into `--json`, which made it fragile. The CLI now applies one
consistent contract (`src/utils/output-conventions.ts`) so the next backend
migration is not another user-visible break. Two rules of that contract:

- Enum values are always lowercase (snake_case if multiword).
- Enum input is case-insensitive, so any value the CLI prints is accepted back.

> Source note: the old REST shapes below are derived from the release's
> `feat!` commit bodies, the `scripts/parity-smoke.ts` `ACCEPTED` map, and the
> README correction commit. The sibling `../main` checkout was not reachable
> from this worktree, so a few old REST values could not be independently
> confirmed; those are flagged inline and listed under
> [Unconfirmed facts](#unconfirmed-facts).

## Breaking changes at a glance

| Change | Old | New | Affected commands |
| --- | --- | --- | --- |
| List envelope | `{ "data": [...], "list_metadata": {...} }` | `{ "<resource>": [...], "pagination": {...} }` | all list views |
| `metadata` encoding | object map `{"team":"blue"}` (array of pairs during prerelease) | object map `{"team":"blue"}` | organization, user |
| Lifecycle key | `status` | `state` | user identities, membership, session |
| Enum casing | mixed (`Pending`, `Active`, `Verified`, `SOME`) | lowercase (`pending`, `active`, `verified`, `some`) | invitation, webhook, org-domain, membership, role, feature-flag |
| `role.type` | `EnvironmentRole` / `OrganizationRole` | `environment` / `organization` | role |
| `webhook.state` | `enabled` | `active` | webhook |
| `invitation.organization` | flat `organizationId` string | nested `{ "id", "name" }` object | invitation |
| `feature-flag.enabled` | flat flag value | derived from the active environment's state | feature-flag |
| Internal fields | present (`stripeCustomerId`, `resourceTypeId`, request context, ...) | dropped | all |

## metadata (silent failure - read this first)

`metadata` is an **object map** in the final release:

```json
{ "metadata": { "team": "blue" } }
```

`.metadata.team` resolves in `jq`. Affects `organization` and `user`.

Why this section is called out: during the GraphQL prerelease, `metadata` was
briefly emitted as GraphQL's array-of-pairs transport form:

```json
{ "metadata": [ { "key": "team", "value": "blue" } ] }
```

That form **fails silently**. `jq '.metadata.team'` returns empty rather than
erroring, so a broken pipeline looks like it is returning "no value" instead of
crashing. The final release folds it back to a map.

Action:

- If you script against a stable REST release, `.metadata.team` worked before
  and still works. No change.
- If you already migrated a script to the array form during the prerelease
  (`.metadata[] | select(.key=="team") | .value`), **revert it** to
  `.metadata.team`.

```bash
# WRONG (prerelease array form) - remove this
jq -r '.metadata[] | select(.key=="team") | .value'

# RIGHT
jq -r '.metadata.team'
```

## Enum casing

All enum values in `--json` are now lowercase, snake_case if multiword. Every
value the migrated commands emit today is single word (`active`, `verified`,
`pending`, `environment`, `organization`, `standard`, `dns`, `manual`, `some`),
so the snake_case rule is not yet visible in output, but a future multiword enum
will render as e.g. `user_registration`, not `userregistration`.

Enum **input is case-insensitive**, so values round-trip: whatever the CLI
prints for a field, it accepts back for that field.

```bash
# Both accepted; the CLI prints `verified`.
workos organization create foo.com:verified
workos organization create foo.com:Verified
```

Old -> new values (from the `feat!` commit body):

| Field | Old | New |
| --- | --- | --- |
| `invitation.state` | `Pending` | `pending` |
| `webhook.state` | `Active`* | `active` |
| `org-domain.state` | `Verified` | `verified` |
| `org-domain.verificationStrategy` | `Dns` / `Manual` | `dns` / `manual` |
| `membership.state` / `membership.type` | `Active` / `Standard` | `active` / `standard` |
| `role.type` | `Environment`* | `environment` |
| `feature-flag.accessType` | `SOME` | `some` |

\* See [Deliberate differences from REST](#deliberate-differences-from-the-old-rest-output):
the REST plane used different vocabulary for `webhook.state` (`enabled`) and
`role.type` (`EnvironmentRole`). The casings above are the GraphQL backend
passthrough values that the release normalizes.

Fix pattern (do not hardcode casing; downcase before comparing):

```bash
# Fragile
jq 'select(.state == "Pending")'

# Robust
jq 'select((.state | ascii_downcase) == "pending")'
```

## Lifecycle key rename: `status` -> `state`

The lifecycle key is `state` on every resource, never `status`. This affects
three places that previously used `status`:

| Command | Old | New |
| --- | --- | --- |
| user identities | `.identities[].status` | `.identities[].state` |
| membership | `.status` | `.state` |
| session | `.status` | `.state` |

```bash
# Old
jq -r '.identities[].status'
# New
jq -r '.identities[].state'
```

## Per-command reference

Each section shows the new payload (from the command's `*.spec.ts`) and the
`jq` change. List views are wrapped in `{ "<resource>": [...], "pagination": {...} }`;
the examples show a single row unless the envelope is the point.

### organization

New:

```json
{
  "id": "org_1",
  "name": "FooCorp",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "usersCount": 3,
  "allowProfilesOutsideOrganization": false,
  "externalId": null,
  "domains": [ { "id": "dom_1", "domain": "foo.com", "state": "verified" } ],
  "metadata": { "team": "blue" }
}
```

List envelope changed from `{ data, list_metadata }` to `{ organizations, pagination }`.
Internal fields like `stripeCustomerId` are dropped. `domains[].state` is lowercase.

```bash
# List row ids: old envelope -> new envelope
jq -r '.data[].id'            # old
jq -r '.organizations[].id'   # new

# Filter verified domains (casing changed)
jq '.organizations[].domains[] | select(.state == "verified")'

# Read a metadata key
jq -r '.organization.metadata.team'
```

### user

New:

```json
{
  "id": "user_1",
  "email": "jane@example.com",
  "firstName": "Janet",
  "lastName": "Doe",
  "metadata": { "team": "blue" },
  "identities": [
    {
      "id": "ident_1",
      "state": "active",
      "organization": { "id": "org_1", "name": "FooCorp" },
      "roles": [ { "id": "role_1", "name": "member" } ]
    }
  ]
}
```

`identities[].status` became `identities[].state` and is lowercase. `metadata`
is a map. Internal fields (`googleOauthProfile`, identity `customAttributes`) are
dropped. List envelope is `{ users, pagination }`.

```bash
# Identity state: renamed status -> state, lowercased
jq -r '.user.identities[] | select(.state == "active") | .id'

# Metadata key
jq -r '.user.metadata.team'
```

### role

New:

```json
{
  "id": "role_env",
  "slug": "admin",
  "name": "Admin",
  "description": "Administrator",
  "type": "environment",
  "permissions": ["users:read"],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-02-01T00:00:00.000Z"
}
```

`type` dropped the redundant `Role` suffix and is lowercase:
`EnvironmentRole` -> `environment`, `OrganizationRole` -> `organization`.
`permissions` is an array of permission slugs.

```bash
# Old: matched the REST vocabulary
jq 'select(.type == "EnvironmentRole")'
# New
jq 'select(.type == "environment")'
```

### permission

New:

```json
{
  "id": "perm_1",
  "slug": "users:read",
  "name": "Read users",
  "description": "Read user records",
  "system": false,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-02-01T00:00:00.000Z"
}
```

No enum or metadata changes. Internal fields (`environmentId`,
`isEnabledForApiKeys`) are dropped. List envelope is `{ permissions, pagination }`.

```bash
jq -r '.permissions[] | select(.system == false) | .slug'
```

### membership

New:

```json
{
  "id": "om_1",
  "userId": "user_1",
  "organizationId": "org_1",
  "state": "active",
  "type": "standard",
  "role": "member",
  "roles": ["member"],
  "directoryUserId": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`status` -> `state`; `state` and `type` are lowercase (`Active`/`Standard` ->
`active`/`standard`). List envelope is `{ memberships, pagination }`.

```bash
# Old
jq -r '.data[] | select(.status == "Active") | .id'
# New
jq -r '.memberships[] | select(.state == "active") | .id'
```

### invitation

New:

```json
{
  "id": "invite_1",
  "email": "jane@example.com",
  "state": "pending",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "organization": { "id": "org_1", "name": "FooCorp" }
}
```

Two changes: `state` is lowercase (`Pending` -> `pending`), and the flat
`organizationId` string is now a nested `organization` object.

```bash
# Organization id: flat string -> nested object
jq -r '.organizationId'         # old
jq -r '.organization.id'        # new

# Filter pending (casing changed)
jq '.invitations[] | select(.state == "pending")'
```

### session

New:

```json
{
  "id": "session_1",
  "state": "active",
  "createdAt": "...",
  "updatedAt": "...",
  "expiresAt": "2026-03-01T00:00:00.000Z",
  "endedAt": null,
  "ipAddress": "...",
  "userAgent": "Mozilla/5.0",
  "provider": "Password",
  "organization": { "id": "org_1", "name": "FooCorp" },
  "impersonator": null
}
```

`status` -> `state`; values are lowercase (`active`, `revoked`, `expired`).

```bash
# Old
jq -r '.data[] | select(.status == "Active") | .id'
# New
jq -r '.sessions[] | select(.state == "active") | .id'
```

### event

New:

```json
{
  "id": "event_1",
  "event": "dsync.user.created",
  "data": { "directory_id": "dir_1" },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

The event type is under `event`. Internal request `context` and `metadata` that
GraphQL carries are dropped. List envelope is `{ events, pagination }`.

```bash
jq -r '.events[] | select(.event == "dsync.user.created") | .id'
```

**Sort order reversed. This one changes which rows you get, not just their shape.**

| | old (REST) | new (GraphQL) |
| --- | --- | --- |
| `event list` order | oldest first | newest first |
| `event list --limit 10` returns | the 10 oldest events | the 10 most recent events |

If you took the first element to mean "the latest event", it now means the
opposite of what it used to, and no error is raised:

```bash
# Old: this was the OLDEST event. Taking [0] to mean "latest" was already a bug,
# it just happened to be a different bug.
workos event list --events user.created --limit 1 | jq -r '.data[0].id'

# New: [0] is genuinely the most recent event.
workos event list --events user.created --limit 1 | jq -r '.events[0].id'
```

`--after` still requests the next page, but "next" now moves toward older
events because the feed starts with the newest. Treat cursors as opaque and do
not reuse a cursor saved by the REST version after upgrading.

If you were paginating to the end of the REST feed just to reach recent events,
you can now drop that work and read from the first page.

### feature-flag

New (`get` detail):

```json
{
  "id": "flag_1",
  "slug": "beta",
  "name": "...",
  "description": "...",
  "enabled": false,
  "defaultEnabled": true,
  "accessType": "some",
  "organizationTargets": [ { "id": "org_1", "name": "FooCorp" } ],
  "userTargets": [ { "id": "user_1", "email": "a@example.com" } ],
  "tags": []
}
```

`accessType` is lowercase (`SOME` -> `some`). `enabled` now reflects the
**active environment's** flag state, not a flat global flag. List rows carry the
list subset (through `enabled`); `get` adds targeting fields.

```bash
# Old
jq 'select(.accessType == "SOME")'
# New
jq 'select(.accessType == "some")'

jq -r '.flags[] | select(.enabled) | .slug'
```

### org-domain

New:

```json
{
  "id": "org_domain_1",
  "domain": "example.com",
  "state": "verified",
  "organizationId": "org_1",
  "subdomain": null,
  "verificationStrategy": "dns",
  "verificationContent": "workos-verify=abc123",
  "domainCaptureEnabled": false
}
```

`state` (`Verified` -> `verified`) and `verificationStrategy`
(`Dns`/`Manual` -> `dns`/`manual`) are lowercase.

```bash
# Old
jq 'select(.state == "Verified")'
# New
jq 'select(.state == "verified")'

jq -r 'select(.verificationStrategy == "dns") | .verificationContent'
```

### portal

New:

```json
{
  "id": "portal_setup_link_1",
  "link": "https://setup.workos.com/abc",
  "intents": ["sso"],
  "state": "active",
  "expiresAt": "2026-08-01T00:00:00Z"
}
```

The URL is under `link`. `intents` are echoed in the CLI's own lowercase
vocabulary (`Sso` -> `sso`). `state` is lowercase.

```bash
jq -r '.portalSetupLink.link'
jq -r '.portalSetupLink.intents[]'
```

### webhook

New:

```json
{
  "id": "we_123",
  "url": "https://example.com/hook",
  "events": ["dsync.user.created"],
  "state": "active",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

Two changes: the endpoint URL is under `url` (REST used `endpoint_url`), and
`state` is `active` where REST said `enabled`. List envelope is
`{ webhookEndpoints, pagination }`.

```bash
# URL: renamed field
jq -r '.endpoint_url'   # old (REST)
jq -r '.url'            # new

# State: vocabulary + presence changed
jq 'select(.status == "enabled")'   # old (REST)
jq 'select(.state == "active")'     # new
```

### config

`config redirect add`, `config cors add`, and `config homepage-url set` emit
small confirmation objects, not resource shapes:

```json
{ "uri": "https://app.example.com/callback", "alreadyExists": false }
{ "origin": "https://app.example.com", "alreadyExists": true }
{ "homepageUrl": "https://app.example.com", "applicationId": "app_1" }
```

These are new commands on the dashboard plane; no field renames from a prior
shape apply.

## Deliberate differences from the old REST output

These are intentional curations, declared in the `ACCEPTED` map of
`scripts/parity-smoke.ts`. They are not bugs, and the parity smoke reports them
as INFO, not FAIL.

| Field | REST | Now | Reason |
| --- | --- | --- | --- |
| `role.type` | `EnvironmentRole` / `OrganizationRole` | `environment` / `organization` | Drops the redundant `Role` suffix. |
| `webhook.state` | `enabled` | `active` | Aligns webhook lifecycle with session's `active`/`expired`/`revoked` vocabulary. |
| `invitation.organization` | flat `organizationId` | nested `{ id, name }` | Structural: consistent with other nested org references. |
| `user.identities` | different shape, `status` key | curated identities, `status` -> `state` | Structural + lifecycle-key rename. |
| `feature-flag.enabled` | flat flag | derived from the active environment's state | Flag state is per-environment server-side; the CLI reports the active environment. |

Enum casing is deliberately absent from `ACCEPTED`: the CLI lowercases all enum
values, so a casing-only difference is treated as a bug that must fail the
parity run, not an accepted divergence.

## How to verify your scripts

`scripts/parity-smoke.ts` compares this release against a `../main` (REST)
checkout against the same WorkOS environment. It matches rows by id, compares
every shared field, and fails on any divergence not listed in `ACCEPTED`. Use it
to confirm your understanding of a field before and after.

```bash
bun run scripts/parity-smoke.ts            # read-only
bun run scripts/parity-smoke.ts --seed     # seed fixtures so lists are non-empty
```

Prereqs are documented at the top of the script: a dashboard `workos auth login`
on this branch, a `WORKOS_API_KEY` for the REST plane pinned to the same
environment, and `../main` checked out on `main`.

## Unconfirmed facts

The sibling `../main` checkout was not reachable from this worktree, so the
following old REST values could not be independently verified against source:

1. Exact REST casing for `invitation.state`, `org-domain.state`,
   `org-domain.verificationStrategy`, `membership.state`/`membership.type`, and
   `feature-flag.accessType`. The old values shown come from the `feat!` commit
   body, which describes them as GraphQL backend passthrough casing normalized
   in this release. Whether the last stable REST release emitted that exact
   casing to users is not confirmed here.
2. The precise old REST envelope key names beyond `data` / `list_metadata`
   (confirmed via the README correction commit e67867d for `org list`); other
   commands are assumed to have used the same REST envelope.
3. The full old REST field set for `user.identities`, `session`, and `portal`.
   The `ACCEPTED` map confirms the direction of the structural changes but not
   the complete prior shapes.

Confirmed directly from source: all new shapes (from `*.spec.ts`), the
conventions (`src/utils/output-conventions.ts`), the deliberate divergences
(`ACCEPTED` in `scripts/parity-smoke.ts`), the metadata array-vs-map history and
the lifecycle key rename (`feat!` commit 22d441d), and the snake_case enum rule
(commit 461df62).
