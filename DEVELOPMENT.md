# Development Guide

## Project Structure

```
src/
├── bin.ts                    # CLI entry point (yargs command routing)
├── cli.config.ts             # App configuration (model, URLs)
├── run.ts                    # Installer orchestration entry point
├── lib/
│   ├── agent-runner.ts       # Core agent execution
│   ├── agent-interface.ts    # Claude Agent SDK interface
│   ├── installer-core.ts     # Headless installer core (XState)
│   ├── config.ts             # Framework detection config
│   ├── constants.ts          # Integration types, shared constants
│   ├── credential-store.ts   # OAuth credential storage (keyring + file fallback)
│   ├── config-store.ts       # Environment config storage (keyring + file fallback)
│   ├── api-key.ts            # API key resolution (env var → flag → config)
│   ├── workos-api.ts         # Generic WorkOS REST API client
│   ├── credential-proxy.ts   # Token refresh proxy for long sessions
│   ├── ensure-auth.ts        # Startup auth guard
│   └── adapters/             # CLI and dashboard adapters
├── commands/
│   ├── env.ts                # workos env (add/remove/switch/list)
│   ├── organization.ts       # workos organization (create/update/get/list/delete)
│   ├── user.ts               # workos user (get/list/update/delete)
│   ├── install.ts            # workos install
│   ├── install-skill.ts      # workos install-skill
│   ├── auth-status.ts        # workos auth status
│   ├── login.ts              # workos auth login
│   └── logout.ts             # workos auth logout
├── dashboard/                # Ink/React TUI components
├── nextjs/                   # Next.js installer agent
├── react/                    # React SPA installer agent
├── react-router/             # React Router installer agent
├── tanstack-start/           # TanStack Start installer agent
├── vanilla-js/               # Vanilla JS installer agent
└── utils/
    ├── table.ts              # Terminal table formatter
    ├── clack-utils.ts        # CLI prompts
    ├── debug.ts              # Logging with redaction
    ├── redact.ts             # Credential redaction
    └── ...                   # Additional utilities
```

## Setup

```bash
# Install dependencies
bun install

# Build
bun run build
```

## Development Workflow

```bash
# Run the TypeScript source in watch mode
bun run dev

# Test installer in another project
cd /path/to/test/nextjs-app
workos dashboard

# Test management commands
workos env add sandbox sk_test_xxx
workos organization list
workos user list
```

## Commands

```bash
# Build
bun run build

# Clean and rebuild
bun run clean && bun run build

# Format code
bun run format

# Check types
bun run typecheck

# Run tests
bun run test
bun run test:watch
```

## TypeScript Configuration

- **Target:** ES2022
- **Module:** NodeNext (ESM)
- **Strict mode** enabled
- **JSX:** react-jsx (for Ink/React dashboard)

## Output Mode vs Interaction Mode

The CLI separates two axes:

| Axis                 | Question                        | API                                                                                                      |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Output mode**      | How should output be formatted? | `isJsonMode()` from `src/utils/output.ts`                                                                |
| **Interaction mode** | Who is driving the CLI?         | `isHumanMode()`, `isAgentMode()`, `isCiMode()`, `isPromptAllowed()` from `src/utils/interaction-mode.ts` |

Guidelines for new code:

- Use `isJsonMode()` **only** to choose between structured JSON and human-formatted output. Do not use it to decide whether to prompt, open a browser, or skip a confirmation.
- Use `isPromptAllowed()` (== `isHumanMode()`) before any clack prompt or interactive flow.
- Use `isAgentMode()` to add agent-specific recovery hints, manual-fallback wording, or host-execution warnings.
- Use `isCiMode()` to refuse browser-based flows and to prefer terse failures over recovery handoff text.
- For destructive operations, require an explicit `--yes`/`--force` flag whenever `!isPromptAllowed()` regardless of output mode.
- For `auth_required` and other deterministic failures, attach recovery metadata via `src/utils/recovery-hints.ts` so agents can parse `error.recovery.hints[]`.

