# wizard

AI-powered CLI wizard that automatically installs WorkOS AuthKit into web projects.

## Monorepo Structure

```
packages/
├── cli/              # Main wizard CLI (@workos/authkit-wizard)
│   ├── src/
│   │   ├── run.ts              # Entry point, orchestrates wizard flow
│   │   ├── lib/
│   │   │   ├── agent-interface.ts  # Claude Agent SDK integration
│   │   │   ├── agent-runner.ts     # Builds prompts, runs agent
│   │   │   ├── config.ts           # Framework detection config
│   │   │   └── constants.ts        # Integration enum, shared constants
│   │   ├── dashboard/          # Ink/React TUI components
│   │   ├── nextjs/             # Next.js wizard agent
│   │   ├── react/              # React SPA wizard agent
│   │   ├── react-router/       # React Router wizard agent
│   │   ├── tanstack-start/     # TanStack Start wizard agent
│   │   └── vanilla-js/         # Vanilla JS wizard agent
│   └── settings.config.ts      # App configuration (model, URLs, etc.)
└── llm-gateway/      # LLM API proxy (authenticates wizard requests)
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

## Commands

```bash
pnpm build              # Build all packages
pnpm wizard:dev         # Dev mode for CLI (build + watch)
pnpm gateway:dev        # Run local LLM gateway
pnpm test               # Run tests (in packages/cli)
pnpm typecheck          # Type check (in packages/cli)
```

## Testing the Wizard

```bash
# Terminal 1: Start local gateway
cd packages/llm-gateway && ANTHROPIC_API_KEY=sk-ant-... pnpm dev

# Terminal 2: Run wizard in test project
cd /path/to/test-app && wizard dashboard --local
```

## Adding a New Framework

1. Create `src/{framework}/{framework}-wizard-agent.ts`
2. Add to `Integration` enum in `lib/constants.ts`
3. Add detection logic in `lib/config.ts`
4. Wire up in `run.ts` switch statement
