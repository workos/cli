# AUTH-6736 — Fizzy acceptance fixture (incomplete)

**This is preparation and offline regression evidence, not a successful Fizzy installation.** No paid agent, OAuth login, dashboard write, provisioning, hosted AuthKit flow, or Rails/browser session test was executed in this job. Account policy remains undecided, as confirmed by Riker.

## Source and local evidence

- CLI starting HEAD: `2f199267d93fa5b966e677b77923663ccfee1919` (0.23.0).
- Inspected merged PR250's final code at `586b2fa1b88a9631accd4b4d69f28468a4f08760`, plus current HEAD. Its single-target sandbox/read-back application setup remains authoritative. Relevant all-ref history was inspected; no recorded Fizzy rerun or linked ticket PR was established. This is not a claim that no unlinked work exists.
- Source: <https://github.com/basecamp/fizzy>, commit `477c943e0506f109e5bc83ae9dadbe519732c045`.
- Downloaded codeload archive SHA-256: `4cfc52d62d082f304a946dcf02d6097886100f1430eb502daf503e9f2439a628`. Preparation fails closed on another checksum; do not automatically refresh it if GitHub archive packaging changes.
- License: **O'Saasy**, copyright © 2025, 37signals LLC; not MIT or unrestricted hosting permission. The complete `LICENSE.md` stays in the extracted fixture. No app source is vendored here; descriptor and harness code only. No hosting/deployment work.
- Actual prepared checkout: `.artifacts/fizzy-prepared/app`; clean local baseline commit `06cbd18ca38292be7c47d176cb8e6f5928736796`. Future baseline hashes can differ due to commit timestamps; the upstream archive pin/hash is authoritative. Each preparation records its local baseline in `artifacts/fixture.json`.
- Source patches: none. Seeds: none. Baseline identity: none. No existing database was read or reset.
- Bun: **1.4.2**. Required Ruby: **3.4.8**; Bundler: **4.0.18**. Actual local preflight found Ruby **4.0.7**, Bundler **4.0.20**: unavailable for this pinned app. No dependency/bootstrap command was run.
- Locked Rails: `8.2.0.alpha`, Git revision `3df2cbea2027026a29edb92cbb7e336a63e35444`; the remaining public Git/gem dependency revisions/checksums stay in upstream `Gemfile.lock`. Bootstrap uses frozen resolution, not `bundle update`.
- Bundled `@workos/skills`: **0.7.3**, Ruby reference loaded through `skills-assets.ts`. Agent SDK: **0.3.211**. Configured model: **claude-opus-4-5-20251101** (not executed). WorkOS Ruby gem version is **not yet established**; a future run must retain its resolved lockfile/version and API documentation snapshot.

Ignored local evidence is under `.artifacts/`: `rails-red.log` (5 failing regressions before fix), `rails-green.log`, `orchestration.log`, `fixture-tests.log`, `fizzy-prepare.log`, `fizzy-preflight.json`, `check.log`, and `build.log`. These artifacts are local, not published.

## Why the development port is 3006

The pinned `docs/development.md` recommends `bin/setup`, then `bin/dev`, at `http://app.fizzy.localhost:3006`. Inspection showed:

- `config/puma.rb` defaults to `ENV.fetch("PORT", 3000)`.
- `bin/dev` explicitly exports `PORT=3006`.
- Root `Procfile.dev` runs `bin/rails server -b 0.0.0.0 -p ${PORT:-3006}`.

Thus 3006 is **source-confirmed launcher configuration, not an observed running server**. Always supply the verified explicit callback `http://app.fizzy.localhost:3006/auth/callback` for this fixture. Generic CLI detection remains unchanged and does not special-case Fizzy.

`bin/setup` was read, **not executed**: it can install/upgrade system packages and mise, trust config, configure Git hooks, install tools, prepare/seed/reset databases, and select SaaS dependencies. `bin/dev` can install Foreman or opt into Tailscale/1Password/SaaS behavior. The harness bypasses both. No `--push`, `--tailscale`, `SAAS`, `tmp/saas.txt`, `Gemfile.saas`, MySQL, or private dependencies are allowed.

## Offline preparation (no credentials or model)

From the CLI worktree root:

```sh
mkdir -p .artifacts
# Public source network only; optional if the archive is already available.
bun tests/evals/fizzy.ts download .artifacts/fizzy-source.tar.gz
# New output path required. Never point this at an existing repository.
bun tests/evals/fizzy.ts prepare .artifacts/fizzy-prepared-new .artifacts/fizzy-source.tar.gz
bun tests/evals/fizzy.ts preflight .artifacts/fizzy-prepared-new
```

