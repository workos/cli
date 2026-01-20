# @workos/authkit-wizard

AI-powered CLI that automatically integrates WorkOS AuthKit into web applications.

## Installation

```bash
# Run directly with npx (recommended)
npx @workos/authkit-wizard

# Or install globally
npm install -g @workos/authkit-wizard
authkit-wizard
```

## Features

- **5 Framework Support:** Next.js, React Router, TanStack Start, React SPA, Vanilla JS
- **AI-Powered:** Uses Claude to intelligently adapt to your project structure
- **Security-First:** Masks API keys, redacts from logs, saves to .env.local
- **Smart Detection:** Auto-detects framework, package manager, router type
- **Live Documentation:** Fetches latest SDK docs from WorkOS and GitHub
- **Full Integration:** Creates routes, middleware, environment vars, and UI

## What It Creates

Depending on your framework, the wizard creates:

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
authkit-wizard [options] [command]

Commands:
  dashboard              Run wizard with visual TUI dashboard (experimental)
  login                  Authenticate with WorkOS
  logout                 Remove stored credentials
  install-skill          Install AuthKit skills to coding agents (Claude Code, Codex, etc.)

Options:
  --integration <name>    Framework: nextjs, react, react-router, tanstack-start, vanilla-js
  --api-key <key>         WorkOS API key (masked in terminal)
  --client-id <id>        WorkOS Client ID
  --redirect-uri <uri>    Custom redirect URI (defaults to framework convention)
  --homepage-url <url>    Custom homepage URL (defaults to http://localhost:{port})
  --ci                    Non-interactive CI mode
  --install-dir <path>    Installation directory
  --debug                 Verbose logging to /tmp/authkit-wizard.log
  --local                 Use local LLM gateway (development only)
  --default               Use default options for all prompts (default: true)
  --skip-auth             Skip authentication check (requires --local)
```

## Examples

```bash
# Interactive (recommended)
npx @workos/authkit-wizard

# Specify framework
npx @workos/authkit-wizard --integration react-router

# CI mode
npx @workos/authkit-wizard --ci \
  --integration nextjs \
  --api-key $WORKOS_API_KEY \
  --client-id $WORKOS_CLIENT_ID
```

## How It Works

1. **Detects** your framework and project structure
2. **Prompts** for WorkOS credentials (API key masked)
3. **Auto-configures** WorkOS dashboard (redirect URI, CORS, homepage URL)
4. **Fetches** latest SDK documentation from workos.com
5. **Uses AI** (Claude) to generate integration code
6. **Installs** SDK with detected package manager
7. **Creates** auth routes, middleware, and UI
8. **Configures** environment variables securely

## Logs

Detailed logs (with redacted credentials) are saved to:

```
/tmp/authkit-wizard.log
```

Use `--debug` flag for verbose terminal output.

## Development

See the [monorepo root README](../../README.md) for development setup.

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
