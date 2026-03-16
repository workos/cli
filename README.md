# workos

WorkOS CLI for installing AuthKit integrations and managing WorkOS resources.

## Installation

```bash
# Run directly with npx (recommended)
npx workos

# Or install globally
npm install -g workos
workos
```

## Features

- **15 Framework Support:** Next.js, React Router, TanStack Start, React SPA, Vanilla JS, SvelteKit, Node.js (Express), Python (Django), Ruby (Rails), Go, .NET (ASP.NET Core), Kotlin (Spring Boot), Elixir (Phoenix), PHP (Laravel), PHP
- **AI-Powered:** Uses Claude to intelligently adapt to your project structure
- **Security-First:** Masks API keys, redacts from logs, saves to .env.local
- **Smart Detection:** Auto-detects framework, package manager, router type
- **Live Documentation:** Fetches latest SDK docs from WorkOS and GitHub
- **Full Integration:** Creates routes, middleware, environment vars, and UI
- **Agent & CI Ready:** Non-TTY auto-detection, JSON output, structured errors, headless installer with NDJSON streaming

## What It Creates

Depending on your framework, the installer creates:

- ✅ Authentication routes (callback, sign-in, sign-out)
- ✅ Middleware for route protection
- ✅ Environment variable configuration
- ✅ SDK installation with correct package manager
- ✅ UI components showing login status
- ✅ User info display (name, email)

## Credentials

