---
name: workos-management
description: Manage WorkOS resources (orgs, users, roles, SSO, directories, webhooks, audit logs) via CLI. Use when configuring RBAC, onboarding orgs/users, debugging SSO/DSync, or managing WorkOS settings.
---

# WorkOS Management Commands

Use these commands to manage WorkOS resources directly from the terminal. The CLI must be authenticated via `workos auth login` or `WORKOS_API_KEY` env var.

All commands support `--json` for structured output. Use `--json` when you need to parse output (e.g., extract an ID).

## Quick Reference

| Task                   | Command                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| List organizations     | `workos organization list`                                                   |
| Create organization    | `workos organization create "Acme Corp" acme.com:verified`                   |
| List users             | `workos user list --email=alice@acme.com`                                    |
| Create permission      | `workos permission create --slug=read-users --name="Read Users"`             |
| Create role            | `workos role create --slug=admin --name=Admin`                               |
| Assign perms to role   | `workos role set-permissions admin --permissions=read-users,write-users`     |
| Create org-scoped role | `workos role create --slug=admin --name=Admin --org=org_xxx`                 |
| Add user to org        | `workos membership create --org=org_xxx --user=user_xxx`                     |
| Send invitation        | `workos invitation send --email=alice@acme.com --org=org_xxx`                |
| Revoke session         | `workos session revoke <sessionId>`                                          |
| Add redirect URI       | `workos config redirect add http://localhost:3000/callback`                  |
| Add CORS origin        | `workos config cors add http://localhost:3000`                               |
| Set homepage URL       | `workos config homepage-url set http://localhost:3000`                       |
| Create webhook         | `workos webhook create --url=https://example.com/hook --events=user.created` |
| List SSO connections   | `workos connection list --org=org_xxx`                                       |
| List directories       | `workos directory list`                                                      |
| Toggle feature flag    | `workos feature-flag enable my-flag`                                         |
| Store a secret         | `workos vault create --name=api-secret --value=sk_xxx --org=org_xxx`         |
| Generate portal link   | `workos portal generate-link --intent=sso --org=org_xxx`                     |
| Seed environment       | `workos seed --file=workos-seed.yml`                                         |
| Debug SSO              | `workos debug-sso conn_xxx`                                                  |
| Debug directory sync   | `workos debug-sync directory_xxx`                                            |
| Set up an org          | `workos setup-org "Acme Corp" --domain=acme.com --roles=admin,viewer`        |
| Onboard a user         | `workos onboard-user alice@acme.com --org=org_xxx --role=admin`              |

## Workflows

### Setting up RBAC

When you see permission checks in the codebase (e.g., `hasPermission('read-users')`), create the matching WorkOS resources:

```bash
workos permission create --slug=read-users --name="Read Users"
workos permission create --slug=write-users --name="Write Users"
workos role create --slug=admin --name=Admin
workos role set-permissions admin --permissions=read-users,write-users
workos role create --slug=viewer --name=Viewer
workos role set-permissions viewer --permissions=read-users
```

For organization-scoped roles, add `--org=org_xxx` to role commands.

### Organization Onboarding

One-shot setup with the compound command:

```bash
workos setup-org "Acme Corp" --domain=acme.com --roles=admin,viewer
```

Or step by step:

```bash
ORG_ID=$(workos organization create "Acme Corp" --json | jq -r '.data.id')
workos org-domain create acme.com --org=$ORG_ID
workos role create --slug=admin --name=Admin --org=$ORG_ID
workos portal generate-link --intent=sso --org=$ORG_ID
```

### User Onboarding

```bash
workos onboard-user alice@acme.com --org=org_xxx --role=admin
```

Or step by step:

```bash
workos invitation send --email=alice@acme.com --org=org_xxx --role=admin
workos membership create --org=org_xxx --user=user_xxx --role=admin
```

### Local Development Setup

Configure WorkOS for local development:

```bash
workos config redirect add http://localhost:3000/callback
workos config cors add http://localhost:3000
workos config homepage-url set http://localhost:3000
```

### Environment Seeding

Create a `workos-seed.yml` file in your repo:

```yaml
permissions:
  - name: 'Read Users'
    slug: 'read-users'
  - name: 'Write Users'
    slug: 'write-users'

roles:
  - name: 'Admin'
    slug: 'admin'
    permissions: ['read-users', 'write-users']
  - name: 'Viewer'
    slug: 'viewer'
    permissions: ['read-users']

organizations:
  - name: 'Test Org'
    domains: ['test.com']

config:
  redirect_uris: ['http://localhost:3000/callback']
  cors_origins: ['http://localhost:3000']
  homepage_url: 'http://localhost:3000'
```

Then run:

```bash
workos seed --file=workos-seed.yml   # Create resources
workos seed --clean                  # Tear down seeded resources
```

### Debugging SSO

```bash
workos debug-sso conn_xxx
```

Shows: connection type/state, organization binding, recent auth events, and common issues (inactive connection, org mismatch).

