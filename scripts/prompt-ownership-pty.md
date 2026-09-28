# AUTH-6732 verification and integration notes

## Provenance

- Branch: `riker/13-complete-auth-6732-by-fixing-current-wor`
- Base: `2f199267d93fa5b966e677b77923663ccfee1919`
- Ownership/cancellation change: `bb5102c`
- Logging ownership follow-up: `2a72ab2`
- Adapted from Nick Nisi's [PR #216](https://github.com/workos/cli/pull/216), original commit `1953bed4131f0f1fd532e4291d7d4d0a47a7dfd7`. The actual four-file diff was read before implementation. Attribution is also in the first commit message.

## Changes

The UI facade has one spinner owner across terminal and hosted rendering. Replacement, stop, clear, and host teardown retire handles permanently. Only an actually drawn spinner line can be erased. Queued prompt callers reserve the terminal before awaiting input; existing and newly started spinners remain suspended until all questions settle. Handback resumes the current owner, never the entry handle. Terminal completion/error lines wait behind input; hosted warnings/errors remain immediately visible.

Prompt requests retain their host and are cancelled on host teardown rather than opening a late inquirer question. A one-turn queued handoff lets the installer process cancellation before the next question opens. The adapter counts queued prompt callers, supplies its cancellation signal to every prompt, and drains its handlers before normal hosted teardown. Exit/signal teardown also detaches CLI handlers.

Agent success ends the spinner without requiring validation (Rails/`--no-validate`); failure, completion, cancellation and stop retire animation. Logging no longer stops/recreates adapter spinners: the facade borrows the current owner's line. This prevents a stale adapter handle from reclaiming an obsolete phase. Hosted logs are delivered in their original phase to preserve transcript filtering.

No prompt widgets, UI libraries, selection/headless policy, auth recovery, or commit/PR policy were replaced or removed.

## Automated evidence (Bun 1.4.2, macOS arm64)

### Deterministic timers and controlled input promises

`src/utils/ui.spec.ts` uses fake timers and controllable inquirer/host promises. It covers retired timers, inert stale operations (including start), multiple 80ms ticks during input, replacement/update/stop/clear during queued input, current-owner resume, rejection, pre-abort, hosted status ownership/teardown, and JSON/non-TTY guards.

`src/lib/adapters/cli-adapter.coordination.spec.ts` uses the real facade and real adapter, mocking only the input transport. Synthetic events cover Rails/no-validation and validation completion, queued answer routing, buffered file/tool logs, newer external ownership, cancellation before a queued sibling opens, failure, completion, SIGINT and adapter stop. Tests assert terminal writes and timer counts, not spinner mock call counts.

Two regressions were observed red before fixing: stale handles erased/restarted terminal output; tool logging resurrected an obsolete adapter phase over a newer facade owner.

### Fake Ink streams (not PTYs)

`src/lib/adapters/tui-adapter.spec.ts` uses the existing fake terminal streams and real Ink/CLI/facade code. New tests assert visible questions and resulting installer events during phase changes, password masking, transcript filtering, warning visibility, queued teardown, exit-hook cleanup, raw-mode restoration and removal of input listeners.

Targeted command: **9 files / 250 tests passed**.

```sh
bun run test src/utils/ui.spec.ts \
  src/lib/adapters/cli-adapter.spec.ts \
  src/lib/adapters/cli-adapter.coordination.spec.ts \
  src/lib/adapters/tui-adapter.spec.ts \
  src/lib/adapters/headless-adapter.spec.ts \
  src/lib/adapters/select-adapter.spec.ts src/tui
```

### Real PTYs

```sh
python3 scripts/prompt-ownership-pty.py
```

**6/6 passed**, separately from the fake-stream tests:

- CLI/inquirer: queued No/Yes answers, Ctrl-C with a queued sibling, stop during unanswered input.
- Hosted Ink: the same three flows, using the normal live renderer.

Each subprocess runs at 100×30, keeps a real question open across synthetic agent completion and spinner replacement, and verifies silence over multiple spinner ticks. The driver sends actual PTY bytes. The fixture checks resulting installer events, host cleanup, adapter subscriptions and input listeners. The driver checks restored terminal attributes, alternate-screen exit, cursor restoration, no moot queued question and no stale output after stop.

The harness uses Python's standard-library PTY facilities, ephemeral HOME/config/temp directories inside this worktree, no inherited credentials, forbidden keyring/config access and rejected network fetches. Yoga uses its embedded-WASM fallback. Waits are bounded and subprocess groups are killed on failure. No installer machine, auth/model call, Git operation, provisioning or publication runs. Fixture events named commit/PR only ask questions; their handler records answers without executing actions.

Ink's `restore-cursor` dependency deliberately keeps a process-exit hook. Its final show-cursor escape is allowed after teardown; text, erasure, animation and prompts are not.

### Full checks and build

Latest complete run:

```sh
bun run test && bun run typecheck && bun run lint && bun run format:check
bun run build
```

- Tests: **170 files / 3228 tests passed**.
- TypeScript, oxlint, oxfmt: **passed**.
- Standalone Bun build: **passed**, 2117 modules.
- Dependency installation: `bun install --frozen-lockfile`; no lockfile change. Generation remained in this worktree.

**Baseline flake, not fixed here:** two full-suite attempts failed in `src/doctor/checks/skills-fix.spec.ts:180/183`, seeing either `null` or only `workos` instead of `workos` plus `workos-widgets`. The test passed in isolation. An untouched archive of the base commit, created and run entirely inside this worktree with its own temp directory, reproduced the missing-widget failure (3202 passed / 1 failed). A subsequent final check on this branch passed in full. Riker may encounter this existing parallel skills-extraction test flake. The temporary baseline archive was removed.

## Limits and integration

- PTY evidence is macOS arm64, Bun 1.4.2, one supported terminal size. Linux/Windows terminals, resize/wrapping, SSH/multiplexer behavior and human visual inspection were not verified by this harness. No live Rails/AI install was run.
- AUTH-6733/6735 may overlap `src/utils/ui.ts` and `src/lib/adapters/cli-adapter.ts`. Preserve facade-owned retirement and log pause/resume; do not reintroduce adapter stop/restart around logs or unconditional erasure before a new phase.
- Keep cancellation signals on every prompt and count queued callers, not a boolean. Preserve awaited CLI stop before hosted teardown. Auth fallback still clears its phase before manual credentials; post-install commit/PR questions and their policy remain intact.
- TUI changes are limited to exit/signal cleanup and tests; its model, inline prompt components, content, transcript masking and selection policy remain in place.
