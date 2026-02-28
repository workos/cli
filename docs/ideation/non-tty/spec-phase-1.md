# Spec: Core Infrastructure + Auth (Phase 1)

**Effort**: L
**Blocked by**: None

## Technical Approach

Build the foundational layer that all other phases depend on: output mode detection, JSON formatting, structured errors, exit codes, and non-TTY auth behavior. This phase touches shared utilities and the CLI entry point but does NOT modify individual command implementations — that's Phase 2.

The key design principle: **detect once, flow everywhere**. A single `OutputMode` resolved at startup drives all output and error formatting decisions through shared utilities that commands call.

Pattern to follow: The existing `isNonInteractiveEnvironment()` in `src/utils/environment.ts` already detects TTY. We extend this into a richer `OutputMode` system.

## Feedback Strategy

- **Inner-loop command**: `pnpm test -- --filter output`
- **Playground**: Unit tests for output utilities + manual `echo | workos --help` pipe tests
- **Rationale**: Core utilities need thorough unit tests since every command depends on them

## File Changes

### New Files

| File                           | Purpose                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `src/utils/output.ts`          | Output mode detection, JSON formatter, structured error writer |
| `src/utils/exit-codes.ts`      | Exit code constants and typed exit helper                      |
| `src/utils/output.spec.ts`     | Tests for output utilities                                     |
| `src/utils/exit-codes.spec.ts` | Tests for exit code helpers                                    |

### Modified Files

| File                           | Change                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/utils/environment.ts`     | Add `WORKOS_NO_PROMPT`, `WORKOS_FORCE_TTY` env var support to `isNonInteractiveEnvironment()`        |
| `src/bin.ts`                   | Add global `--json` flag, resolve `OutputMode` early, pass to commands. Add `--help --json` handler. |
| `src/lib/ensure-auth.ts`       | In non-TTY mode, don't trigger `runLogin()` — exit with code 4 and structured error instead          |
| `src/lib/api-key.ts`           | Update error to use structured error format and exit code 4                                          |
| `src/lib/workos-api.ts`        | Update `WorkOSApiError` to support structured JSON error output                                      |
| `src/commands/organization.ts` | Update `handleApiError` to use structured error output (shared utility)                              |
| `src/commands/user.ts`         | Update `handleApiError` to use structured error output (shared utility)                              |

## Implementation Details

### Component 1: Output Mode System (`src/utils/output.ts`)

Pattern to follow: `src/utils/environment.ts` for env var reading pattern.

```typescript
export type OutputMode = 'human' | 'json';

