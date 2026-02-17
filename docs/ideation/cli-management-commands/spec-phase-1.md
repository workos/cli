# Implementation Spec: CLI Management Commands - Phase 1

**Contract**: ./contract.md
**Estimated Effort**: M

## Technical Approach

Phase 1 builds the config store and environment management commands. The config store follows the exact pattern from `credential-store.ts` — a second keyring entry (`workos-cli/config`) with JSON file fallback. Environment commands use yargs subcommands (matching the existing pattern in `bin.ts`) and clack prompts for interactive input.

The API key resolution chain is: `WORKOS_API_KEY` env var → `--api-key` flag → active environment's stored key → error. This resolution is a shared utility that Phase 2's organization commands will also consume.

## Feedback Strategy

**Inner-loop command**: `pnpm test -- config-store`

**Playground**: Test suite — the config store and API key resolution are pure data logic best validated by unit tests. Environment commands can be tested with `pnpm build && workos env --help`.

**Why this approach**: Config store is data-layer logic; tests are the tightest loop. Env commands are CLI tools validated by running them.

## File Changes

### New Files

| File Path                      | Purpose                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `src/lib/config-store.ts`      | Keyring-backed config storage (environments, active env, API keys) |
| `src/lib/config-store.spec.ts` | Unit tests for config store                                        |
| `src/lib/api-key.ts`           | API key resolution: env var → flag → active environment → error    |
| `src/lib/api-key.spec.ts`      | Unit tests for API key resolution                                  |
| `src/commands/env.ts`          | Environment management commands (add, remove, switch, list)        |
| `src/commands/env.spec.ts`     | Unit tests for env commands                                        |

### Modified Files

| File Path    | Changes                                              |
| ------------ | ---------------------------------------------------- |
| `src/bin.ts` | Register `workos env` command group with subcommands |

## Implementation Details

### Config Store

**Pattern to follow**: `src/lib/credential-store.ts`

**Overview**: A keyring-backed store for CLI configuration, storing environment definitions and the active environment name. Uses the same `@napi-rs/keyring` library with the same fallback-to-file pattern, but a different account name.

```typescript
export interface EnvironmentConfig {
  name: string;
  type: 'production' | 'sandbox';
  apiKey: string;
  endpoint?: string; // Custom API endpoint (for local dev)
}

export interface CliConfig {
  activeEnvironment?: string;
  environments: Record<string, EnvironmentConfig>;
}

// Keyring entry: service='workos-cli', account='config'
// File fallback: ~/.workos/config.json
```

**Key decisions**:

