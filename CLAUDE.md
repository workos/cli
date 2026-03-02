# workos CLI

WorkOS CLI for installing AuthKit integrations and managing WorkOS resources (organizations, users, environments).

## Architecture

- Three adapters (CLI, Dashboard, Headless) subscribe to `InstallerEventEmitter` state machine events, selected by TTY detection
- `OutputMode` (`human`/`json`) resolved once at startup in `bin.ts`, drives all formatting
- `installerCanUseTool()` in `agent-interface.ts` restricts Bash to safe commands only
- Config/credentials stored in system keyring with file fallback

## Non-TTY Behavior

- **Output**: Auto-switches to JSON when piped or `--json` flag. `WORKOS_FORCE_TTY=1` overrides.
- **Auth**: Exits code 4 instead of opening browser. Requires prior `workos login` or `WORKOS_API_KEY` env var.
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
