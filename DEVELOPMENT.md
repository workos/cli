# Development Guide

## Project Structure

```
installer/
├── src/
│   ├── bin.ts                # CLI entry point
│   ├── cli.config.ts         # App configuration (model, URLs)
│   ├── run.ts                # Entry point
│   ├── lib/
│   │   ├── agent-runner.ts       # Core agent execution
│   │   ├── agent-interface.ts    # SDK interface
│   │   ├── installer-core.ts     # Headless installer core
│   │   ├── config.ts             # Framework detection config
│   │   ├── framework-config.ts   # Framework definitions
│   │   ├── constants.ts          # Integration types
│   │   ├── events.ts             # InstallerEventEmitter
│   │   ├── credential-proxy.ts   # Token refresh proxy for long sessions
│   │   ├── ensure-auth.ts        # Startup auth guard
│   │   ├── background-refresh.ts # Background token refresh
│   │   └── adapters/             # CLI and dashboard adapters
│   ├── commands/                 # Subcommands (install-skill, login, logout)
│   ├── steps/                    # Installer step implementations
│   ├── dashboard/                # Ink/React TUI components
│   ├── nextjs/                   # Next.js installer agent
│   ├── react/                    # React SPA installer agent
│   ├── react-router/             # React Router installer agent
│   ├── tanstack-start/           # TanStack Start installer agent
│   ├── vanilla-js/               # Vanilla JS installer agent
│   └── utils/
│       ├── clack-utils.ts        # CLI prompts
│       ├── debug.ts              # Logging with redaction
│       ├── redact.ts             # Credential redaction
│       ├── package-manager.ts    # Package manager detection
│       └── ...                   # Additional utilities
├── tsconfig.json             # TypeScript config
└── package.json              # Dependencies and scripts
```

## Setup

```bash
# Install dependencies
pnpm install

# Build
pnpm build
```

## Development Workflow

```bash
# Build, link globally, and watch for changes
pnpm dev

# Test locally in another project
cd /path/to/test/nextjs-app
workos dashboard
```

## Commands

```bash
# Build
pnpm build

# Clean and rebuild
pnpm clean && pnpm build

# Format code
pnpm format

# Check types
pnpm typecheck

# Run tests
pnpm test
pnpm test:watch
```

## TypeScript Configuration

- **Target:** ES2022
- **Module:** NodeNext (ESM)
- **Strict mode** enabled
- **JSX:** react-jsx (for Ink/React dashboard)

## Making Changes

### Adding a New Framework

1. Create `src/your-framework/your-framework-installer-agent.ts`
2. Define `FrameworkConfig` with metadata, detection, environment, UI
3. Export `runYourFrameworkInstallerAgent(options)` function
4. Add to `Integration` enum in `lib/constants.ts`
5. Add detection logic to `lib/config.ts`
6. Wire up in `run.ts`

See `nextjs/nextjs-installer-agent.ts` as reference.

### Updating Integration Instructions

The installer prompt in `agent-runner.ts` tells Claude to:

1. Fetch live docs from workos.com
2. Fetch SDK README from GitHub/npm
3. Follow official documentation

To change instructions, edit `buildIntegrationPrompt()` in `lib/agent-runner.ts`.

### Adding Security Features

Credential redaction is in `utils/redact.ts`. Add patterns:

```typescript
export function redactCredentials(obj: any): any {
  // Add new patterns here
  const redacted = JSON.stringify(obj).replace(/sk_test_[a-zA-Z0-9]+/g, (match) => `sk_test_...${match.slice(-3)}`);
  return JSON.parse(redacted);
}
```

## Testing

**Manual testing:**

1. Run installer in a test app: `workos dashboard`
2. Check logs at `~/.workos/logs/workos-{timestamp}.log`
3. Verify integration works in test app

**What to test:**

- Framework detection
- API key masking (should show `*****`)
- Log redaction (keys show as `sk_test_...X6Y`)
- SDK installation
- File creation
- Environment variables
- UI components

## Debugging

**Verbose logs:**

```bash
workos --debug
```

**Check logs:**

```bash
tail -f ~/.workos/logs/workos-{timestamp}.log
```

## Questions?

See [README](./README.md) for user-facing docs.
