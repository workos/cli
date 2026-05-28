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
- **Headless flags**: `--no-branch`, `--no-commit`, `--create-pr`, `--no-git-check`

## Tech Constraints

- **pnpm** only
- Avoid Node-specific sync APIs (crypto, fs sync) unless necessary

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) — release-please auto-generates changelog. Use `!` suffix for breaking changes (e.g., `feat!:`).

## Commands

```bash
pnpm build        # Build the project
pnpm dev          # Dev mode (build + watch + link)
pnpm test         # Run tests
pnpm typecheck    # Type check
```

## Adding a New Framework

1. Create `src/{framework}/{framework}-installer-agent.ts`
2. Add to `Integration` enum in `lib/constants.ts`
3. Add detection logic in `lib/config.ts`
4. Wire up in `run.ts` switch statement

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
- Use npm or yarn -- pnpm only
- Skip JSON mode tests in spec files
- Forget to wire up new frameworks in `src/run.ts` switch statement

## PR Checklist

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Conventional Commit message format used (`feat:`, `fix:`, `feat!:` for breaking)
- [ ] New commands include JSON mode support and tests
