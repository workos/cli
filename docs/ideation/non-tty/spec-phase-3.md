# Spec: Agent-Discoverable Help (Phase 3)

**Effort**: S
**Blocked by**: Phase 1 (Core Infrastructure)

## Technical Approach

Make the CLI self-documenting for agents. Two parts: (1) `--help --json` outputs a machine-readable command tree, and (2) all subcommand help text is thorough enough for an agent to use any command without external docs.

Yargs already knows the full command tree internally — we extract it and serialize to JSON. For help text quality, we audit every command's `describe`, positional descriptions, and option descriptions.

Pattern to follow: `gh` CLI doesn't have `--help --json`, but tools like `kubectl` and `terraform` have rich help. Our approach is simpler: JSON schema of commands when both `--help` and `--json` are passed.

## Feedback Strategy

- **Inner-loop command**: `pnpm test -- --filter help`
- **Playground**: Manual testing — `workos --help --json | jq .commands`
- **Rationale**: Help output is best verified manually + snapshot tests

## File Changes

### New Files

| File                          | Purpose                                          |
| ----------------------------- | ------------------------------------------------ |
| `src/utils/help-json.ts`      | Extracts yargs command tree into structured JSON |
| `src/utils/help-json.spec.ts` | Tests for help JSON output                       |

### Modified Files

| File         | Change                                                                               |
| ------------ | ------------------------------------------------------------------------------------ |
| `src/bin.ts` | Add middleware to intercept `--help --json`, improve all command/option descriptions |

## Implementation Details

### Component 1: JSON Help Extractor (`src/utils/help-json.ts`)

Build a function that takes a yargs instance and returns a structured command tree:

```typescript
export interface CommandSchema {
  name: string;
  description: string;
  commands?: CommandSchema[];
  options?: OptionSchema[];
  positionals?: PositionalSchema[];
  examples?: string[];
}

export interface OptionSchema {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
  alias?: string;
  choices?: string[];
  hidden: boolean;
}

export interface PositionalSchema {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export function buildCommandTree(yargsInstance: yargs.Argv): CommandSchema {
  // Extract from yargs internal command registry
  // yargs.getCommandInstance().getCommands() gives command names
  // yargs.getOptions() gives options for each command
}
```

**Output format:**

```json
{
  "name": "workos",
  "version": "0.7.3",
  "description": "WorkOS CLI for AuthKit integration and resource management",
  "commands": [
    {
      "name": "login",
      "description": "Authenticate with WorkOS via browser-based OAuth",
      "options": [
        { "name": "insecure-storage", "type": "boolean", "description": "...", "required": false, "default": false, "hidden": false }
      ]
    },
    {
      "name": "env",
      "description": "Manage environment configurations (API keys, endpoints)",
      "commands": [
        {
          "name": "add",
          "description": "Add an environment configuration",
          "positionals": [
            { "name": "name", "type": "string", "description": "Environment name (lowercase, hyphens, underscores)", "required": false },
            { "name": "apiKey", "type": "string", "description": "WorkOS API key (sk_live_* or sk_test_*)", "required": false }
          ],
          "options": [
            { "name": "client-id", "type": "string", "description": "WorkOS client ID for this environment", "required": false, "hidden": false },
            { "name": "endpoint", "type": "string", "description": "Custom API endpoint URL", "required": false, "hidden": false }
          ]
        }
      ]
    },
    {
      "name": "organization",
      "description": "Manage WorkOS organizations (CRUD operations)",
      "commands": [...]
    }
  ]
}
```

**Implementation steps:**

1. Define `CommandSchema`, `OptionSchema`, `PositionalSchema` interfaces
2. Implement `buildCommandTree()` using yargs internal APIs (`getCommandInstance()`, `getOptions()`)
3. Handle nested commands (env → add/remove/switch/list)
4. Include hidden flag on options (agents may want to use hidden flags)
5. Add version field from `getVersion()`

**Feedback loop:**

- Playground: Manual pipe test
- Experiment: `workos --help --json | jq '.commands | length'` returns correct count
- Check: `pnpm test -- --filter help`

### Component 2: Help Interception (`src/bin.ts`)

Add yargs middleware to intercept `--help --json`:

```typescript
.middleware((argv) => {
  // Note: --help causes yargs to show help and exit before middleware normally.
  // We need to intercept earlier or use a custom check.
}, /* applyBeforeValidation */ true)
```

Actually, yargs `--help` exits before middleware runs. Better approach: check for `--help` and `--json` in argv before yargs parses:

```typescript
const rawArgs = hideBin(process.argv);
if (rawArgs.includes('--help') && rawArgs.includes('--json')) {
  // Build yargs config but don't parse
  const cli = buildYargsConfig(); // Extract yargs setup into function
  const tree = buildCommandTree(cli);
  console.log(JSON.stringify(tree, null, 2));
  process.exit(0);
}
```

**Implementation steps:**

1. Extract yargs configuration into a `buildYargsConfig()` function (refactor from inline in bin.ts)
2. Add early `--help --json` check before `.argv`
3. Call `buildCommandTree()` and output JSON

### Component 3: Help Text Quality Audit

Audit and improve all command/option descriptions in `bin.ts`:

**Current gaps found:**

- `env` command: `'Manage environment configurations'` → `'Manage environment configurations (API keys, endpoints, active environment)'`
- `organization`: `'Manage organizations'` → `'Manage WorkOS organizations (create, update, get, list, delete)'`
- `user`: `'Manage users'` → `'Manage WorkOS user management users (get, list, update, delete)'`
- `install`: Missing description of what it does beyond "Install WorkOS AuthKit"
- Options like `--api-key`: `'WorkOS API key (overrides environment config)'` → add `'Format: sk_live_* or sk_test_*'`
- Positionals like `domains..`: `'Domains as domain:state'` → `'Domains in format domain.com:verified (state is optional, defaults to verified)'`

**Implementation steps:**

1. Review every `.describe()` and `.positional()` description
2. Ensure each describes: what it does, format/type expectations, default behavior
3. Add examples where helpful (yargs `.example()`)
4. Keep descriptions concise but complete — agents need enough to use the command correctly

## Testing Requirements

### Unit Tests

| Test                                                          | Validates         |
| ------------------------------------------------------------- | ----------------- |
| `buildCommandTree()` returns all top-level commands           | Command discovery |
| `buildCommandTree()` includes nested subcommands              | Nested commands   |
| `buildCommandTree()` includes options with types and defaults | Option schema     |
| `buildCommandTree()` includes positionals with required flag  | Positional schema |
| Output is valid JSON parseable by `JSON.parse()`              | JSON validity     |

### Snapshot Tests

| Test                                    | Validates                               |
| --------------------------------------- | --------------------------------------- |
| `--help --json` output matches snapshot | No accidental regression in help schema |

## Validation Commands

```bash
pnpm typecheck
pnpm test -- --filter help
pnpm build
# Manual: node dist/bin.js --help --json | jq .
# Manual: node dist/bin.js env --help --json | jq '.commands'
# Manual: node dist/bin.js organization --help --json | jq '.commands[0].positionals'
```

## Open Items

- Should `--help --json` work for subcommands too? e.g., `workos env --help --json` → only the env subtree. Leaning yes — more useful for agents exploring one command group.
- Yargs internal APIs are not stable. Need to check if `getCommandInstance()` is reliable or if we need to build the tree from our own registry. May need a parallel command registry.