Mode resolution — do not regress these:

- `WORKOS_MODE=agent` maps to agent interaction behavior **and** JSON output (via `resolveEffectiveOutputMode`). The old `WORKOS_NO_PROMPT` alias has been removed.
- `WORKOS_FORCE_TTY=1` only affects output mode (forces human). It must not change interaction mode.
- Non-TTY stdout still defaults output to JSON and interaction to agent.
- `isNonInteractiveEnvironment()` from `src/utils/environment.ts` is a thin wrapper over `!isHumanMode()` kept for backward compatibility. Prefer the explicit interaction-mode predicates in new code.

The full backwards-compat matrix lives in `src/utils/mode-compatibility.spec.ts`.

## Making Changes

### Adding a New Framework

1. Create `src/integrations/your-framework/index.ts`
2. Export a `FrameworkConfig` as `config` and an installer function as `run`
3. Run `bun run generate` to refresh the static integration manifest
4. Add detection and validation coverage

See `src/integrations/nextjs/index.ts` as a reference.

### Generated Manifests

`bun run generate` produces **three** manifests (it runs automatically before
`build`, `test`, and `typecheck`, and after `bun install`):

- `src/integrations/_manifest.ts` — static imports for every integration (committed; CI fails if it drifts from the directory listing)
- `src/generated/skills-manifest.ts` — embeds every file of the `@workos/skills` plugin tree into the binary (gitignored: contains absolute paths)
- `src/generated/agent-sdk-manifest.ts` — pins the target platform's native Claude Agent SDK `claude` executable: version, npm tarball URL, and sha256 (gitignored: target-specific). The executable is **not** embedded; a compiled binary downloads it on first agent use, verifies the checksum, and caches it under `~/.workos/cache/agent-sdk/`

Set `WORKOS_BUILD_TARGET` (e.g. `bun-linux-x64-baseline`) to generate/build
for a non-host platform; the same value must be used for both `generate` and
the compile, which `bun run build` (via `scripts/build.ts` + the `prebuild`
hook) guarantees.

### Why `react-devtools-core` is a devDependency

Nothing in `src/` imports `react-devtools-core`, but it is required to
**build**, not to run. The dashboard TUI (`src/dashboard/`) uses `ink`, whose
reconciler does a runtime-gated `await import('./devtools.js')` that only fires
when `DEV=true`; `devtools.js` then _statically_ imports `react-devtools-core`.
`bun build --compile` follows that static import at bundle time and cannot prove
the `DEV` branch is dead, so removing the devDependency fails the compile with
`error: Could not resolve: "react-devtools-core"` (do not "clean it up"). As a
result it is also bundled into every shipped binary, costing ~742 KiB
(measured: 72,512,032 → 71,752,480 bytes when excluded). Do **not** try to trim
it with `--external react-devtools-core`: that compiles, but bun resolves the
external eagerly and the standalone binary then crashes on _every_ command
(even `--version`) with `Cannot find package 'react-devtools-core'`. The ~742 KiB
is the price of keeping the compile green and the dev-mode fallback graceful.

### Updating Integration Instructions

The installer prompt in `agent-runner.ts` tells Claude to:

1. Fetch live docs from workos.com
2. Fetch SDK README from GitHub/npm
3. Follow official documentation

To change instructions, edit `buildIntegrationPrompt()` in `lib/agent-runner.ts`.

### Adding Security Features

Credential redaction is in `utils/redact.ts`. Add patterns:

```typescript
export function redactCredentials(obj: any): any {
  // Add new patterns here
  const redacted = JSON.stringify(obj).replace(/sk_test_[a-zA-Z0-9]+/g, (match) => `sk_test_...${match.slice(-3)}`);
  return JSON.parse(redacted);
}
```

## Testing

**Manual testing:**

1. Run installer in a test app: `workos dashboard`
2. Check logs at `~/.workos/logs/workos-{timestamp}.log`
3. Verify integration works in test app

**What to test:**

