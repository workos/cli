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

- **5 Framework Support:** Next.js, React Router, TanStack Start, React SPA, Vanilla JS
- **AI-Powered:** Uses Claude to intelligently adapt to your project structure
- **Security-First:** Masks API keys, redacts from logs, saves to .env.local
- **Smart Detection:** Auto-detects framework, package manager, router type
- **Live Documentation:** Fetches latest SDK docs from WorkOS and GitHub
- **Full Integration:** Creates routes, middleware, environment vars, and UI

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
  dashboard              Run installer with visual TUI dashboard (experimental)
  login                  Authenticate with WorkOS via Connect OAuth device flow
  logout                 Remove stored credentials
  env                    Manage environment configurations
  organization           Manage organizations
  user                   Manage users
  doctor                 Diagnose WorkOS integration issues
  install-skill          Install AuthKit skills to coding agents
```

### Environment Management

```bash
workos env add [name] [apiKey]   # Add environment (interactive if no args)
workos env remove <name>         # Remove an environment
workos env switch [name]         # Switch active environment
workos env list                  # List environments with active indicator
```

API keys are stored in the system keychain via `@napi-rs/keyring`, with a JSON file fallback at `~/.workos/config.json`.

### Organization Management

```bash
workos organization create <name> [domain:state ...]
workos organization update <orgId> <name> [domain] [state]
workos organization get <orgId>
workos organization list [--domain] [--limit] [--before] [--after] [--order]
workos organization delete <orgId>
```

### User Management

```bash
workos user get <userId>
workos user list [--email] [--organization] [--limit] [--before] [--after] [--order]
workos user update <userId> [--first-name] [--last-name] [--email-verified] [--password] [--external-id]
workos user delete <userId>
```

Management commands resolve API keys via: `WORKOS_API_KEY` env var → `--api-key` flag → active environment's stored key.

### Installer Options

```bash
workos install [options]

  --direct, -D            Use your own Anthropic API key (bypass llm-gateway)
  --integration <name>    Framework: nextjs, react, react-router, tanstack-start, vanilla-js
  --redirect-uri <uri>    Custom redirect URI
  --homepage-url <url>    Custom homepage URL
  --install-dir <path>    Installation directory
  --no-validate           Skip post-installation validation
  --force-install         Force install packages even if peer dependency checks fail
  --debug                 Enable verbose logging
```

## Examples

```bash
# Interactive (recommended)
npx workos

# Specify framework
npx workos --integration react-router

# With visual dashboard (experimental)
npx workos dashboard
```

## Authentication

The CLI uses WorkOS Connect OAuth device flow for authentication:

```bash
# Login (opens browser for authentication)
workos login

# Logout (clears stored credentials)
workos logout
```

OAuth credentials are stored in the system keychain (with `~/.workos/credentials.json` fallback). Access tokens are not persisted long-term for security - users re-authenticate when tokens expire.

## How It Works

1. **Detects** your framework and project structure
2. **Prompts** for WorkOS credentials (API key masked)
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
