# Development Guide

## Project Structure

```
src/
├── bin.ts                    # CLI entry point (yargs command routing)
├── cli.config.ts             # App configuration (model, URLs)
├── run.ts                    # Installer orchestration entry point
├── lib/
│   ├── agent-runner.ts       # Core agent execution
│   ├── agent-interface.ts    # Claude Agent SDK interface
│   ├── installer-core.ts     # Headless installer core (XState)
│   ├── config.ts             # Framework detection config
│   ├── constants.ts          # Integration types, shared constants
│   ├── credential-store.ts   # OAuth credential storage (keyring + file fallback)
│   ├── config-store.ts       # Environment config storage (keyring + file fallback)
│   ├── api-key.ts            # API key resolution (env var → flag → config)
│   ├── workos-api.ts         # Generic WorkOS REST API client
│   ├── credential-proxy.ts   # Token refresh proxy for long sessions
│   ├── ensure-auth.ts        # Startup auth guard
│   └── adapters/             # CLI and dashboard adapters
├── commands/
│   ├── env.ts                # workos env (add/remove/switch/list)
│   ├── organization.ts       # workos organization (create/update/get/list/delete)
│   ├── user.ts               # workos user (get/list/update/delete)
│   ├── install.ts            # workos install
│   ├── install-skill.ts      # workos install-skill
│   ├── auth-status.ts        # workos auth status
│   ├── login.ts              # workos auth login
│   └── logout.ts             # workos auth logout
├── dashboard/                # Ink/React TUI components
├── nextjs/                   # Next.js installer agent
├── react/                    # React SPA installer agent
├── react-router/             # React Router installer agent
├── tanstack-start/           # TanStack Start installer agent
├── vanilla-js/               # Vanilla JS installer agent
└── utils/
    ├── table.ts              # Terminal table formatter
    ├── clack-utils.ts        # CLI prompts
    ├── debug.ts              # Logging with redaction
    ├── redact.ts             # Credential redaction
    └── ...                   # Additional utilities
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

# Test installer in another project
cd /path/to/test/nextjs-app
workos dashboard

# Test management commands
workos env add sandbox sk_test_xxx
workos organization list
workos user list
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

## Output Mode vs Interaction Mode

The CLI separates two axes:

| Axis                 | Question                        | API                                                                                                      |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Output mode**      | How should output be formatted? | `isJsonMode()` from `src/utils/output.ts`                                                                |
| **Interaction mode** | Who is driving the CLI?         | `isHumanMode()`, `isAgentMode()`, `isCiMode()`, `isPromptAllowed()` from `src/utils/interaction-mode.ts` |

Guidelines for new code:

- Use `isJsonMode()` **only** to choose between structured JSON and human-formatted output. Do not use it to decide whether to prompt, open a browser, or skip a confirmation.
- Use `isPromptAllowed()` (== `isHumanMode()`) before any clack prompt or interactive flow.
- Use `isAgentMode()` to add agent-specific recovery hints, manual-fallback wording, or host-execution warnings.
- Use `isCiMode()` to refuse browser-based flows and to prefer terse failures over recovery handoff text.
- For destructive operations, require an explicit `--yes`/`--force` flag whenever `!isPromptAllowed()` regardless of output mode.
- For `auth_required` and other deterministic failures, attach recovery metadata via `src/utils/recovery-hints.ts` so agents can parse `error.recovery.hints[]`.

Legacy compatibility — do not regress these:

- `WORKOS_NO_PROMPT=1` keeps mapping to agent interaction behavior **and** JSON output (legacy alias).
- `WORKOS_FORCE_TTY=1` only affects output mode (forces human). It must not change interaction mode.
- Non-TTY stdout still defaults output to JSON and interaction to agent.
- `isNonInteractiveEnvironment()` from `src/utils/environment.ts` is a thin wrapper over `!isHumanMode()` kept for backward compatibility. Prefer the explicit interaction-mode predicates in new code.

The full backwards-compat matrix lives in `src/utils/mode-compatibility.spec.ts`.

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

## Evaluations

Automated eval framework for testing installer skills across frameworks and project states.

```bash
pnpm eval                    # Run all scenarios
pnpm eval --framework=nextjs # Single framework
pnpm eval --quality          # Include LLM quality grading
pnpm eval:history            # List recent runs
pnpm eval:diff <id1> <id2>   # Compare runs
```

See [tests/evals/README.md](./tests/evals/README.md) for full documentation.

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
