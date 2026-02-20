# workos CLI

WorkOS CLI for installing AuthKit integrations and managing WorkOS resources (organizations, users, environments).

## Project Structure

```
src/
├── bin.ts                    # CLI entry point (yargs command routing)
├── cli.config.ts             # App configuration (model, URLs, etc.)
├── run.ts                    # Installer orchestration entry point
├── lib/
│   ├── agent-interface.ts    # Claude Agent SDK integration
│   ├── agent-runner.ts       # Builds prompts, runs agent
│   ├── config.ts             # Framework detection config
│   ├── constants.ts          # Integration enum, shared constants
│   ├── credential-store.ts   # OAuth credential storage (keyring + file fallback)
│   ├── config-store.ts       # Environment config storage (keyring + file fallback)
│   ├── api-key.ts            # API key resolution (env var → flag → config)
│   ├── workos-api.ts         # Generic WorkOS REST API client
│   ├── credential-proxy.ts   # Token refresh proxy for long sessions
│   └── ensure-auth.ts        # Startup auth guard with token refresh
├── commands/
│   ├── env.ts                # workos env (add/remove/switch/list)
│   ├── organization.ts       # workos organization (create/update/get/list/delete)
│   ├── user.ts               # workos user (get/list/update/delete)
│   ├── install.ts            # workos install
│   └── login.ts / logout.ts  # Auth commands
├── dashboard/                # Ink/React TUI components
├── nextjs/                   # Next.js installer agent
├── react/                    # React SPA installer agent
├── react-router/             # React Router installer agent
├── tanstack-start/           # TanStack Start installer agent
├── vanilla-js/               # Vanilla JS installer agent
└── utils/
    └── table.ts              # Terminal table formatter
```

## Key Architecture

- **Claude Agent SDK**: Uses `@anthropic-ai/claude-agent-sdk` to run Claude as an agent with tool access
- **Event Emitter**: `InstallerEventEmitter` bridges agent execution ↔ TUI for real-time updates
- **Framework Detection**: Each integration has a `detect()` function in `config.ts`
- **Permission Hook**: `installerCanUseTool()` in `agent-interface.ts` restricts Bash to safe commands only
- **Config Store**: `config-store.ts` stores environment configs (API keys, endpoints) in system keyring with file fallback
- **WorkOS API Client**: `workos-api.ts` is a generic fetch wrapper for any WorkOS REST endpoint

## CLI Modes

The installer supports two invocation modes:

### Regular CLI (default)

```bash
workos install
```

Streaming text output directly to terminal. Simple, lightweight, good for CI/scripts.

### TUI Dashboard (subcommand)

```bash
workos dashboard
```

Interactive Ink/React interface with real-time panels for:

- Agent thinking/reasoning
- File changes being made
- Tool execution status
- Progress indicators

The dashboard code lives in `src/dashboard/` and uses `InstallerEventEmitter` to receive updates from the agent.

## Tech Constraints

- **pnpm** only (not npm/yarn)
- **ESM** only - never use `require()`, `__dirname`, or CJS exports
- **Strict TypeScript** - no `as any`, proper typing required
- **No node-specific APIs** (crypto, fs sync, etc.) unless necessary
- **Ink + React 19** for TUI dashboard
- **Never commit the `docs/` directory** - it contains local ideation artifacts

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) - release-please auto-generates changelog from these.

```
feat: add new feature        → minor version bump, appears in changelog
fix: correct bug             → patch version bump, appears in changelog
docs: update readme          → no version bump
chore: update deps           → no version bump
refactor: restructure code   → no version bump
refactor!: breaking change   → major version bump (or minor if pre-1.0)
```

Breaking changes: add `!` after type (e.g., `feat!:`) or include `BREAKING CHANGE:` in body.

## Commands

```bash
pnpm build        # Build the project
pnpm dev          # Dev mode (build + watch + link)
pnpm test         # Run tests
pnpm typecheck    # Type check
```

## Testing

```bash
# Run installer in a test project
cd /path/to/test-app && workos dashboard

# Test management commands
workos env add sandbox sk_test_xxx
workos organization list
workos user list
```

## Adding a New Framework

1. Create `src/{framework}/{framework}-installer-agent.ts`
2. Add to `Integration` enum in `lib/constants.ts`
3. Add detection logic in `lib/config.ts`
4. Wire up in `run.ts` switch statement

## Adding a New Resource Command

1. Create `src/commands/{resource}.ts` with command handlers (uses `workos-api.ts`)
2. Create `src/commands/{resource}.spec.ts` with mocked API tests
3. Register in `src/bin.ts` as a yargs command group with subcommands
4. Commands use `resolveApiKey()` from `api-key.ts` for auth
