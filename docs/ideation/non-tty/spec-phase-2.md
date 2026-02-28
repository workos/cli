# Spec: Management Commands Non-Interactive (Phase 2)

**Effort**: M
**Blocked by**: Phase 1 (Core Infrastructure)

## Technical Approach

Migrate all management commands (`env`, `organization`, `user`) to use the Phase 1 output utilities. Each command already has partial non-interactive support (they accept flags), but output is always human-formatted (chalk tables, colored success messages). This phase makes every command produce clean JSON in non-TTY mode while preserving the current human output.

The pattern is consistent across all commands:

1. Replace `console.log(chalk.green(...))` with `outputSuccess()`
2. Replace `formatTable()` calls with `outputTable()`
3. Replace `handleApiError()` with shared structured error output
4. Add non-interactive paths where interactive prompts exist (env add, env switch)

Pattern to follow: `src/commands/env.ts` already has a non-interactive path for `env add` (lines 28-34). Extend this pattern to all commands.

## Feedback Strategy

- **Inner-loop command**: `pnpm test -- --filter commands`
- **Playground**: Test suite + manual pipe tests (`workos org list --api-key xxx | jq .`)
- **Rationale**: Each command is independent — test one, apply pattern to rest

## File Changes

### Modified Files

| File                                | Change                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/commands/env.ts`               | Use output utilities for all subcommands. Add JSON output for `env list`. Non-interactive `env switch` requires name arg. |
| `src/commands/organization.ts`      | Use output utilities. Remove `handleApiError` in favor of shared. JSON output for `org list`.                             |
| `src/commands/user.ts`              | Use output utilities. Remove `handleApiError` in favor of shared. JSON output for `user list`.                            |
| `src/commands/env.spec.ts`          | Add tests for JSON output mode                                                                                            |
| `src/commands/organization.spec.ts` | Add tests for JSON output mode                                                                                            |
| `src/commands/user.spec.ts`         | Add tests for JSON output mode                                                                                            |
| `src/utils/table.ts`                | No changes needed — `outputTable()` from Phase 1 delegates to this in human mode                                          |
| `src/bin.ts`                        | Ensure non-TTY `env switch` without name arg exits with error instead of prompting                                        |

## Implementation Details

### Component 1: Env Commands (`src/commands/env.ts`)

Pattern to follow: Existing non-interactive path in `runEnvAdd()` (lines 28-34).

**`runEnvAdd()` changes:**

- Non-interactive path: replace `clack.log.success()` with `outputSuccess('Environment added', { name, type, active: isFirst })`
- Interactive path: no changes (human output preserved)
- In non-TTY without required args → `exitWithError({ code: 'missing_args', message: 'Name and API key required in non-interactive mode' })`

**`runEnvRemove()` changes:**

- Replace `clack.log.error/success` with `outputError/outputSuccess`
- Error case: `exitWithError({ code: 'not_found', message: '...' })`

**`runEnvSwitch()` changes:**

- Non-interactive (name provided): replace `clack.log.success` with `outputSuccess`
- Non-interactive (no name, non-TTY): `exitWithError({ code: 'missing_args', message: 'Environment name required in non-interactive mode' })`
- Interactive (no name, TTY): unchanged

**`runEnvList()` changes:**

- JSON mode: `outputJson(Object.values(config.environments).map(env => ({ ...env, active: env.name === config.activeEnvironment })))`
- Human mode: existing chalk table (unchanged)

**Implementation steps:**

1. Import output utilities at top of file
2. Update each function to check output mode for formatting
3. Add non-TTY guards for interactive-only code paths
4. Add tests for JSON output of each subcommand

**Feedback loop:**

- Playground: Test suite
- Experiment: `runEnvList()` with json output mode → valid JSON array
- Check: `pnpm test -- --filter env`

### Component 2: Organization Commands (`src/commands/organization.ts`)

**`handleApiError()` → remove**, replaced by shared `exitWithApiError()` from Phase 1.

**`runOrgCreate()` changes:**

- Replace `console.log(chalk.green('Created organization'))` + `console.log(JSON.stringify(org, null, 2))` with `outputSuccess('Created organization', org)`
- In JSON mode, outputs: `{ "status": "ok", "message": "Created organization", "data": { ...org } }`

**`runOrgGet()` changes:**

- Replace `console.log(JSON.stringify(org, null, 2))` with `outputJson(org)`
- Both modes get JSON for single-resource responses (already JSON, just standardize)

**`runOrgList()` changes:**

- JSON mode: `outputJson({ data: result.data, list_metadata: result.list_metadata })`
- Human mode: existing `formatTable()` (unchanged)
- Empty state: JSON mode → `outputJson({ data: [], list_metadata: result.list_metadata })` (no "No organizations found." string)

**`runOrgUpdate()` / `runOrgDelete()` changes:**

- Same pattern as `runOrgCreate()`

**Implementation steps:**

1. Remove local `handleApiError()` — use shared utility
2. Update each function to use `outputSuccess/outputJson/outputTable`
3. Ensure empty list states produce valid JSON (not strings like "No organizations found.")
4. Add tests

**Feedback loop:**

- Playground: Test suite with mocked API
- Experiment: `runOrgList()` in JSON mode with mock data → valid JSON with `data` array
- Check: `pnpm test -- --filter organization`

### Component 3: User Commands (`src/commands/user.ts`)

Identical pattern to organization commands. Same changes:

1. Remove local `handleApiError()`
2. Replace output calls with shared utilities
3. Ensure empty states are valid JSON
4. Add tests

**Implementation steps:** Same as Component 2, applied to user commands.

**Feedback loop:**

- Playground: Test suite
- Experiment: `runUserList()` in JSON mode → valid JSON
- Check: `pnpm test -- --filter user`

### Component 4: Non-TTY Guards in `bin.ts`

Update command handlers in `bin.ts` to prevent interactive prompts in non-TTY:

```typescript
// env switch without name in non-TTY
.command('switch [name]', 'Switch active environment', (yargs) => ..., async (argv) => {
  if (!argv.name && isNonInteractiveEnvironment()) {
    exitWithError({ code: 'missing_args', message: 'Environment name required. Usage: workos env switch <name>' });
  }
  // ... existing handler
})
```

**Implementation steps:**

1. Add non-TTY guards for `env switch` (requires name)
2. Add non-TTY guard for default command (`$0`) — already shows help, but switch to JSON help in non-TTY
3. Ensure `env add` in non-TTY without args exits with structured error

## Testing Requirements

### Unit Tests

| Test                                                                  | Validates             |
| --------------------------------------------------------------------- | --------------------- |
| `runEnvList()` in JSON mode outputs valid JSON array                  | JSON env list         |
| `runEnvAdd()` in non-TTY without args exits with error                | Non-interactive guard |
| `runEnvSwitch()` in non-TTY without name exits with error             | Non-interactive guard |
| `runOrgList()` in JSON mode outputs `{ data: [...] }`                 | JSON org list         |
| `runOrgCreate()` in JSON mode outputs `{ status: "ok", data: {...} }` | JSON success          |
| `runUserList()` in JSON mode outputs `{ data: [...] }`                | JSON user list        |
| `handleApiError` uses structured JSON in json mode                    | Structured errors     |
| Empty list in JSON mode outputs `{ data: [] }`, not string            | Empty state           |

### Integration Tests

| Test                                            | Validates       |
| ----------------------------------------------- | --------------- |
| `echo '' \| workos env list` outputs valid JSON | End-to-end pipe |
| `workos org list --json` outputs JSON in TTY    | Explicit flag   |

## Validation Commands

```bash
pnpm typecheck
pnpm test -- --filter env
pnpm test -- --filter organization
pnpm test -- --filter user
pnpm build
# Manual: echo '' | node dist/bin.js env list 2>&1 | jq .
# Manual: echo '' | node dist/bin.js org list --api-key sk_test_xxx 2>&1 | jq .
```

## Open Items

- Pagination metadata: Should JSON output for list commands always include `list_metadata` (cursor info) even when there's only one page? Leaning yes — agents need to know if more pages exist.
- Should `org get` and `user get` return raw API JSON or wrap in `{ "data": ... }` for consistency with list commands? Leaning raw — simpler for agents to consume single resources.
