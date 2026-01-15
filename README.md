# WorkOS AuthKit Wizard

AI-powered CLI wizard that automatically integrates WorkOS AuthKit into your application.

## Quick Start

```bash
npx @workos/authkit-wizard
```

The wizard will:
- ✅ Auto-detect your framework (Next.js, React, React Router, TanStack Start, Vanilla JS)
- ✅ Install the appropriate AuthKit SDK
- ✅ Create authentication routes and middleware
- ✅ Set up environment variables
- ✅ Add UI showing login/logout status
- ✅ Use AI to adapt to your project structure

## Supported Frameworks

| Framework | Package | Server/Client |
|-----------|---------|---------------|
| **Next.js** | `@workos-inc/authkit-nextjs` | Server + Client |
| **React Router** | `@workos-inc/authkit-react-router` | Server + Client |
| **TanStack Start** | `@workos-inc/authkit-tanstack-start` | Server + Client |
| **React (SPA)** | `@workos-inc/authkit-react` | Client-only |
| **Vanilla JS** | `@workos-inc/authkit-js` | Client-only |

## Usage

### Interactive Mode

```bash
# Auto-detect framework
npx @workos/authkit-wizard

# Or specify framework
npx @workos/authkit-wizard --integration nextjs
```

The wizard will prompt for:
- **WorkOS API Key** (hidden for security) - Only for server-side frameworks
- **WorkOS Client ID** - Required for all frameworks

### CI Mode

```bash
npx @workos/authkit-wizard \
  --ci \
  --integration nextjs \
  --api-key $WORKOS_API_KEY \
  --client-id $WORKOS_CLIENT_ID \
  --install-dir .
```

## Options

| Flag | Description | Env Var |
|------|-------------|---------|
| `--integration` | Framework to set up (nextjs, react, etc.) | `WORKOS_WIZARD_INTEGRATION` |
| `--api-key` | WorkOS API key (sk_xxx) | `WORKOS_WIZARD_API_KEY` |
| `--client-id` | WorkOS Client ID (client_xxx) | `WORKOS_WIZARD_CLIENT_ID` |
| `--ci` | Non-interactive mode for CI/CD | `WORKOS_WIZARD_CI` |
| `--install-dir` | Directory to install in | `WORKOS_WIZARD_INSTALL_DIR` |
| `--debug` | Enable verbose logging | `WORKOS_WIZARD_DEBUG` |
| `--default` | Use defaults for all prompts | `WORKOS_WIZARD_DEFAULT` |
| `--local` | Use local services (for development) | `WORKOS_WIZARD_LOCAL` |

## What Gets Created

The wizard creates:

### For Next.js (App Router)
- `app/callback/route.ts` - OAuth callback handler
- `app/auth/sign-in/route.ts` - Sign-in redirect
- `app/auth/sign-out/route.ts` - Sign-out handler
- `middleware.ts` - Route protection with `withAuth()`
- `.env.local` - Environment variables
- Updated `app/layout.tsx` or `app/page.tsx` - Login/logout UI

### For React Router
- Authentication routes and components
- Session management
- Protected route wrappers
- Login/logout UI

### For Client-Only (React, Vanilla JS)
- Client-side authentication setup
- Login/logout components
- Session handling

## Security

- **API keys are masked** - Input is hidden in terminal (shows `*****`)
- **Logs are redacted** - Keys show as `sk_test_...X6Y` in `/tmp/authkit-wizard.log`
- **Saved to .env.local** - Not committed to git

## Get Your Credentials

1. Visit [dashboard.workos.com](https://dashboard.workos.com)
2. Create an application or use existing
3. Copy your **API Key** (starts with `sk_test_` or `sk_live_`)
4. Copy your **Client ID** (starts with `client_`)

## Development

This is a PNPM monorepo with 2 packages:

- **`packages/cli/`** - The CLI wizard
- **`packages/llm-gateway/`** - LLM API proxy for local testing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for development setup.

## Architecture

### Local Development

```bash
# Terminal 1: Start LLM Gateway
cd packages/llm-gateway
export ANTHROPIC_API_KEY=sk-ant-...
pnpm dev

# Terminal 2: Run wizard in your app
cd /path/to/your/app
~/path/to/wizard/dist/bin.js --local
```

## Support

- **Docs:** [workos.com/docs/user-management/authkit](https://workos.com/docs/user-management/authkit)

## License

MIT © WorkOS
