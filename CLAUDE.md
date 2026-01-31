# installer

AI-powered CLI installer that automatically installs WorkOS AuthKit into web projects.

## Project Structure

```
installer/
├── src/
│   ├── bin.ts              # CLI entry point
│   ├── cli.config.ts       # App configuration (model, URLs, etc.)
│   ├── run.ts              # Entry point, orchestrates installer flow
│   ├── lib/
│   │   ├── agent-interface.ts  # Claude Agent SDK integration
│   │   ├── agent-runner.ts     # Builds prompts, runs agent
│   │   ├── config.ts           # Framework detection config
│   │   ├── constants.ts        # Integration enum, shared constants
│   │   ├── credential-proxy.ts # Token refresh proxy for long sessions
│   │   └── ensure-auth.ts      # Startup auth guard with token refresh
│   ├── dashboard/          # Ink/React TUI components
│   ├── nextjs/             # Next.js installer agent
│   ├── react/              # React SPA installer agent
│   ├── react-router/       # React Router installer agent
│   ├── tanstack-start/     # TanStack Start installer agent
│   └── vanilla-js/         # Vanilla JS installer agent
└── ...
```

## Key Architecture

- **Claude Agent SDK**: Uses `@anthropic-ai/claude-agent-sdk` to run Claude as an agent with tool access
- **Event Emitter**: `InstallerEventEmitter` bridges agent execution ↔ TUI for real-time updates
- **Framework Detection**: Each integration has a `detect()` function in `config.ts`
- **Permission Hook**: `installerCanUseTool()` in `agent-interface.ts` restricts Bash to safe commands only

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

## Commands

```bash
pnpm build        # Build the project
pnpm dev          # Dev mode (build + watch + link)
pnpm test         # Run tests
pnpm typecheck    # Type check
```

## Testing the Installer

```bash
# Run installer in a test project
cd /path/to/test-app && workos dashboard
```

## Adding a New Framework

1. Create `src/{framework}/{framework}-installer-agent.ts`
2. Add to `Integration` enum in `lib/constants.ts`
3. Add detection logic in `lib/config.ts`
4. Wire up in `run.ts` switch statement
