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
│   ├── api-error-handler.ts  # Shared WorkOS API error handler factory
│   ├── config.ts             # Framework detection config
│   ├── constants.ts          # Integration enum, shared constants
│   ├── credential-store.ts   # OAuth credential storage (keyring + file fallback)
│   ├── config-store.ts       # Environment config storage (keyring + file fallback)
│   ├── api-key.ts            # API key resolution (env var → flag → config)
│   ├── workos-api.ts         # Generic WorkOS REST API client
│   ├── credential-proxy.ts   # Token refresh proxy for long sessions
│   ├── ensure-auth.ts        # Startup auth guard with token refresh
│   └── adapters/
│       ├── cli-adapter.ts    # Interactive terminal adapter (clack prompts)
│       ├── dashboard-adapter.ts  # Ink/React TUI adapter
│       └── headless-adapter.ts   # Non-interactive adapter (NDJSON streaming)
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
    ├── output.ts             # Output mode system (JSON/human, structured errors)
    ├── exit-codes.ts         # Standardized exit codes (0, 1, 2, 4)
    ├── ndjson.ts             # NDJSON writer for headless installer streaming
    ├── help-json.ts          # Machine-readable command tree (--help --json)
    ├── environment.ts        # TTY/non-interactive detection
    └── table.ts              # Terminal table formatter
```

## Key Architecture

- **Claude Agent SDK**: Uses `@anthropic-ai/claude-agent-sdk` to run Claude as an agent with tool access
- **Event Emitter**: `InstallerEventEmitter` bridges agent execution ↔ adapters for real-time updates
- **Adapter Pattern**: Three adapters (CLI, Dashboard, Headless) subscribe to the same state machine events. Selected automatically based on TTY detection.
- **Output Mode**: `OutputMode` (`human`/`json`) resolved once at startup in `bin.ts`. Drives all formatting via `output.ts` helpers.
- **Framework Detection**: Each integration has a `detect()` function in `config.ts`
- **Permission Hook**: `installerCanUseTool()` in `agent-interface.ts` restricts Bash to safe commands only
- **Config Store**: `config-store.ts` stores environment configs (API keys, endpoints) in system keyring with file fallback
- **WorkOS API Client**: `workos-api.ts` is a generic fetch wrapper for any WorkOS REST endpoint
- **API Error Handler**: `api-error-handler.ts` provides `createApiErrorHandler(resourceName)` factory for consistent structured errors across commands

## CLI Modes

The installer supports three invocation modes, selected automatically:

### Regular CLI (default, TTY)

```bash
workos install
```

Interactive clack prompts, colored output, spinners. Default for humans in a terminal.

### TUI Dashboard

```bash
workos dashboard
```

Interactive Ink/React interface with real-time panels. Code in `src/dashboard/`.

### Headless (non-TTY, auto-detected)

```bash
echo '' | workos install --api-key sk_test_xxx --client-id client_xxx
```

Non-interactive adapter with NDJSON streaming to stdout. Auto-selected when no TTY detected or `WORKOS_NO_PROMPT=1`. All decisions auto-resolved with sensible defaults. Flag overrides: `--no-branch`, `--no-commit`, `--create-pr`, `--no-git-check`.

### Non-TTY Behavior

- **Output**: Auto-switches to JSON when piped or `--json` flag. `WORKOS_FORCE_TTY=1` overrides.
- **Auth**: Exits code 4 instead of opening browser. Requires prior `workos login` or `WORKOS_API_KEY` env var.
- **Errors**: Structured JSON to stderr: `{ "error": { "code": "...", "message": "..." } }`
- **Exit codes**: 0=success, 1=error, 2=cancelled, 4=auth required (follows `gh` CLI convention)
- **Help**: `--help --json` outputs machine-readable command tree

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
2. Use `createApiErrorHandler('{Resource}')` from `lib/api-error-handler.ts` for error handling
3. Use `outputSuccess()`, `outputJson()`, `isJsonMode()` from `utils/output.ts` for output
4. Create `src/commands/{resource}.spec.ts` with mocked API tests (include JSON mode tests)
5. Register in `src/bin.ts` as a yargs command group with subcommands
6. Update `src/utils/help-json.ts` command registry to include the new command
7. Commands use `resolveApiKey()` from `api-key.ts` for auth