### Debugging Directory Sync

```bash
workos debug-sync directory_xxx
```

Shows: directory type/state, user/group counts, recent sync events, and stall detection.

### Webhook Management

```bash
workos webhook list
workos webhook create --url=https://example.com/hook --events=user.created,dsync.user.created
workos webhook delete we_xxx
```

### Audit Logs

```bash
workos audit-log create-event --org=org_xxx --action=user.login --actor-type=user --actor-id=user_xxx
workos audit-log list-actions
workos audit-log get-schema user.login
workos audit-log export --org=org_xxx --range-start=2024-01-01 --range-end=2024-02-01
workos audit-log get-retention --org=org_xxx
```

## Using --json for Structured Output

All commands support `--json` for machine-readable output. Use this when you need to extract values:

```bash
# Get an organization ID
workos organization list --json | jq '.data[0].id'

# Get a connection's state
workos connection get conn_xxx --json | jq '.state'

# List all role slugs
workos role list --json | jq '.data[].slug'

# Chain commands: create org then add domain
ORG_ID=$(workos organization create "Acme" --json | jq -r '.data.id')
workos org-domain create acme.com --org=$ORG_ID
```

JSON output format:

- **List commands**: `{ "data": [...], "listMetadata": { "before": null, "after": "cursor" } }`
- **Get commands**: Raw object (no wrapper)
- **Create/Update/Delete**: `{ "status": "ok", "message": "...", "data": {...} }`
- **Errors**: `{ "error": { "code": "...", "message": "..." } }` on stderr

## Command Reference

### Resource Commands

| Command               | Subcommands                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `workos organization` | `list`, `get`, `create`, `update`, `delete`                                                           |
| `workos user`         | `list`, `get`, `update`, `delete`                                                                     |
| `workos role`         | `list`, `get`, `create`, `update`, `delete`, `set-permissions`, `add-permission`, `remove-permission` |
| `workos permission`   | `list`, `get`, `create`, `update`, `delete`                                                           |
| `workos membership`   | `list`, `get`, `create`, `update`, `delete`, `deactivate`, `reactivate`                               |
| `workos invitation`   | `list`, `get`, `send`, `revoke`, `resend`                                                             |
| `workos session`      | `list`, `revoke`                                                                                      |
| `workos connection`   | `list`, `get`, `delete`                                                                               |
| `workos directory`    | `list`, `get`, `delete`, `list-users`, `list-groups`                                                  |
| `workos event`        | `list` (requires `--events` flag)                                                                     |
| `workos audit-log`    | `create-event`, `export`, `list-actions`, `get-schema`, `create-schema`, `get-retention`              |
| `workos feature-flag` | `list`, `get`, `enable`, `disable`, `add-target`, `remove-target`                                     |
| `workos webhook`      | `list`, `create`, `delete`                                                                            |
| `workos config`       | `redirect add`, `cors add`, `homepage-url set`                                                        |
| `workos portal`       | `generate-link`                                                                                       |
| `workos vault`        | `list`, `get`, `get-by-name`, `create`, `update`, `delete`, `describe`, `list-versions`               |
| `workos api-key`      | `list`, `create`, `validate`, `delete`                                                                |
| `workos org-domain`   | `get`, `create`, `verify`, `delete`                                                                   |

### Workflow Commands

| Command                       | Purpose                                     |
| ----------------------------- | ------------------------------------------- |
| `workos seed --file=<yaml>`   | Declarative resource provisioning from YAML |
| `workos seed --clean`         | Tear down seeded resources                  |
| `workos setup-org <name>`     | One-shot org onboarding                     |
| `workos onboard-user <email>` | Send invitation + optional wait             |
| `workos debug-sso <connId>`   | SSO connection diagnostics                  |
| `workos debug-sync <dirId>`   | Directory sync diagnostics                  |

### Common Flags

| Flag                                        | Purpose                  | Scope                                               |
| ------------------------------------------- | ------------------------ | --------------------------------------------------- |
| `--json`                                    | Structured JSON output   | All commands                                        |
| `--api-key`                                 | Override API key         | Resource commands                                   |
| `--org`                                     | Organization scope       | role, membership, invitation, api-key, feature-flag |
| `--force`                                   | Skip confirmation prompt | connection delete, directory delete                 |
| `--limit`, `--before`, `--after`, `--order` | Pagination               | All list commands                                   |

## Dashboard-Only Operations

These CANNOT be done from the CLI — tell the user to visit the WorkOS Dashboard:

- **Enable/disable auth methods** — Dashboard > Authentication
- **Configure session lifetime** — Dashboard > Authentication > Sessions
- **Set up social login providers** (Google, GitHub, etc.) — Dashboard > Authentication > Social
- **Create feature flags** — Dashboard > Feature Flags (toggle/target operations work via CLI)
- **Configure branding** (logos, colors) — Dashboard > Branding
- **Set up email templates** — Dashboard > Email
- **Manage billing/plan** — Dashboard > Settings > Billing
