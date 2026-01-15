# Development Guide

## Monorepo Structure

```
wizard/
├── packages/
│   ├── wizard/         # CLI wizard (TypeScript)
│   └── llm-gateway/    # LLM API proxy (TypeScript)
├── tsconfig.json       # Shared TypeScript config
├── .prettierrc         # Shared formatting
├── .eslintrc.js        # Shared linting
├── pnpm-workspace.yaml # Workspace definition
└── package.json        # Root scripts
```

## Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Development Workflow

### Working on the Wizard

```bash
# Build and watch
cd packages/cli
pnpm build
pnpm build:watch

# Test locally
cd /path/to/test/nextjs-app
~/Developer/wizard/dist/bin.js
```

### Working on LLM Gateway

```bash
cd packages/llm-gateway

# Set your Anthropic key
export ANTHROPIC_API_KEY=sk-ant-...

# Start in watch mode
pnpm dev

# Test health
curl http://localhost:8000/health
```

### Testing End-to-End

**Terminal 1 - LLM Gateway:**
```bash
cd packages/llm-gateway
export ANTHROPIC_API_KEY=sk-ant-YOUR-KEY
pnpm dev
```

**Terminal 2 - Test Wizard:**
```bash
cd /tmp/test-nextjs-app
~/Developer/wizard/dist/bin.js --local
```

The wizard will connect to your local gateway instead of production.

## Workspace Commands

```bash
# Build everything
pnpm build

# Clean everything
pnpm clean

# Build specific package
pnpm --filter @workos/authkit-wizard build
pnpm --filter @workos/authkit-llm-gateway build
```

## TypeScript Configuration

**Shared base:** `tsconfig.json` (root)
- Common compiler options
- Strict mode enabled
- ES2022 target

**Package configs extend base:**
- `packages/cli/tsconfig.json` → Node16 modules (CJS compat)
- `packages/llm-gateway/tsconfig.json` → ESNext modules (modern ESM)

## Code Organization

### Wizard Package

```
packages/cli/src/
├── lib/
│   ├── agent-runner.ts       # Core agent execution
│   ├── agent-interface.ts    # SDK interface
│   ├── framework-config.ts   # Framework definitions
│   └── constants.ts          # Integration types
├── nextjs/                   # Next.js wizard
├── react/                    # React wizard
├── react-router/             # React Router wizard
├── tanstack-start/           # TanStack Start wizard
├── vanilla-js/               # Vanilla JS wizard
└── utils/
    ├── clack-utils.ts        # CLI prompts
    ├── debug.ts              # Logging with redaction
    └── redact.ts             # Credential redaction
```

### LLM Gateway Package

```
packages/llm-gateway/src/
└── index.ts                  # Express server + Anthropic proxy
```

## Making Changes

### Adding a New Framework

1. Create `packages/cli/src/your-framework/your-framework-wizard-agent.ts`
2. Define `FrameworkConfig` with metadata, detection, environment, UI
3. Export `runYourFrameworkWizardAgent(options)` function
4. Add to `Integration` enum in `constants.ts`
5. Add detection logic to `config.ts`
6. Wire up in `run.ts`

See `nextjs-wizard-agent.ts` as reference.

### Updating Integration Instructions

The wizard prompt in `agent-runner.ts` tells Claude to:
1. Fetch live docs from workos.com
2. Fetch SDK README from GitHub/npm
3. Follow official documentation

To change instructions, edit `buildIntegrationPrompt()` in `agent-runner.ts`.

### Adding Security Features

Credential redaction is in `utils/redact.ts`. Add patterns:

```typescript
export function redactCredentials(obj: any): any {
  // Add new patterns here
  const redacted = JSON.stringify(obj)
    .replace(/sk_test_[a-zA-Z0-9]+/g, (match) =>
      `sk_test_...${match.slice(-3)}`
    );
  return JSON.parse(redacted);
}
```

## Testing

**Manual testing:**
1. Start LLM gateway with your Anthropic key
2. Run wizard with `--local` flag in a test app
3. Check logs at `/tmp/authkit-wizard.log`
4. Verify integration works in test app

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
./dist/bin.js --debug --local
```

**Check logs:**
```bash
tail -f /tmp/authkit-wizard.log
```

**LLM Gateway logs:**
Run `pnpm dev` in Terminal 1 - you'll see all API calls.

## Common Tasks

```bash
# Build everything
pnpm build

# Format code
pnpm --filter @workos/authkit-wizard fix

# Check types
cd packages/cli && pnpm tsc --noEmit
cd packages/llm-gateway && pnpm tsc --noEmit
```

## Questions?

See [root README](../../README.md) for user-facing docs.