`prepare` verifies the archive before extracting, retains license notices, and makes an unsigned local baseline with a synthetic Git author and no global Git config/hooks. It does not execute project scripts, install dependencies, or import the eval executor/credential loader. `preflight` only checks tool versions and prepared archive/metadata; missing prerequisites exit nonzero and acceptance stays `unverified`.

After installing the exact runtime and native prerequisites **in an approved disposable toolchain**, explicit dependency bootstrap is:

```sh
bun tests/evals/fizzy.ts bootstrap .artifacts/fizzy-prepared-new
```

This runs `bundle install` and `bundle exec rails db:prepare` with `RAILS_ENV=test`, SQLite, isolated HOME/config/cache/gems/Bundler/temp paths and no inherited credentials/database/SaaS configuration. It refuses a dirty baseline, existing SQLite database, SaaS marker, or repeated successful bootstrap. It does not run development seeds or `db:reset`. A failed attempt should be discarded and prepared afresh, not repaired by resetting a database. Use a PATH containing actual approved tool binaries, not auto-installing shims. Native libraries/toolchain remain external prerequisites, not something this script installs.

Cleanup: retain redacted evidence first, then remove **only the newly created artifact root**. Existing `FixtureManager.cleanup()` owns removal for eval attempts, including failed preparation; unit tests cover this. No automatic cleanup of arbitrary user-supplied paths is provided.

## CLI changes and offline checks

The custom Ruby integration now writes the selected credential pair and resolved callback using existing env-file/backup/gitignore helpers; no secrets are embedded in its prompt. It tells the agent to load that file before SDK initialization. Rails does not load dotenv files automatically. The file choice follows the existing helper (`.env`, or `.env.local` if package.json is present), and both branches are tested.

The integration uses `resolveRedirectUri()` rather than hardcoded port 3000. Its legacy pre-agent REST setup was removed; common `runWithCore` remains the sole URL provisioning path. Its prompt uses the same callback origin for Initiate login, sign-out return and CORS, requires visible UI and real app session/account integration, and forbids inventing account policy or silently replacing authentication. Completion distinguishes instructions from observed credential writes and unverified behavior; common completion uses the configured callback origin and labels the Ruby dev command inferred, not verified.

Offline tests run the **real Ruby integration** with fake credentials/agent/network, plus the **real installer state machine** through Ruby and the common post-agent URL setup with a mocked backend. Existing production/sandbox, target selection, preservation, and read-back regression suites pass unchanged. New fixture tests mock command execution, use synthetic archive data, and cannot load credentials, download source or run models. Test setup replaces both native keyring and macOS security backends; keyring-isolation regressions are included in the full check.

`FizzyGrader` separates static source candidates from all six mandatory acceptance checks. It intentionally returns `passed: false` until a real behavioral/hosted acceptance mechanism exists. Unused SDK strings, missing routes/UI, hardcoded identities, duplicate provisioning, logout that leaves access, and even plausible source cannot become proven acceptance. Positive controls prove only that static observations are collected. The existing Sinatra `RubyGrader` remains unchanged; its `server.rb` syntax bonus is not used for Fizzy.

## Final local validation

Using Bun 1.4.2, `bun run test && bun run typecheck && bun run lint && bun run format:check` passed: **174 test files, 3,231 tests**, TypeScript, Oxlint and formatting all green. Existing Node `fs.rmdir` deprecation warnings were non-failing. `bun run build` also passed and produced `dist/workos`; the binary was not run against credentials or an app.

The real preparation command succeeded. The real offline preflight exited 1 as expected: pinned source verified, runtime prerequisites unavailable, acceptance unverified. Unit tests include positive and negative preflight/bootstrap/source-check controls without executing Ruby, Bundler, network or models.

## Evidence matrix

| Requirement                                                | Offline evidence                                                                   | Rails/browser evidence    | Hosted evidence             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- | --------------------------- |
| Signed-out login and signed-in account/logout UI           | Prompt regression; static candidates explicitly not proof                          | Unavailable               | Unverified                  |
| Callback creates intended identity/session/account context | Policy-preserving instructions; hardcoded-identity negative control                | Blocked by policy/runtime | Unverified                  |
| Repeat login does not duplicate provisioning               | Prompt regression; duplicate-provisioning negative control                         | Blocked by policy/runtime | Unverified                  |
| Logout denies protected access, old cookie replay fails    | Instructions distinguish local invalidation from upstream logout; negative control | Unavailable               | Unverified                  |
| Correct target/URLs; unrelated settings preserved          | Real orchestration with fake backend; existing sandbox/target/read-back tests      | App routes unverified     | No live dashboard read-back |
| Existing account boundaries/roles/routes/login methods     | No app auth code changed; explicit preservation requirement                        | Blocked by policy/runtime | Unverified                  |