- Second keyring entry (same service, different account) — separates volatile auth tokens from stable config
- `CliConfig` is the full blob stored as JSON in keyring, mirroring how `Credentials` works
- File fallback at `~/.workos/config.json` (not `~/.workos.json` — that was the Go CLI's location)
- Respects the same `forceInsecureStorage` flag as credential-store

**Implementation steps**:

1. Create `config-store.ts` with `CliConfig` and `EnvironmentConfig` interfaces
2. Implement keyring read/write with `Entry(SERVICE_NAME, 'config')` — reuse the same `SERVICE_NAME = 'workos-cli'`
3. Implement file fallback at `~/.workos/config.json` with `0o600` permissions
4. Export CRUD functions: `getConfig()`, `saveConfig()`, `clearConfig()`, `getActiveEnvironment()`
5. Support `setInsecureStorage()` for the `--insecure-storage` flag (can share the module-level flag from credential-store, or accept it as a parameter)

**Feedback loop**:

- **Playground**: Create `config-store.spec.ts` with describe blocks for read/write/keyring-fallback before implementing
- **Experiment**: Test empty config, single environment, multiple environments, active environment switch, keyring failure fallback
- **Check command**: `pnpm test -- config-store`

### API Key Resolution

**Overview**: A utility that resolves the API key for management commands, checking multiple sources in priority order.

```typescript
export interface ApiKeyOptions {
  apiKey?: string; // From --api-key flag
}

/**
 * Resolve API key from (in priority order):
 * 1. WORKOS_API_KEY environment variable
 * 2. --api-key flag value
 * 3. Active environment's stored API key
 *
 * Throws with helpful message if no key found.
 */
export function resolveApiKey(options?: ApiKeyOptions): string;

/**
 * Get the API base URL. Custom endpoint from active env, or default.
 */
export function resolveApiBaseUrl(): string;
```

**Key decisions**:

- Env var takes highest priority (CI/headless use case, matching Go CLI's pattern)
- Flag is second (explicit per-command override)
- Stored config is last (default for interactive use)
- Throws a clear error if no key is found, directing user to `workos env add`

**Implementation steps**:

1. Check `process.env.WORKOS_API_KEY`
2. Check `options.apiKey` (from --api-key flag)
3. Call `getActiveEnvironment()` from config-store
4. Throw descriptive error if all empty

**Feedback loop**:

- **Playground**: Create `api-key.spec.ts` with describe blocks before implementing
- **Experiment**: Test all resolution paths — env var set, flag provided, stored config, no key at all
- **Check command**: `pnpm test -- api-key`

### Environment Commands

**Pattern to follow**: `src/commands/login.ts` (for command structure), `src/bin.ts` (for yargs registration)

**Overview**: Four subcommands under `workos env`: add, remove, switch, list. Interactive prompts via clack when arguments are omitted (matching Go CLI's interactive behavior with `huh`).

```typescript
// workos env add [name] [apiKey] [--endpoint URL]
export async function runEnvAdd(options: { name?: string; apiKey?: string; endpoint?: string }): Promise<void>;

// workos env remove <name>
export async function runEnvRemove(name: string): Promise<void>;

// workos env switch [name]
export async function runEnvSwitch(name?: string): Promise<void>;

// workos env list
export async function runEnvList(): Promise<void>;
```

**Key decisions**:

- `env add` without args → interactive prompts (name, type, API key) via clack, matching Go CLI's huh prompts
- `env add <name> <apiKey>` → non-interactive, for scripting
- `env list` shows table with active indicator (chalk green for active)
- `env switch` without name → interactive select prompt from available envs
- Name validation: lowercase alphanumeric + hyphens + underscores (matching Go CLI's regex `[a-z0-9\-_]+`)

**Implementation steps**:

1. Create `env.ts` with all four command handlers
2. `runEnvAdd`: if args provided, validate and store directly; if not, prompt with clack
3. `runEnvRemove`: validate name exists, remove from config, save
4. `runEnvSwitch`: if name provided, validate and switch; if not, show select prompt
5. `runEnvList`: read config, format as table with chalk (ID, Name, Type, Endpoint, Active indicator)
6. Register in `bin.ts` as `yargs.command('env', ...)` with subcommands

**Feedback loop**:

- **Playground**: Build, then test with `workos env --help`, `workos env add`, `workos env list`
- **Experiment**: Add two environments, switch between them, list (verify active indicator), remove one
- **Check command**: `pnpm build && node dist/bin.js env list`

### bin.ts Registration

**Pattern to follow**: existing command registrations in `src/bin.ts` (login, logout, doctor, install-skill)

**Overview**: Register the `workos env` command group with its subcommands in the yargs chain.

**Implementation steps**:

1. Add `env` command with subcommands: `add`, `remove`, `switch`, `list`
2. `add` takes optional positional args `[name] [apiKey]` + `--endpoint` flag
3. `remove` takes required positional `<name>`
4. `switch` takes optional positional `[name]`
5. `list` takes no args
6. All env subcommands get `--insecure-storage` option
7. No auth required for env commands (they manage local config, not API calls)

## Testing Requirements

### Unit Tests

| Test File                      | Coverage                                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| `src/lib/config-store.spec.ts` | Config CRUD, keyring fallback, file permissions, empty config handling |
| `src/lib/api-key.spec.ts`      | All resolution paths, error messages, env var precedence               |
| `src/commands/env.spec.ts`     | Add/remove/switch/list logic, name validation, duplicate handling      |

**Key test cases**:

- Config store reads/writes to keyring successfully
- Config store falls back to file when keyring unavailable
- Config store handles empty/missing config gracefully
- API key resolution follows priority chain correctly
- API key resolution throws clear error when no key available
- `env add` validates name format (lowercase alphanumeric, hyphens, underscores)
- `env add` rejects duplicate environment names
- `env remove` errors gracefully for non-existent environments
- `env switch` errors for non-existent environment name
- `env list` shows empty state message when no environments configured

## Error Handling

| Error Scenario                    | Handling Strategy                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Keyring unavailable               | Fall back to file storage, show warning once (same as credential-store)                                      |
| No environments configured        | Clear error: "No environments configured. Run `workos env add` to get started."                              |
| Invalid environment name          | Reject with regex explanation: "Name must contain only lowercase letters, numbers, hyphens, and underscores" |
| Duplicate environment name        | Ask to overwrite or reject with message                                                                      |
| Non-existent env on remove/switch | Error with available environment names listed                                                                |

## Validation Commands

```bash
# Type checking
pnpm typecheck

# Unit tests
pnpm test

# Build
pnpm build

# Manual smoke test
node dist/bin.js env --help
```

## Open Items

- [ ] Should `env add` auto-switch to the new environment if it's the first one added? (Go CLI does not, but it's a better UX)
- [ ] Should we warn if the API key format looks invalid (doesn't start with `sk_` or `sk_test_`)?

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