export function resolveOutputMode(jsonFlag?: boolean): OutputMode {
  // Explicit --json flag always wins
  if (jsonFlag) return 'json';
  // WORKOS_FORCE_TTY overrides auto-detection
  if (process.env.WORKOS_FORCE_TTY) return 'human';
  // Auto-detect: non-TTY → JSON
  if (!process.stdout.isTTY) return 'json';
  return 'human';
}
```

**Key decisions:**

- `OutputMode` is resolved once at startup in `bin.ts` and threaded through
- `outputJson(data)` writes `JSON.stringify(data)` to stdout (no pretty-print — agents parse it)
- `outputError(error)` writes structured JSON to stderr: `{ "error": { "code": string, "message": string, "details"?: unknown } }`
- `outputSuccess(message, data?)` writes either chalk-formatted success or JSON with `{ "status": "ok", "message": string, ...data }`
- When `OutputMode === 'json'`, all chalk calls are suppressed (strip ANSI)

**Implementation steps:**

1. Create `OutputMode` type and `resolveOutputMode()` function
2. Create `outputJson()`, `outputError()`, `outputSuccess()` helpers
3. Create `outputTable(columns, rows)` that delegates to `formatTable()` for human mode and JSON array for json mode
4. Add `stripAnsi()` utility (or use existing `chalk.level = 0` approach)

**Feedback loop:**

- Playground: Test suite
- Experiment: `resolveOutputMode({ jsonFlag: true })` returns `'json'`, `resolveOutputMode()` with mocked TTY returns `'human'`
- Check: `pnpm test -- --filter output`

### Component 2: Exit Codes (`src/utils/exit-codes.ts`)

```typescript
export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CANCELLED: 2,
  AUTH_REQUIRED: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export function exitWithCode(code: ExitCodeValue, error?: { code: string; message: string }): never {
  if (error) {
    outputError(error);
  }
  process.exit(code);
}
```

**Implementation steps:**

1. Define exit code constants
2. Create `exitWithCode()` helper that writes structured error then exits
3. Create `exitWithAuthRequired()` convenience for the common auth case

**Feedback loop:**

- Playground: Test suite
- Experiment: `exitWithCode(ExitCode.AUTH_REQUIRED, { code: 'auth_required', message: '...' })` exits 4 with JSON on stderr
- Check: `pnpm test -- --filter exit-codes`

### Component 3: Environment Variable Support (`src/utils/environment.ts`)

Update `isNonInteractiveEnvironment()`:

```typescript
export function isNonInteractiveEnvironment(): boolean {
  // WORKOS_NO_PROMPT forces non-interactive regardless of TTY
  if (process.env.WORKOS_NO_PROMPT === '1' || process.env.WORKOS_NO_PROMPT === 'true') {
    return true;
  }
  // WORKOS_FORCE_TTY forces interactive regardless of TTY
  if (process.env.WORKOS_FORCE_TTY) {
    return false;
  }
  if (IS_DEV) {
    return false;
  }
  if (!process.stdout.isTTY || !process.stderr.isTTY) {
    return true;
  }
  return false;
}
```

**Implementation steps:**

1. Add `WORKOS_NO_PROMPT` check (highest priority — always non-interactive)
2. Add `WORKOS_FORCE_TTY` check (overrides TTY detection → interactive)
3. Preserve existing `IS_DEV` bypass

### Component 4: Non-TTY Auth Guard (`src/lib/ensure-auth.ts`)

In non-TTY mode, `ensureAuthenticated()` must never trigger `runLogin()` (which opens a browser). Instead, it should exit with code 4.

```typescript
export async function ensureAuthenticated(): Promise<EnsureAuthResult> {
  const result: EnsureAuthResult = { authenticated: false, loginTriggered: false, tokenRefreshed: false };

  if (!hasCredentials()) {
    if (isNonInteractiveEnvironment()) {
      exitWithCode(ExitCode.AUTH_REQUIRED, {
        code: 'auth_required',
        message: 'Not authenticated. Run `workos login` in an interactive terminal, or set WORKOS_API_KEY.',
      });
    }
    // ... existing interactive login flow
  }
  // ... rest of existing logic, with same pattern for expired tokens
}
```

**Implementation steps:**

1. Import `isNonInteractiveEnvironment`, `exitWithCode`, `ExitCode`
2. Add non-TTY guard before every `runLogin()` call (4 locations)
3. Each guard uses `exitWithCode(ExitCode.AUTH_REQUIRED, ...)` with a helpful message
4. Token refresh still works silently (no user interaction needed)

### Component 5: Global `--json` Flag and Help (`src/bin.ts`)

Add `--json` as a global yargs option and resolve `OutputMode` at the top level.

```typescript
// Global options
.option('json', {
  type: 'boolean',
  default: false,
  describe: 'Output results as JSON (auto-enabled in non-TTY)',
  global: true,
})
```

For `--help --json`, intercept yargs help output and return a structured command tree:

```typescript
// After yargs config, before .argv
.middleware((argv) => {
  if (argv.help && argv.json) {
    const commandTree = buildCommandTree(yargs); // Extract from yargs internal config
    console.log(JSON.stringify(commandTree, null, 2));
    process.exit(0);
  }
})
```

**Implementation steps:**

1. Add `--json` global option to yargs
2. Resolve `OutputMode` early using `resolveOutputMode(argv.json)`
3. Thread `OutputMode` to commands via yargs middleware or a shared singleton
4. Add `--help --json` interceptor that outputs machine-readable command schema
5. Update default command (`$0`) to output JSON help in non-TTY

### Component 6: Structured Error Output for API Commands

Update both `handleApiError` functions in `organization.ts` and `user.ts` to use the shared utility:

```typescript
function handleApiError(error: unknown): never {
  if (error instanceof WorkOSApiError) {
    exitWithError({
      code: error.code || `http_${error.statusCode}`,
      message: error.message,
      details: error.errors,
    });
  }
  exitWithError({
    code: 'unknown_error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}
```

Where `exitWithError` uses `outputError()` + `process.exit(1)`, and in JSON mode outputs to stderr as JSON instead of `chalk.red()`.

**Implementation steps:**

1. Create shared `exitWithError()` in `src/utils/output.ts`
2. Update `handleApiError` in `organization.ts` to use it
3. Update `handleApiError` in `user.ts` to use it
4. Both still show chalk-formatted errors in human mode

## Testing Requirements

### Unit Tests

| Test                                                                     | Validates                 |
| ------------------------------------------------------------------------ | ------------------------- |
| `resolveOutputMode()` returns `'json'` when `--json` passed              | Flag override works       |
| `resolveOutputMode()` returns `'json'` when stdout not TTY               | Auto-detection works      |
| `resolveOutputMode()` returns `'human'` when `WORKOS_FORCE_TTY=1`        | Force override works      |
| `isNonInteractiveEnvironment()` returns `true` when `WORKOS_NO_PROMPT=1` | Env var suppression works |
| `outputJson()` writes valid JSON to stdout                               | JSON formatting           |
| `outputError()` writes JSON to stderr in json mode                       | Structured errors         |
| `outputError()` writes chalk.red to stderr in human mode                 | Human errors preserved    |
| `exitWithCode(4)` exits with code 4                                      | Exit code propagation     |
| `ensureAuthenticated()` exits 4 in non-TTY without credentials           | Auth guard                |
| `ensureAuthenticated()` still refreshes tokens silently in non-TTY       | Token refresh unaffected  |

### Integration Tests

| Test                                                                             | Validates                |
| -------------------------------------------------------------------------------- | ------------------------ |
| `echo '' \| workos org list --api-key invalid` exits 1 with JSON error on stderr | End-to-end non-TTY error |
| `workos org list --json --api-key valid` outputs JSON array                      | End-to-end JSON output   |
| `WORKOS_NO_PROMPT=1 workos` exits 0 with JSON help                               | Prompt suppression       |

## Error Handling

- Non-TTY + no auth → exit code 4, JSON error to stderr
- Non-TTY + API error → exit code 1, JSON error to stderr with error code
- Non-TTY + cancelled (Ctrl+C) → exit code 2
- All errors include `code` field for machine parsing

## Validation Commands

```bash
pnpm typecheck
pnpm test -- --filter output
pnpm test -- --filter exit-codes
pnpm build
# Manual: echo '' | node dist/bin.js org list --api-key fake 2>&1 | jq .
```

## Open Items

- Should `OutputMode` be a module-level singleton (like `IS_DEV`) or threaded via function args? Singleton is simpler but harder to test. Leaning toward singleton with `setOutputMode()` for tests.
- Exact schema for `--help --json` output — should it match a standard (e.g., JSON Schema for CLI args) or be custom?