No static grader is an account-isolation test, and a sandbox configuration read-back is not proof of session or UI behavior.

## Product decision gate — ask Nick

Fizzy's `Identity` owns sessions, users, accounts, magic links and passkeys; normalized `email_address` is not itself an approved WorkOS mapping policy. `User` belongs to an account, optionally an identity, and has role/active membership semantics. `Session` belongs to an identity. The authentication concern resumes signed session cookies, supports bearer access, establishes account context before authentication, and destroys the app session/clears its cookie on logout.

Before implementing or accepting callback/account behavior, obtain explicit answers:

1. Map WorkOS subject to which existing Identity key? Is email linking allowed, under which verification and conflict rules? What happens on email change or multiple candidate identities?
2. May an unknown identity/account be created? If so, when, by whom, and with what retry-safe uniqueness constraints?
3. Which account may be selected? How do multiple accounts, invitations, inactive users/accounts, roles and memberships constrain access? Does any WorkOS organization map to a Fizzy account?
4. Must magic-link/passkey and bearer-token entry points coexist? Which logout scopes are intended: current app session, other app sessions, WorkOS session, independently issued access tokens? Do not infer global revocation.

Pending answers block synthetic callback/account assertions and any claim of real acceptance; they do not block the preparation and CLI fixes delivered here. Do not implement `User.find_or_create_by(email:)` just to make an eval green.

## Future approved run — NOT executed here

**Explicit approval is required before spending, auth/login, resource creation or dashboard writes.** No dollar ceiling, sandbox access, or account policy has been approved. Have the operator approve the policy above, exact target client/environment, protected-page/account fixtures, logout scope, runtime/browser setup, cost ceiling and time bound first.

1. Use a disposable OS user/container/VM and a new fixture root. HOME alone does not isolate the system keychain. Use `--insecure-storage` with its private HOME for approved CLI reads/writes; never run credential-clearing/diagnostic commands against the host keychain. Keep all DBs, browser profiles, dependency caches and credentials under that disposable root. Deny unneeded outbound services. Do not copy Nick's profile or repositories.
2. Pin this branch's final CLI commit (`git rev-parse HEAD`) and compiled binary SHA-256, Bun 1.4.2, the fixture descriptor/archive SHA, skills 0.7.3, Agent SDK 0.3.211 and model `claude-opus-4-5-20251101`. Save these with `Gemfile.lock` before/after, resolved WorkOS Ruby gem version and documentation snapshots. The bundled reference fetches mutable upstream README/docs; this remaining reproducibility gap must be recorded, not described as pinned SDK behavior.
3. Prepare/bootstrap as above. Add a reviewed `AUTHKIT_ACCOUNT_POLICY.md` and synthetic test seed/assertion code to this disposable app only after policy approval; record their hashes/diff and baseline row counts. No production identities/data. Baseline here deliberately has no identity.
4. Operator supplies sandbox API key/client ID in the app's ignored, mode-0600 env file and direct model credentials through the disposable process environment, **not arguments, transcripts or committed files**. An approved dashboard session in the isolated storage is needed for full sign-out/Initiate login read-back; API-key-only setup can legitimately remain partial. Confirm key/client/session target alignment and capture redacted before-settings, including unrelated entries. Do not create resources just to bypass missing access.
5. Run the production installer from the disposable root with a **30-minute process-group wall-time limit**, one attempt, no outer retries. The Ruby custom agent currently has zero self-correction retries. Enforce a separately approved provider spend cap; wall time is not a cost cap. Equivalent CLI arguments (with the isolated environment/toolchain already applied) are:

   ```sh
   /absolute/path/to/pinned/workos install \
     --install-dir "$ROOT/app" \
     --redirect-uri http://app.fizzy.localhost:3006/auth/callback \
     --no-branch --no-commit --no-git-check --direct --json --insecure-storage
   ```

   Use the disposable job supervisor to retain stdout/stderr/exit code and terminate the entire descendant process group at the bound. Omit homepage override to test preservation, or explicitly approve one. No PR/push flags. Do not call the install complete when the agent exits.

