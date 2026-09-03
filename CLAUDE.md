# workos CLI

WorkOS CLI for installing AuthKit integrations and managing WorkOS resources (organizations, users, environments).

## Architecture

- Three adapters (CLI, Dashboard, Headless) subscribe to `InstallerEventEmitter` state machine events, selected by TTY detection
- `OutputMode` (`human`/`json`) resolved once at startup in `bin.ts`, drives all formatting
- `installerCanUseTool()` in `agent-interface.ts` restricts Bash to safe commands only
- Config/credentials stored in system keyring with file fallback

## Non-TTY Behavior

- **Output**: Auto-switches to JSON when piped or `--json` flag. `WORKOS_FORCE_TTY=1` overrides.
- **Auth**: Exits code 4 instead of opening browser. Requires prior `workos auth login` or `WORKOS_API_KEY` env var.
- **Errors**: Structured JSON to stderr: `{ "error": { "code": "...", "message": "..." } }`
- **Exit codes**: 0=success, 1=error, 2=cancelled, 4=auth required (follows `gh` CLI convention)
- **Headless flags**: `--no-branch`, `--no-commit`, `--create-pr`, `--no-git-check`. CI mode (`WORKOS_MODE=ci`) auto-continues past a dirty tree without `--no-git-check`; agent mode requires the flag.

## Tech Constraints

- **Bun** only; the shipped CLI is a Bun-compiled standalone binary
- Runtime assets must be statically imported or materialized from the compiled binary. Two exceptions: (1) the Agent SDK `claude` executable is downloaded on first agent use — pinned by version + sha256 in the generated manifest — and cached under `~/.workos/cache/agent-sdk/`; (2) runtime dep bundles (`@workos/migrations`, `@workos/emulate`) are resolved from the npm registry against semver ranges baked in the generated manifest (only versions strictly newer than the compiled-in one, also baked, are ever run; the cache is shared across CLI installs), integrity-verified, cached under `~/.workos/cache/<dep>/`, and always fall back to the compiled-in module (`WORKOS_RUNTIME_DEPS=0` kill switch) — see `src/lib/runtime-assets.ts`

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) — release-please auto-generates changelog. Use `!` suffix for breaking changes (e.g., `feat!:`).

## Commands

```bash
bun run build        # Build the standalone binary
bun run dev          # Run source in watch mode
bun run test         # Run tests
bun run typecheck    # Type check
```

## Adding a New Framework

1. Create `src/integrations/{framework}/index.ts` exporting `config` and `run`
2. Run `bun run generate` to refresh `src/integrations/_manifest.ts`
3. Add or update detection and validation tests for the integration

## Adding a New Resource Command

1. Create `src/commands/{resource}.ts` + `{resource}.spec.ts` (follow patterns in `organization.ts`)
2. Register in `src/bin.ts` and update `src/utils/help-json.ts` command registry
3. Include JSON mode tests in spec file

## Telemetry Wiring for New Commands

All commands automatically emit a `command` telemetry event with name, duration, and success/failure. The centralized lifecycle in `bin.ts` (`runCli()`) handles this — no manual wrapping required.

**Subcommands via `registerSubcommand()`** — auto-tracked. Just write the handler:

```typescript
.command('user', 'Manage users', (yargs) => {
  registerSubcommand(yargs, 'reset-password', '...', (y) => y,
    async (argv) => { await runResetPassword(argv); },
  );
})
```

**Top-level `.command()` with inline handler** — also auto-tracked:

```typescript
.command(
  'migrate',
  'Migrate from another provider',
  (yargs) => yargs.options({...}),
  async (argv) => {
    await runMigrate(argv);
  },
)
```

**Exiting with errors:** Use `exitWithError()` or `exitWithCode()` from handlers — they throw `CliExit` which the lifecycle catches, classifies, and records.

**Skip list**: Commands in `SKIP_TELEMETRY_COMMANDS` (`command-telemetry.ts`) are excluded from command-level telemetry because they have their own session-based telemetry. Currently: `install`, `dashboard`, `root` (the default `$0` handler).

**Aliases**: if you register a command with multiple names (e.g., `['organization', 'org']`), add the alias to `src/lib/command-aliases.ts` so metrics don't fragment.

## Do / Don't

**Do:**

- Follow the adapter pattern (`CLI`, `Dashboard`, `Headless`) in `src/integrations/` when adding framework installers
- Use `InstallerEventEmitter` for state machine events -- see existing adapters for examples
- Add both human and JSON output modes -- check `OutputMode` usage in `src/bin.ts`
- Follow existing command patterns in `src/commands/organization.ts` when adding resource commands
- Write `.spec.ts` tests alongside every command file

**Don't:**

- Use Node-specific sync APIs (crypto, fs sync) unless necessary
- Add runtime filesystem discovery or import.meta.url-relative package asset reads
- Skip JSON mode tests in spec files
- Forget to wire up new frameworks in `src/run.ts` switch statement

## PR Checklist

- [ ] `bun run build` passes
- [ ] `bun run test` passes
- [ ] `bun run typecheck` passes
- [ ] Conventional Commit message format used (`feat:`, `fix:`, `feat!:` for breaking)
- [ ] New commands include JSON mode support and tests
