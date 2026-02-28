# Spec: Headless Installer + NDJSON Streaming (Phase 4)

**Effort**: L
**Blocked by**: Phase 1 (Core Infrastructure)

## Technical Approach

Create a third adapter — `HeadlessAdapter` — alongside the existing `CLIAdapter` and `DashboardAdapter`. This adapter handles all state machine events non-interactively: auto-resolving decisions with sensible defaults, accepting overrides via CLI flags, and streaming progress as NDJSON to stdout.

The adapter pattern is already well-established. The state machine (`installer-core.ts`) emits typed events; adapters subscribe and respond. The `HeadlessAdapter` subscribes to the same events but never prompts — it auto-responds with defaults or flag-provided values.

Pattern to follow: `src/lib/adapters/cli-adapter.ts` for event subscription pattern and handler structure.

## Feedback Strategy

- **Inner-loop command**: `pnpm test -- --filter headless`
- **Playground**: Pipe test — `echo '' | workos install --api-key xxx --client-id yyy 2>&1 | head`
- **Rationale**: Adapter must be tested against the real event flow, but unit tests can mock the emitter

## File Changes

### New Files

| File                                        | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `src/lib/adapters/headless-adapter.ts`      | Non-interactive adapter with NDJSON streaming |
| `src/lib/adapters/headless-adapter.spec.ts` | Tests for headless adapter                    |
| `src/utils/ndjson.ts`                       | NDJSON writer utility                         |
| `src/utils/ndjson.spec.ts`                  | Tests for NDJSON utility                      |

### Modified Files

| File                       | Change                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| `src/lib/run-with-core.ts` | Add headless adapter selection when non-TTY detected                            |
| `src/commands/install.ts`  | Remove non-TTY block — route to headless adapter instead of erroring            |
| `src/bin.ts`               | Ensure `--api-key` and `--client-id` are visible (not hidden) flags for install |

## Implementation Details

### Component 1: NDJSON Writer (`src/utils/ndjson.ts`)

Simple utility for writing newline-delimited JSON events to stdout:

```typescript
export interface NDJSONEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export function writeNDJSON(event: Omit<NDJSONEvent, 'timestamp'>): void {
  const line: NDJSONEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(JSON.stringify(line) + '\n');
}
```

**Event types emitted:**

| Event Type            | Payload                                   | When                       |
| --------------------- | ----------------------------------------- | -------------------------- |
| `detection:start`     | `{}`                                      | Framework detection begins |
| `detection:complete`  | `{ integration: string }`                 | Framework detected         |
| `detection:none`      | `{}`                                      | No framework detected      |
| `auth:checking`       | `{}`                                      | Checking credentials       |
| `auth:success`        | `{}`                                      | Authenticated              |
| `auth:required`       | `{ message: string }`                     | Auth failed (also exits 4) |
| `git:status`          | `{ dirty: boolean, files?: string[] }`    | Git status check           |
| `git:decision`        | `{ action: 'continue' \| 'cancel' }`      | Auto-resolved git decision |
| `credentials:found`   | `{ source: 'flag' \| 'env' \| 'stored' }` | Credentials resolved       |
| `branch:created`      | `{ name: string }`                        | Branch created             |
| `branch:skipped`      | `{ reason: string }`                      | Branch creation skipped    |
| `agent:start`         | `{}`                                      | Agent execution begins     |
| `agent:progress`      | `{ message: string }`                     | Agent thinking/progress    |
| `agent:tool`          | `{ tool: string, input?: unknown }`       | Agent using a tool         |
| `agent:success`       | `{}`                                      | Agent completed            |
| `agent:failure`       | `{ error: string }`                       | Agent failed               |
| `validation:start`    | `{}`                                      | Post-install validation    |
| `validation:issue`    | `{ severity: string, message: string }`   | Validation finding         |
| `validation:complete` | `{ issues: number }`                      | Validation done            |
| `commit:created`      | `{ sha: string, message: string }`        | Auto-committed             |
| `complete`            | `{ success: boolean }`                    | Install finished           |
| `error`               | `{ code: string, message: string }`       | Fatal error                |

**Implementation steps:**

1. Define `NDJSONEvent` interface
2. Create `writeNDJSON()` that serializes + writes to stdout
3. Ensure no other stdout writes happen during headless mode (all human output suppressed)

**Feedback loop:**

- Playground: Test suite
- Experiment: `writeNDJSON({ type: 'detection:complete', integration: 'nextjs' })` outputs valid JSON line
- Check: `pnpm test -- --filter ndjson`

### Component 2: Headless Adapter (`src/lib/adapters/headless-adapter.ts`)