6. With network stubs first, run the approved Rails request/session tests and synthetic fixture seed in **test** environment. Run the equivalent loopback launcher `bundle exec rails server -b 127.0.0.1 -p 3006` with `PORT=3006`, isolated environment and the app's verified env loader. Do not use the generic `rails server` completion hint as startup evidence. Confirm local hostname resolution/Host handling and actual origin before using hosted redirects.
7. Then, only with approved live access, drive the real hosted login/callback/logout and external Initiate login flow. Capture signed-out/signed-in screenshots, route responses, before/after Identity/Account/User counts and IDs, current account/role, old-cookie replay denial, cross-account denial and existing magic-link/passkey/routes regression results. Use synthetic identities across at least two accounts with active/inactive and role-boundary cases agreed in step 3. Record SDK logout response/destination without storing tokens. Repeat login must retain approved associations without duplicate provisioning.
8. Read back callback/CORS/sign-out/Initiate login in the selected sandbox and diff against the before-settings. Retain unrelated callbacks/origins/logout URIs/homepage/initiate-login values unless an explicit approved change was required. Verify routes in browser; dashboard values alone are insufficient.

Store sanitized run metadata, command results, source diff, lockfiles, test results, browser screenshots and redacted network/settings evidence in `$ROOT/artifacts/<attempt>/`. Raw env files, cookies, tokens, session dumps and keychain files must not be attached. Record unavailable checks as unavailable. Human review of the six requirements is still required; no evidence-import schema/checker currently upgrades the source grader to pass.

### Optional existing skills-eval selector (separate approval)

The existing runner recognizes **only the explicit pair** `--framework=ruby --state=fizzy`; neither default sweeps nor Ruby sweeps include it. It requires a verified local `FIZZY_ARCHIVE` and `FIZZY_APPROVED_RUN=1` before bootstrap or executor construction. The flag records operator intent; it is not itself policy approval or acceptance evidence.

After separate approval, with isolated process HOME/config and credential setup per `tests/evals/README.md` (root `.env.local` must contain only the approved eval credentials):

```sh
FIZZY_APPROVED_RUN=1 FIZZY_ARCHIVE=/absolute/path/to/pinned-source.tar.gz \
  bun run eval --framework=ruby --state=fizzy --retry=0 --sequential --no-correction --keep
```

This means one scenario, one attempt, concurrency one, zero correction retries, no quality grader. The runner enforces the Fizzy single-attempt cap and disables self-correction even when retry/correction options are omitted, overridden, or invalid; direct `ParallelRunner` calls cannot bypass it. Fizzy is excluded from model-quality grading even with `--quality` or a passing grader override. Authorization and bootstrap preflight must succeed before constructing an agent. A further invocation requires separate authorization, not automatic retries. Other scenarios retain their existing retry/correction/quality behavior. Apply the same 30-minute process-group limit. Each attempt uses `.artifacts/fizzy-evals/attempt-*`; existing eval log/results artifacts remain under `tests/eval-results/`. The agent may update Gemfile/lockfile to install WorkOS after frozen baseline bootstrap; retain that diff. The source grader will report unverified acceptance, not pass.

**This is a skills-agent eval, not production `runWithCore`: it does not execute the CLI's post-agent URL provisioning.** It cannot replace step 5 or live dashboard proof. Do not run it merely to produce another unsupported success claim.

Expected initial spend is **one production agent session**; optional skills evaluation adds **one separately approved session**. No dollar estimate is justified without token assumptions and current provider rates. Use `sum(inputTokens × inputRate + outputTokens × outputRate + cacheReadTokens × cacheReadRate + cacheWriteTokens × cacheWriteRate)`, with rates normalized to per-token units, plus any explicitly approved service costs. Confirm model availability/rates and a dollar ceiling first. No invented rate or approved ceiling is implied here.

## Handoffs and overlaps

- No SDK or separate skills repository was edited. Upstream Ruby skill handoff: its generic Rails example stores a user in session and clears locally on logout; it lacks an app-specific identity/account policy, visible Rails UI and demonstrated SDK session logout. Its method examples defer to fetched SDK docs. Correct/version those upstream after verifying the actual gem API; do not claim the CLI prompt alone fixed the skill.
- Changed shared file `src/lib/completion-data.ts` only for origin-aware reporting and a Ruby inferred-startup caveat. `run-with-core.ts`, `authkit-application-setup.ts`, `sign-in-route.ts`, auth recovery, spinner behavior, commit/PR logic, SPA guidance and dev-command detection were not changed.
- Existing unmerged Unauthorized-recovery/spinner history was observed but not cherry-picked or depended on. Shared eval executor/runner files changed for explicit Fizzy isolation/selection; coordinate overlapping eval work before publication.
- AUTH-6736 remains incomplete until approved policy and retained real-app acceptance evidence satisfy all six checks.