- Framework detection
- API key masking (should show `*****`)
- Log redaction (keys show as `sk_test_...X6Y`)
- SDK installation
- File creation
- Environment variables
- UI components

**Smoke testing the npm distribution:**

`scripts/npm-dist-smoke.ts` publishes the generated npm packages to a
throwaway local registry (Verdaccio) and drives the real user flows —
`npx workos`, `npm install -g workos`, platform selection, and the
launcher's no-binary error path — from a hermetic environment (fresh
HOME/cache/prefix, sanitized PATH, no uplinks so nothing can leak to the
real registry). CI runs it on every PR and the release pipeline runs it as a
pre-publish gate. Locally:

```bash
bun run build
bun run ./scripts/npm-dist-smoke.ts   # generates a host-only dist/npm if absent
```

**Smoke testing the command contract:**

`scripts/command-smoke.sh` executes real commands against a compiled binary
and asserts the non-TTY contract: exit codes (0 success, 1 error, 4 auth
required), structured JSON errors on stderr, and JSON output. It is
offline-safe — CI runs it in a `--network none` container, and the release
pipeline runs it against every platform binary on native hardware. Locally:

```bash
bun run build
sh scripts/command-smoke.sh ./dist/workos
```

With `WORKOS_API_KEY` set to a staging-environment key, it also runs an
authenticated section (organization list + create → get → delete round-trip).
CI provides this via the `WORKOS_SMOKE_API_KEY` repository secret; fork PRs
receive no secrets and skip it.

## Evaluations

Automated eval framework for testing installer skills across frameworks and project states.

```bash
bun run eval                    # Run all scenarios
bun run eval --framework=nextjs # Single framework
bun run eval --quality          # Include LLM quality grading
bun run eval:history            # List recent runs
bun run eval:diff <id1> <id2>   # Compare runs
```

See [tests/evals/README.md](./tests/evals/README.md) for full documentation.

## Debugging

**Verbose logs:**

```bash
workos --debug
```

**Check logs:**

```bash
tail -f ~/.workos/logs/workos-{timestamp}.log
```

## Releasing

Releases are fully automated via release-please + GitHub Releases (there is no
npm publish; users download platform binaries):

1. Merging to `main` updates the release-please PR; merging that PR creates a
   **draft** GitHub release and pushes its tag immediately
   (`force-tag-creation`).
2. `release.yml` cross-compiles all eight platform binaries (macOS arm64/x64,
   Linux glibc + musl on x64/arm64, Windows x64/arm64), smoke tests each
   one **on native hardware** for its platform (including
   `workos internal verify-assets`, which checks the keyring native binding
   loaded, downloads the pinned Agent SDK executable, verifies its checksum,
   and spawns it), attaches them to the draft, and only then publishes it.
   `releases/latest` never points at a partial or untested release.
3. After the GitHub release publishes, `publish-npm` regenerates the npm
   distribution (`scripts/gen-npm-packages.ts`): a thin `workos` launcher
   package plus one `@workos/cli-<platform>-<arch>` package per binary,
   published via npm trusted publishing (OIDC). npm is a secondary channel —
   it never leads GitHub Releases, and a failed npm publish is re-runnable in
   isolation.

Operational notes:

- **A leg failed:** the release stays an invisible draft and the previous
  release remains `latest`. Fix the problem, then either "Re-run failed jobs"
  on the same run or trigger `release.yml` manually via `workflow_dispatch`
  with the tag name.
- **Abandoning a draft:** delete BOTH the draft release and its tag, or
  release-please will treat that version as shipped.
- **Bumping the pinned Bun version** (`ci.yml`, `release.yml`,
  `packageManager`) is a smoke-gated event: Bun has shipped releases that
  broke cross-compiled macOS code signatures (oven-sh/bun#29120 — binaries
  SIGKILL on Apple Silicon). The native macOS smoke leg is the regression
  gate; never bypass it.

## Questions?

See [README](./README.md) for user-facing docs.