Get your credentials from [dashboard.workos.com](https://dashboard.workos.com):

- **API Key** (sk_test_xxx or sk_live_xxx) - For server-side frameworks only
- **Client ID** (client_xxx) - Required for all frameworks

**Security:** API keys are masked during input and redacted in logs.

## CLI Options

```bash
workos [command]

Commands:
  install                Install WorkOS AuthKit into your project
  auth                   Manage authentication (login, logout, status)
  env                    Manage environment configurations (add, remove, switch, list, claim)
  doctor                 Diagnose WorkOS integration issues
  skills                 Manage WorkOS skills for coding agents (install, uninstall, list)

Resource Management:
  organization (org)     Manage organizations
  user                   Manage users
  role                   Manage roles (RBAC)
  permission             Manage permissions (RBAC)
  membership             Manage organization memberships
  invitation             Manage user invitations
  session                Manage user sessions
  connection             Manage SSO connections
  directory              Manage directory sync
  event                  Query events
  audit-log              Manage audit logs
  feature-flag           Manage feature flags
  webhook                Manage webhooks
  config                 Manage redirect URIs, CORS, homepage URL
  portal                 Generate Admin Portal links
  vault                  Manage encrypted secrets
  api-key                Manage per-org API keys
  org-domain             Manage organization domains

Workflows:
  seed                   Declarative resource provisioning from YAML
  setup-org              One-shot organization onboarding
  onboard-user           Send invitation and assign role
  debug-sso              Diagnose SSO connection issues
  debug-sync             Diagnose directory sync issues
```

All management commands support `--json` for structured output (auto-enabled in non-TTY) and `--api-key` to override the active environment's key.

### Unclaimed Environments

When you run `workos install` without credentials, the CLI automatically provisions a temporary WorkOS environment — no account needed. This lets you try AuthKit immediately.

```bash
# Install with zero setup — environment provisioned automatically
workos install

# Check your environment
workos env list
# Shows: unclaimed (unclaimed) ← active

# Claim the environment to link it to your WorkOS account
workos env claim
```

Management commands work on unclaimed environments with a warning reminding you to claim.

### Workflows

The compound workflow commands compose multiple API calls into common operations. These are the highest-value commands for both developers and AI agents.

#### seed — Declarative resource provisioning

Provision permissions, roles, organizations, and config from a YAML file. Tracks created resources for clean teardown.

```bash
# Apply a seed file
workos seed --file workos-seed.yml

# Tear down everything the seed created (reads .workos-seed-state.json)
workos seed --clean
```

Example `workos-seed.yml`:

```yaml
permissions:
  - name: Read Posts
    slug: posts:read
  - name: Write Posts
    slug: posts:write

roles:
  - name: Editor
    slug: editor
    permissions: [posts:read, posts:write]
  - name: Viewer
    slug: viewer
    permissions: [posts:read]

organizations:
  - name: Acme Corp
    domains: [acme.com]

config:
  redirect_uris:
    - http://localhost:3000/callback
  cors_origins:
    - http://localhost:3000
  homepage_url: http://localhost:3000
```

Resources are created in dependency order (permissions → roles → organizations → config). State is tracked in `.workos-seed-state.json` so `--clean` removes exactly what was created.

#### setup-org — One-shot organization onboarding

Creates an organization with optional domain verification, roles, and an Admin Portal link in a single command.

```bash
# Minimal: just create the org
workos setup-org "Acme Corp"

# Full: org + domain + roles + portal link
workos setup-org "Acme Corp" --domain acme.com --roles admin,viewer
```

#### onboard-user — User invitation workflow

Sends an invitation to a user with an optional role assignment. With `--wait`, polls until the invitation is accepted.

```bash
# Send invitation
workos onboard-user alice@acme.com --org org_01ABC123

# Send with role and wait for acceptance
workos onboard-user alice@acme.com --org org_01ABC123 --role admin --wait
```

#### debug-sso — SSO connection diagnostics

Inspects an SSO connection's state and recent authentication events. Flags inactive connections and surfaces auth event history for debugging.

```bash
workos debug-sso conn_01ABC123
```

#### debug-sync — Directory sync diagnostics

Inspects a directory's sync state, user/group counts, recent events, and detects stalled syncs.

```bash
workos debug-sync directory_01ABC123
```

### Environment Management

```bash
workos env add [name] [apiKey]   # Add environment (interactive if no args)
workos env remove <name>         # Remove an environment
workos env switch [name]         # Switch active environment
workos env list                  # List environments with active indicator
```

API keys are stored in the system keychain via `@napi-rs/keyring`, with a JSON file fallback at `~/.workos/config.json`.

### Resource Management

All resource commands follow the same pattern: `workos <resource> <action> [args] [--options]`. API keys resolve via: `WORKOS_API_KEY` env var → `--api-key` flag → active environment's stored key.

#### organization

```bash
workos organization create <name> [domain:state ...]
workos organization update <orgId> <name> [domain] [state]
workos organization get <orgId>
workos organization list [--domain] [--limit] [--before] [--after] [--order]
workos organization delete <orgId>
```

#### user

```bash
workos user get <userId>
workos user list [--email] [--organization] [--limit]
workos user update <userId> [--first-name] [--last-name] [--email-verified] [--password] [--external-id]
workos user delete <userId>
```

#### role

```bash
workos role list [--org <orgId>]
workos role get <slug> [--org <orgId>]
workos role create --slug <slug> --name <name> [--org <orgId>]
workos role update <slug> [--name] [--description] [--org <orgId>]
workos role delete <slug> --org <orgId>
workos role set-permissions <slug> --permissions <slugs> [--org <orgId>]
workos role add-permission <slug> <permissionSlug> [--org <orgId>]
workos role remove-permission <slug> <permissionSlug> --org <orgId>
```

#### permission

```bash
workos permission list [--limit]
workos permission get <slug>
workos permission create --slug <slug> --name <name> [--description]
workos permission update <slug> [--name] [--description]
workos permission delete <slug>
```

#### membership

```bash
workos membership list [--org] [--user] [--limit]
workos membership get <id>
workos membership create --org <orgId> --user <userId> [--role]
workos membership update <id> [--role]
workos membership delete <id>
workos membership deactivate <id>
workos membership reactivate <id>
```

#### invitation

```bash
workos invitation list [--org] [--email] [--limit]
workos invitation get <id>
workos invitation send --email <email> [--org] [--role] [--expires-in-days]
workos invitation revoke <id>
workos invitation resend <id>
```

#### session

```bash
workos session list <userId> [--limit]
workos session revoke <sessionId>
```

#### connection

```bash
workos connection list [--org] [--type] [--limit]
workos connection get <id>
workos connection delete <id> [--force]
```

#### directory

```bash
workos directory list [--org] [--limit]
workos directory get <id>
workos directory delete <id> [--force]
workos directory list-users [--directory] [--group] [--limit]
workos directory list-groups --directory <id> [--limit]
```

#### event

```bash
workos event list --events <types> [--org] [--range-start] [--range-end] [--limit]
```

#### audit-log

```bash
workos audit-log create-event <orgId> --action <action> --actor-type <type> --actor-id <id> [--file <json>]
workos audit-log export --org <orgId> --range-start <date> --range-end <date> [--actions] [--actor-names]
workos audit-log list-actions
workos audit-log get-schema <action>
workos audit-log create-schema <action> --file <schema.json>
workos audit-log get-retention <orgId>
```

#### feature-flag

```bash
workos feature-flag list [--limit]
workos feature-flag get <slug>
workos feature-flag enable <slug>
workos feature-flag disable <slug>
workos feature-flag add-target <slug> <targetId>
workos feature-flag remove-target <slug> <targetId>
```

#### webhook

```bash
workos webhook list
workos webhook create --url <endpoint> --events <types>
workos webhook delete <id>
```

#### config

```bash
workos config redirect add <uri>
workos config cors add <origin>
workos config homepage-url set <url>
```

#### portal

```bash
workos portal generate-link --intent <intent> --org <orgId> [--return-url] [--success-url]
```

#### vault

```bash
workos vault list [--limit]
workos vault get <id>
workos vault get-by-name <name>
workos vault create --name <name> --value <secret> [--org <orgId>]
workos vault update <id> --value <secret> [--version-check]
workos vault delete <id>
workos vault describe <id>
workos vault list-versions <id>
```

#### api-key

```bash
workos api-key list --org <orgId> [--limit]
workos api-key create --org <orgId> --name <name> [--permissions]
workos api-key validate <value>
workos api-key delete <id>
```

#### org-domain

```bash
workos org-domain get <id>
workos org-domain create <domain> --org <orgId>
workos org-domain verify <id>
workos org-domain delete <id>
```

### Installer Options

```bash
workos install [options]

  --direct, -D            Use your own Anthropic API key (bypass llm-gateway)
  --integration <name>    Framework: nextjs, react, react-router, tanstack-start, vanilla-js, sveltekit, node, python, ruby, go, dotnet, kotlin, elixir, php-laravel, php
  --api-key <key>         WorkOS API key (required in non-interactive mode)
  --client-id <id>        WorkOS client ID (required in non-interactive mode)
  --redirect-uri <uri>    Custom redirect URI
  --homepage-url <url>    Custom homepage URL
  --install-dir <path>    Installation directory
  --no-validate           Skip post-installation validation
  --no-branch             Skip branch creation (use current branch)
  --no-commit             Skip auto-commit after installation
  --create-pr             Auto-create pull request after installation
  --no-git-check          Skip git dirty working tree check
  --force-install         Force install packages even if peer dependency checks fail
  --debug                 Enable verbose logging
```

## Examples

```bash
# Interactive (recommended)
npx workos

# Specify framework
npx workos install --integration react-router

# With visual dashboard (experimental)
npx workos dashboard

# JSON output (explicit)
workos org list --json --api-key sk_test_xxx

# Pipe-friendly (auto-detects non-TTY)
workos org list --api-key sk_test_xxx | jq '.data[].name'

# Machine-readable command discovery
workos --help --json | jq '.commands[].name'
```

## Scripting & Automation

The CLI auto-detects non-TTY environments (piped output, CI, coding agents) and switches to machine-friendly behavior. No flags required — just pipe it.

### JSON Output

All commands produce structured JSON when piped or with `--json`:

```bash
workos org list --api-key sk_test_xxx | jq .
# → { "data": [...], "list_metadata": { "before": null, "after": "..." } }

workos env list --json
# → { "data": [{ "name": "prod", "type": "production", "active": true, ... }] }
```

Errors go to stderr as structured JSON:

```bash
workos org list 2>&1
# → { "error": { "code": "no_api_key", "message": "No API key configured..." } }
```

### Headless Installer

In non-TTY, the installer streams progress as NDJSON (one JSON object per line):

```bash
workos install --api-key sk_test_xxx --client-id client_xxx --no-commit 2>/dev/null
# → {"type":"detection:complete","integration":"nextjs","timestamp":"..."}
# → {"type":"agent:start","timestamp":"..."}
# → {"type":"agent:progress","message":"...","timestamp":"..."}
# → {"type":"complete","success":true,"timestamp":"..."}
```

### Exit Codes

| Code | Meaning                 |
| ---- | ----------------------- |
| 0    | Success                 |
| 1    | General error           |
| 2    | Cancelled               |
| 4    | Authentication required |

### Environment Variables

| Variable                 | Effect                                                   |
| ------------------------ | -------------------------------------------------------- |
| `WORKOS_API_KEY`         | API key for management commands (bypasses stored config) |
| `WORKOS_NO_PROMPT=1`     | Force non-interactive mode + JSON output                 |
| `WORKOS_FORCE_TTY=1`     | Force interactive mode even when piped                   |
| `WORKOS_TELEMETRY=false` | Disable telemetry                                        |

### Command Discovery

Agents can introspect available commands:

```bash
workos --help --json              # Full command tree
workos env --help --json          # Subcommand tree
workos organization --help --json # With positionals and option types
```

## Authentication

The CLI uses WorkOS Connect OAuth device flow for authentication:

```bash
# Login (opens browser for authentication)
workos auth login

# Check current auth status
workos auth status

# Logout (clears stored credentials)
workos auth logout
```

OAuth credentials are stored in the system keychain (with `~/.workos/credentials.json` fallback). Access tokens are not persisted long-term for security - users re-authenticate when tokens expire.

## How It Works

1. **Detects** your framework and project structure
2. **Resolves credentials** — uses existing config, or auto-provisions an unclaimed environment if none found
3. **Auto-configures** WorkOS dashboard (redirect URI, CORS, homepage URL)
4. **Fetches** latest SDK documentation from workos.com
5. **Uses AI** (Claude) to generate integration code
6. **Installs** SDK with detected package manager
7. **Creates** auth routes, middleware, and UI
8. **Configures** environment variables securely

## Telemetry

The installer collects anonymous usage telemetry to help improve the product:

- Session outcome (success/error/cancelled)
- Framework detected
- Duration and step timing
- Token usage (for capacity planning)

No code, credentials, or personal data is collected. Disable with:

```bash
WORKOS_TELEMETRY=false npx workos
```

## Logs

Detailed logs (with redacted credentials) are saved to:

```
~/.workos/logs/workos-{timestamp}.log
```

Up to 10 session log files are retained. Use `--debug` flag for verbose terminal output.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for development setup.

Build:

```bash
pnpm build
```

Run locally:

```bash
pnpm dev  # Watch mode
./dist/bin.js --help
```

## License

MIT © WorkOS