Pattern to follow: `src/lib/adapters/cli-adapter.ts` — same `subscribe()` pattern, same event handlers, but auto-resolving instead of prompting.

```typescript
import type { AdapterConfig } from './types.js';
import { writeNDJSON } from '../../utils/ndjson.js';

export class HeadlessAdapter {
  private emitter: AdapterConfig['emitter'];
  private sendEvent: AdapterConfig['sendEvent'];
  private handlers = new Map<string, (...args: unknown[]) => void>();
  private options: HeadlessOptions;

  constructor(config: AdapterConfig & { options: HeadlessOptions }) {
    this.emitter = config.emitter;
    this.sendEvent = config.sendEvent;
    this.options = config.options;
  }

  async start(): Promise<void> {
    // Subscribe to all events, auto-resolve decisions
    this.subscribe('detection:complete', this.handleDetectionComplete);
    this.subscribe('detection:none', this.handleDetectionNone);
    this.subscribe('git:dirty', this.handleGitDirty);
    this.subscribe('credentials:request', this.handleCredentialsRequest);
    this.subscribe('credentials:env:prompt', this.handleEnvPrompt);
    this.subscribe('branch:prompt', this.handleBranchPrompt);
    this.subscribe('postinstall:commit:prompt', this.handleCommitPrompt);
    this.subscribe('postinstall:pr:prompt', this.handlePrPrompt);
    // ... all other events → writeNDJSON pass-through
  }
}
```

**Auto-default decisions:**

| Event                       | Interactive Behavior         | Headless Default                                       | Override Flag              |
| --------------------------- | ---------------------------- | ------------------------------------------------------ | -------------------------- |
| `git:dirty`                 | Prompt to continue           | Auto-continue                                          | `--no-git-check`           |
| `credentials:request`       | Prompt for API key/client ID | Use `--api-key`/`--client-id` flags. Error if missing. | `--api-key`, `--client-id` |
| `credentials:env:prompt`    | Ask to scan env files        | Auto-scan                                              | (always scans)             |
| `branch:prompt`             | Ask create/continue/cancel   | Auto-create branch                                     | `--no-branch` to skip      |
| `postinstall:commit:prompt` | Ask to commit                | Auto-commit                                            | `--no-commit` to skip      |
| `postinstall:pr:prompt`     | Ask to create PR             | Skip PR                                                | `--create-pr` to enable    |

**Implementation steps:**

1. Create `HeadlessOptions` interface with all override flags
2. Implement constructor with `AdapterConfig` + options
3. Implement `start()` with event subscriptions
4. For each decision event: auto-resolve with default, log NDJSON event, send event back to state machine
5. For progress/info events: write NDJSON pass-through
6. For error events: write NDJSON + exit with appropriate code
7. Implement `stop()` cleanup (same pattern as CLIAdapter)

**Key handler examples:**

```typescript
private handleGitDirty = ({ files }: InstallerEvents['git:dirty']): void => {
  writeNDJSON({ type: 'git:status', dirty: true, files });
  writeNDJSON({ type: 'git:decision', action: 'continue' });
  this.sendEvent({ type: 'GIT_CONFIRMED' });
};

private handleCredentialsRequest = ({ requiresApiKey }: InstallerEvents['credentials:request']): void => {
  if (requiresApiKey && !this.options.apiKey) {
    writeNDJSON({ type: 'error', code: 'missing_credentials', message: 'API key required. Pass --api-key flag.' });
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
  this.sendEvent({
    type: 'CREDENTIALS_PROVIDED',
    apiKey: this.options.apiKey,
    clientId: this.options.clientId,
  });
};

private handleBranchPrompt = (): void => {
  if (this.options.noBranch) {
    writeNDJSON({ type: 'branch:skipped', reason: '--no-branch flag' });
    this.sendEvent({ type: 'BRANCH_CONTINUE_CURRENT' });
  } else {
    writeNDJSON({ type: 'branch:creating' });
    this.sendEvent({ type: 'BRANCH_CREATE' });
  }
};
```

**Feedback loop:**

- Playground: Test suite with mocked emitter
- Experiment: Emit `git:dirty` → adapter auto-confirms and writes NDJSON
- Check: `pnpm test -- --filter headless`

### Component 3: Adapter Selection (`src/lib/run-with-core.ts`)

Update adapter selection to include headless:

```typescript
let adapter: InstallerAdapter;
if (isNonInteractiveEnvironment()) {
  adapter = new HeadlessAdapter({
    emitter,
    sendEvent,
    debug: augmentedOptions.debug,
    options: {
      apiKey: augmentedOptions.apiKey,
      clientId: augmentedOptions.clientId,
      noBranch: augmentedOptions.noBranch,
      noCommit: augmentedOptions.noCommit,
      createPr: augmentedOptions.createPr,
      noGitCheck: augmentedOptions.noGitCheck,
    },
  });
} else if (options.dashboard) {
  adapter = new DashboardAdapter({ emitter, sendEvent, debug: augmentedOptions.debug });
} else {
  adapter = new CLIAdapter({ emitter, sendEvent, debug: augmentedOptions.debug });
}
```

