# wizard

AI-powered CLI wizard that automatically installs WorkOS AuthKit into web projects.

## Project Structure

```
wizard/
├── src/
│   ├── run.ts              # Entry point, orchestrates wizard flow
│   ├── lib/
│   │   ├── agent-interface.ts  # Claude Agent SDK integration
│   │   ├── agent-runner.ts     # Builds prompts, runs agent
│   │   ├── config.ts           # Framework detection config
│   │   └── constants.ts        # Integration enum, shared constants
│   ├── dashboard/          # Ink/React TUI components
│   ├── nextjs/             # Next.js wizard agent
│   ├── react/              # React SPA wizard agent
│   ├── react-router/       # React Router wizard agent
│   ├── tanstack-start/     # TanStack Start wizard agent
│   └── vanilla-js/         # Vanilla JS wizard agent
├── bin.ts                  # CLI entry point
└── cli.config.ts           # App configuration (model, URLs, etc.)
```

## Key Architecture

- **Claude Agent SDK**: Uses `@anthropic-ai/claude-agent-sdk` to run Claude as an agent with tool access
- **Event Emitter**: `WizardEventEmitter` bridges agent execution ↔ TUI for real-time updates
- **Framework Detection**: Each integration has a `detect()` function in `config.ts`
- **Permission Hook**: `wizardCanUseTool()` in `agent-interface.ts` restricts Bash to safe commands only

## CLI Modes

The wizard supports two invocation modes:

### Regular CLI (default)

```bash
wizard
```

Streaming text output directly to terminal. Simple, lightweight, good for CI/scripts.

### TUI Dashboard (subcommand)

```bash
wizard dashboard
```

Interactive Ink/React interface with real-time panels for:

- Agent thinking/reasoning
- File changes being made
- Tool execution status
- Progress indicators

The dashboard code lives in `src/dashboard/` and uses `WizardEventEmitter` to receive updates from the agent.

## Tech Constraints

- **pnpm** only (not npm/yarn)
- **ESM** only - never use `require()`, `__dirname`, or CJS exports
- **Strict TypeScript** - no `as any`, proper typing required
- **No node-specific APIs** (crypto, fs sync, etc.) unless necessary
- **Ink + React 19** for TUI dashboard
- **Never commit the `docs/` directory** - it contains local ideation artifacts

## Commands

```bash
pnpm build        # Build the project
pnpm dev          # Dev mode (build + watch + link)
pnpm test         # Run tests
pnpm typecheck    # Type check
```

## Testing the Wizard

```bash
# Run wizard in a test project
cd /path/to/test-app && wizard dashboard
```

## Adding a New Framework

1. Create `src/{framework}/{framework}-wizard-agent.ts`
2. Add to `Integration` enum in `lib/constants.ts`
3. Add detection logic in `lib/config.ts`
4. Wire up in `run.ts` switch statement