**Implementation steps:**

1. Import `HeadlessAdapter` and `isNonInteractiveEnvironment`
2. Add non-TTY check as highest priority (before dashboard check)
3. Pass headless options from CLI args
4. Ensure `HeadlessAdapter` implements same interface as other adapters

### Component 4: Install Command Update (`src/commands/install.ts`)

Remove the non-TTY block that currently exits with an error:

```typescript
// REMOVE THIS:
} else if (isNonInteractiveEnvironment()) {
  clack.log.error('This installer requires an interactive terminal...');
  process.exit(1);
}
```

Replace with: let the flow continue — `run-with-core.ts` will select the `HeadlessAdapter`.

**Implementation steps:**

1. Remove non-TTY error block in `handleInstall()`
2. Ensure CI mode (`--ci`) still works (may need to merge with headless behavior)
3. Make `--api-key` and `--client-id` visible in yargs config (currently `hidden: true`)

### Component 5: New Install Flags (`src/bin.ts`)

Expose headless-relevant flags:

```typescript
const installerOptions = {
  // ... existing options
  'api-key': {
    type: 'string' as const,
    describe: 'WorkOS API key (required in non-interactive mode)',
  },
  'client-id': {
    type: 'string' as const,
    describe: 'WorkOS client ID (required in non-interactive mode)',
  },
  'no-branch': {
    default: false,
    type: 'boolean' as const,
    describe: 'Skip branch creation (use current branch)',
  },
  'no-commit': {
    default: false,
    type: 'boolean' as const,
    describe: 'Skip auto-commit after installation',
  },
  'create-pr': {
    default: false,
    type: 'boolean' as const,
    describe: 'Auto-create pull request after installation',
  },
  'no-git-check': {
    default: false,
    type: 'boolean' as const,
    describe: 'Skip git dirty check',
  },
};
```

## Testing Requirements

### Unit Tests

| Test                                                 | Validates                |
| ---------------------------------------------------- | ------------------------ |
| `HeadlessAdapter` auto-confirms git dirty            | Default behavior         |
| `HeadlessAdapter` sends credentials from flags       | Flag passthrough         |
| `HeadlessAdapter` errors when credentials missing    | Required flag validation |
| `HeadlessAdapter` auto-creates branch by default     | Default branch behavior  |
| `HeadlessAdapter` skips branch with `--no-branch`    | Flag override            |
| `HeadlessAdapter` auto-commits by default            | Default commit behavior  |
| `HeadlessAdapter` skips commit with `--no-commit`    | Flag override            |
| All NDJSON events have `type` and `timestamp` fields | Event schema             |
| NDJSON output is parseable line-by-line              | NDJSON format            |
| `writeNDJSON` outputs exactly one line per call      | No multi-line            |

### Integration Tests

| Test                                                                                   | Validates           |
| -------------------------------------------------------------------------------------- | ------------------- |
| `echo '' \| workos install --api-key xxx --client-id yyy --no-validate` streams NDJSON | End-to-end headless |
| Headless install with missing `--api-key` exits with error NDJSON event                | Error handling      |

## Error Handling

- Missing required credentials → NDJSON error event + exit code 1
- Agent failure → NDJSON error event + exit code 1
- Auth expired during install → NDJSON auth:required event + exit code 4
- All errors produce both an NDJSON event AND a structured JSON error on stderr (for agents that read stderr)

## Validation Commands

```bash
pnpm typecheck
pnpm test -- --filter headless
pnpm test -- --filter ndjson
pnpm build
# Manual (requires real credentials):
# echo '' | node dist/bin.js install --api-key sk_test_xxx --client-id client_xxx --no-validate --no-commit 2>/dev/null | head -20
```

## Open Items

- Should agent progress events include the raw agent thinking text, or just summaries? Raw text could be very verbose. Leaning toward summaries with a `--verbose` flag for full output.
- Should NDJSON go to stdout or stderr? Stdout is conventional for data, but if the installer also produces file content to stdout, there'd be a conflict. Since the installer writes files to disk (not stdout), NDJSON on stdout is fine.
- The existing `--ci` flag partially overlaps with headless mode. Should we deprecate `--ci` in favor of auto-detection? Or keep it as an alias? Leaning toward keeping `--ci` as a documented alias for "non-interactive install" to avoid breaking existing CI configs.
