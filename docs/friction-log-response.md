# WorkOS CLI — Response to Akshay's Friction Log

Akshay, thank you for the friction log. It is the good kind of feedback: you walked the advertised happy path twice (once as a first-time human integrator on a Lovable/TanStack Start app, once as a fully autonomous agent) and wrote down exactly where the CLI let you down and where it delighted you. Almost every actionable item you raised is now fixed in the CLI itself. This is a walk back through your own journey, in your order, so you can see for each item what you flagged, what changed, and how the CLI behaves now.

The fixes ship as six themed changes: `fix:` for the first three (agent/CI paths, port correctness, messaging accuracy) and `feat:` for the last three (install UX, env/auth safety, headless login verification). They are committed to the integration branch (`nicknisi/akshay`) pending their pull requests, so each item below is anchored to its durable commit hash rather than a PR number. A handful of items were the right call to route elsewhere (a backend ask, other repos, an upstream package, or a deliberate cut), and those are in the table too, framed as decisions rather than quietly dropped.

## At a glance

Every item you raised appears here exactly once, including the ones we did not fix in the CLI.

| # | Friction entry (your words, tight) | Log section | What shipped | Change | Status |
|---|-------------------------------------|-------------|--------------|--------|--------|
| F1 | Non-interactive `npx workos@latest` (no TTY) "just dumped help", no subcommands, no installer nudge | P1 §2 | Non-TTY default now emits the full machine-readable command tree as JSON (or configured help), so `install` is discoverable | PR 1 (`36c47e9`) | Fixed |
| F2 | "Non-interactive mode is not fully non-interactive": `WORKOS_MODE=ci` + `--json` still hit the "What router?" prompt | P2 | Prompts in non-interactive mode fail fast with a structured error; per-site defaults; new `--router app\|pages` flag | PR 1 (`36c47e9`) | Fixed |
| F3 | "the installer hardcoded port 3000, but my app runs on 8080", causing callback `ERR_CONNECTION_REFUSED` | P1 §3 | `detectPort` reads `vite.config.{ts,js,mjs}` for TanStack Start (Vite-based), so the real dev port (8080) is used | PR 2 (`aa875e3`) | Fixed |
| F4 | The installer "ended with 'Validation passed'" while the port was wrong | P1 §2/§3 | Redirect-URI validators now compare the URI's port to the detected dev port and fail on mismatch | PR 2 (`aa875e3`) | Fixed |
| F5 | CLI hints say `workos …` but it is only on npx, so `command not found: workos` | P1 §4 | Live hints render in the form you invoked (`npx workos@latest …`), enforced by a repo-walk guard | PR 3 (`bb2c2b1`) | Fixed |
| F6 | "'Using provided WorkOS credentials' but I never provided any"; "retrieved" implied reuse | P1 §2 | "provided" copy prints only when you actually provided keys; auto-provisioned paths say so accurately | PR 3 (`bb2c2b1`) | Fixed |
| F7 | Claiming is irreversible with no undo, and `env remove` is "misleadingly named" (local only) | P1 §4 | `env claim` states it is permanent; `env remove` states it is local-config-only, up front | PR 3 (`bb2c2b1`) | Fixed |
| F8 | `migrations` help did not surface the CSV path your Supabase migration uses | (tied to P1 §1 Ask WorkOS) | `migrations` description now advertises the generic-CSV path (e.g. Supabase); subcommands reconciled | PR 3 (`bb2c2b1`) | Fixed |
| F9 | "The post-install 'next step' guidance is too thin", just two static lines | P1 §2 | Summary now shows the exact dev command, app URL, changed files, and per-framework next steps | PR 4 (`f6c81d0`) | Fixed |
| F10 | "'Running AI agent' is opaque": the spinner overwrites the phase text | P1 §2 | Append-only step log: file writes/edits persist as lines; the 2s spinner clobber is gone | PR 4 (`f6c81d0`) | Fixed |
| F11 | "`install` was overloaded": agents run it in a throwaway dir just for keys | P2 | New `workos env provision`: credentials-only, JSON output, no code-gen, no project writes | PR 5 (`f3452cb`) | Fixed |
| F12 | "Nothing warned me when I claimed with one account but logged … in with another" | P1 §4 | `auth login` detects the mismatch (warns/prompts, no silent switch) and always prints "Now using: …" | PR 5 (`f3452cb`) | Fixed |
| F13 | "The agent cannot self-test the post-login flow" | P2 | New `workos verify-login`: headless round-trip against a throwaway user, JSON output | PR 6 (`738d8cc`) | Fixed |
| O1 | "no discoverable or documented way to delete an environment" | P1 §4 | No CLI delete exists; verified backend-blocked (no endpoint on REST/SDK/internal API) | backend ask | Backend ask |
| O2 | Ask WorkOS re-sign-in; broken docs copy button; "temporary environment" pill; email-first flow | P1 §1–§3 | Owned by the web / docs-site / hosted AuthKit properties, not the CLI | other repos | Other repo |
| O3 | `migrations --help` (human) provider list | (scope) | The human help output is owned by the upstream `@workos/migrations` program; only CLI-owned copy (F8) was ours to fix | upstream | Upstream |
| O4 | `verify-login --allow-production`; wiring `status` events into the CLI adapter | (scope) | Deliberately cut, see rationale below | cut | Cut |

## What already worked well

You were generous with the 👍, and several of these are load-bearing wins we want to keep:

- **Sign-up landed the value prop immediately.** The AuthKit landing page design, "Continue with Google," "No credit card required," and the OpenAI/Anthropic/Vercel/Cursor/Perplexity social proof. (P1 §1)
- **The dashboard made the next move obvious.** Product cards (AuthKit, SSO, Directory Sync, Audit Logs) and a clear Docs link. (P1 §1)
- **The docs landing page is well organized and surfaces "Ask WorkOS".** It leads with `npx workos@latest` and category cards. (P1 §1)
- **Ask WorkOS gave a genuinely strong, stack-aware migration answer.** It identified the first-party Supabase + AuthKit path, gave `config.toml`/`createClient` snippets, and covered user migration via `npx workos migrations import` (bcrypt, no reset emails). (P1 §1)
- **In a real terminal, bare `npx workos@latest` guided you in cleanly.** The interactive installer offer meant you never needed to know the `install` subcommand name. (P1 §2)
- **The installer "just worked": it detected your stack and auto-configured everything.** Correct `tanstack-start` detection, an unclaimed env, and an AI agent that wrote the integration. (P1 §2)
- **Credentials were provisioned automatically, no key copying.** "A real delight," in your words. (P1 §2)
- **The sign-in redirect and hosted AuthKit page work great.** `/auth` redirected cleanly to the polished hosted UI, and your Lovable branding was preserved. (P1 §3)
- **Once the port was aligned, Google login worked end to end.** "The actual auth flow was solid." (P1 §3)
- **Claiming the environment worked cleanly.** `env claim` generated the link, opened the browser, and confirmed. (P1 §4)
- **`workos install` provisioned a real environment with no account and no login.** The agent got `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and a claim token, with the dashboard auto-configured. (P2)
- **End-to-end verification was possible headlessly.** The agent confirmed `/login` returned a real authorize URL (correct `client_id`, PKCE `code_challenge`, CSRF `state`) landing on the live hosted AuthKit page. (P2)

The fixes below are careful not to regress any of these.

## Part 1 — Hybrid integration (manual + AI installer)

### The CLI and the installer

**F1. Non-interactive `npx workos@latest` no longer dead-ends.**
- **You flagged:** running `npx workos@latest` through a non-interactive shell (no TTY) "printed only" the two global options (`--help`, `--version`), with "No list of subcommands, no example, no nudge to run an installer. It was a dead end … This is the same path CI pipelines and AI agents would hit." (P1 §2)
- **What shipped:** PR 1 (`36c47e9`), in `src/bin.ts` and `src/utils/help-json.ts` (with a subprocess integration test).
- **Before / After:** Before, the non-human default branch called `showHelp()` on a fresh, unconfigured yargs instance, so it printed only the two global options to stderr and left stdout empty. After, a non-TTY invocation in JSON mode emits the full machine-readable command tree (`buildCommandTree()`) on stdout, and otherwise prints the fully-configured help. `install` is now discoverable by CI and agents on the very first call.

**F6. Credential-source copy is now accurate.**
- **You flagged:** near the end the installer "printed 'Using provided WorkOS credentials.' I did not provide anything." You also noted the word "retrieved" "made it sound like it reused my existing account credentials somehow." (P1 §2)
- **What shipped:** PR 3 (`bb2c2b1`), threading the credential source through the adapter layer.
- **Before / After:** Before, "the WorkOS credentials you provided" printed even on the auto-provisioned path, and "retrieved automatically" covered both fresh and reused environments. After, the credential source is carried through to the adapters: the "provided" wording appears only on the paths where you actually supplied keys (suppressed for device/stored/env sources), and the success event says what really happened.

**F10. The agent phase is no longer opaque.**
- **You flagged:** "'Running AI agent' is opaque … It never told me what it was doing, which files it was creating or editing. The phase descriptions does flash on screen but then gets replaced by the generic 'Running AI agent' line." Your suggestion: "Stream a persistent, append-only step log instead of overwriting it." (P1 §2)
- **What shipped:** PR 4 (`f6c81d0`), in the CLI and headless adapters.
- **Before / After:** Before, a 2-second `setInterval` reset the spinner message and clobbered the phase text, and the `file:write`/`file:edit` events the agent already emitted went unused. After, that reset is removed and file writes/edits persist as append-only step lines above the spinner (path-only, with consecutive-path dedupe); in headless mode the same events stream as path-only NDJSON. Bash commands the agent runs are also surfaced as step lines.

**F9. The post-install summary is now concrete.**
- **You flagged:** "The post-install 'next step' guidance is too thin." The card said only "Start dev server to test authentication / Visit WorkOS Dashboard to manage users", with "No exact command, no mention that it created `/auth` and `/signout` routes, and no note that I still need to add a sign-in link in the UI." (P1 §2)
- **What shipped:** PR 4 (`f6c81d0`), a structured completion payload rendered by all three adapters.
- **Before / After:** Before, the success branch discarded the rich per-framework summary the installer had already built and showed two static lines. After, `buildCompletionData` composes the lockfile-aware dev command, the app URL (from the detected port), the changed files, and enriched per-framework next steps plus docs/dashboard links; the headless `complete` event carries the same structured fields. A per-framework sign-in-link snippet is included for Next.js.

### Getting login actually working

**F3. The installer uses your real dev port.**
- **You flagged:** "the installer hardcoded port 3000, but my app runs on 8080." After sign-in, AuthKit redirected to `http://localhost:3000/api/auth/callback?code=…` and you hit "ERR_CONNECTION_REFUSED", because both `.env.local` `WORKOS_REDIRECT_URI` and the dashboard were set to 3000 while your dev server listened on 8080. (P1 §3)
- **What shipped:** PR 2 (`aa875e3`), in `src/lib/port-detection.ts`.
- **Before / After:** Before, `detectPort` did not parse `vite.config` for TanStack Start, so it fell back to 3000. After, it reads `vite.config.{ts,js,mjs}` first (modern `@tanstack/react-start` is Vite-based) and only then the legacy Vinxi `app.config.ts`, so a Lovable/Vite app on 8080 is detected correctly. That real port flows into `.env.local` and the dashboard redirect/CORS/homepage values.

**F4. "Validation passed" no longer certifies a broken port.**
- **You flagged:** the installer "ended with 'Validation passed'", yet the callback dead-ended because the configured port was wrong. A false green that cost you the debugging session. (P1 §2, reconciled with §3)
- **What shipped:** PR 2 (`aa875e3`), a new `validateRedirectUriPort` helper wired into the Next.js, React Router, and TanStack Start redirect validators.
- **Before / After:** Before, the validators parsed the redirect URI's path but threw away its port, so a `:3000` URI on an `:8080` app still reported "Validation passed." After, for local hosts the validator compares the URI's effective port to the detected dev port and pushes an error-severity issue on mismatch, flipping validation to failed. The remediation hints now use the redirect URI's real origin instead of a hardcoded `localhost:3000`.

### Environment management (claiming and cleanup)

**F5. Command hints match how you invoked the CLI.**
- **You flagged:** several messages told you to "Run `workos env claim`" or "Run `workos telemetry opt-out`", but "the tool runs via `npx workos@latest`, not a global `workos` binary", so copy-pasting failed with `zsh: command not found: workos`. (P1 §4)
- **What shipped:** PR 3 (`bb2c2b1`), routing the live hint sites through `formatWorkOSCommand`.
- **Before / After:** Before, roughly 28 hint sites emitted a bare `workos <subcommand>` that npx never installed. After, live hints render in the form you launched the tool (`npx workos@latest env claim`), and a repo-walk regression test fails the build on any new unrouted hint (with a small curated allowlist for genuinely static help examples).

**F7. `env claim` and `env remove` now state their real semantics.**
- **You flagged:** "Claiming is irreversible and there is no obvious undo, and `env remove` is misleadingly named", because `env remove` "only deletes the local CLI config entry, it does not unclaim or delete the environment server-side", which is easy to misread as "undo the claim." (P1 §4)
- **What shipped:** PR 3 (`bb2c2b1`), in `env.ts` and `claim.ts`.
- **Before / After:** Before, neither command stated its scope. After, `env claim` states up front that claiming is permanent (help text, a runtime note, and a `permanent` JSON field), and `env remove` states that it only removes local config (help text, a runtime warning that an unclaimed env's claim token is lost, and `localOnly`/`wasUnclaimed` JSON fields).

**F12. `auth login` never silently switches accounts.**
- **You flagged:** you claimed the environment as `akshay.maniyar@workos.com`, then ran `auth login` as `amaniyar.usc@gmail.com`; the CLI said "Staging environment configured automatically" and "silently switch[ed] the CLI's active environment to the gmail account's Staging." You asked us to detect the mismatch and make the active environment explicit ("now using amaniyar.usc@gmail.com, Staging"). (P1 §4)
- **What shipped:** PR 5 (`f3452cb`), in `login.ts` and `config-store.ts`.
- **Before / After:** Before, staging provisioning clobbered the active-environment slot, silently repointing it to the new account. After, it detects the mismatch against your prior active environment (by persisted owner email, falling back to client ID) and writes the new account's Staging under a distinct key instead of overwriting. In human mode it prompts; in agent mode it warns (and emits structured JSON); and every login ends with an explicit "Now using: <env> (<email>)" line.

### Migrations copy (surfaced by your Supabase path)

**F8. `migrations` help surfaces the CSV/Supabase path.**
- **You flagged:** not a standalone friction entry, but your Part 1 §1 praise for Ask WorkOS called out the Supabase migration answer, which pointed you to `npx workos migrations import`. While sweeping messaging accuracy, we found the `migrations` description did not advertise the generic-CSV path that Supabase migrations actually use.
- **What shipped:** PR 3 (`bb2c2b1`), a shared `MIGRATIONS_DESCRIPTION` constant used by both `bin.ts` and the JSON help.
- **Before / After:** Before, the `migrations` description omitted the CSV import path. After, it advertises the generic-CSV path (e.g. Supabase), and the JSON help subcommand list is reconciled with `@workos/migrations` v2.5.0.

## Part 2 — Full autonomous AI agent (from scratch)

**F11. Credentials without the code generator: `workos env provision`.**
- **You flagged:** "`install` was overloaded", it "did not just provision credentials, it also ran an AI code generator that rewrites the project", so once Claude had already built the integration "it ended up running `install` in an isolated throwaway directory just to get credentials." Your suggestion: "A dedicated `workos env provision`." (P2)
- **What shipped:** PR 5 (`f3452cb`), the new `env provision` subcommand.
- **Before / After:** Before, the only way to get credentials was `install`, which also ran code-gen and rewrote the project. After, `workos env provision` calls `provisionUnclaimedEnvironment` directly (no auth, no code-gen), emits `apiKey`/`clientId`/`claimToken` as JSON on stdout, stores the result as a local active unclaimed env so a follow-up `env claim` works, and never touches the project directory or any `.env` file. Failures (including a 429) surface as structured errors with no fallback to login.

**F2. Agent/CI mode really is non-interactive now.**
- **You flagged:** "Non-interactive mode is not fully non-interactive", because "Even with `WORKOS_MODE=ci` and `--json`, the code-gen phase still hit an interactive prompt ('What router are you using? app or pages'). Claude had to detect that credentials were already written and kill the process." Your suggestion: "In CI or agent mode, never prompt, fail or default instead." (P2)
- **What shipped:** PR 1 (`36c47e9`), a global prompt guard plus per-site defaults.
- **Before / After:** Before, a prompt reached in a non-interactive context blocked indefinitely. After, `abortIfCancelled` fails fast with a structured `non_interactive_prompt` error, and the Next.js, React Router, and upload-env steps apply graceful defaults so installs still succeed. The new `--router app|pages` flag deterministically selects the router (winning over detection), and `WORKOS_MODE=ci` now enforces the same required-argument validation as the internal `--ci` flag.

**F13. Agents can self-verify the login loop: `workos verify-login`.**
- **You flagged:** "The agent cannot self-test the post-login flow", because Claude "could not complete an actual interactive sign-up or sign-in headlessly." Your suggestion: "a programmatic test-login … would let an agent self-verify the entire loop." (P2)
- **What shipped:** PR 6 (`738d8cc`), the new top-level `verify-login` command.
- **Before / After:** Before, there was no headless way to prove the login loop actually works. After, `workos verify-login` runs a full round-trip against the bundled SDK: create a throwaway user, authenticate with password, assert access and refresh tokens, then delete the user in a `finally` block so cleanup always runs. It refuses production-type environments unconditionally (both `env.type === 'production'` and an `sk_live_` key prefix), before any SDK call, and emits both a human checklist and a flat JSON verdict. (The `magic-auth` mode we considered was deliberately not shipped, see below.)

## Routed elsewhere (and why)

These are real items from your log that we decided not to fix in the CLI. They are decisions, not oversights.

- **`env delete` for remote environments (O1).** You are right that "every test run leaves an undeletable environment behind." This one is backend-blocked, and we verified that exhaustively: there is no delete endpoint on the public REST API, no SDK resource, and no teardown route on the internal one-shot-environments API the installer uses. The CLI cannot honestly offer a delete it has no way to perform, so the fix is a backend request for a DELETE-environment (or teardown) capability, after which the CLI can expose it. (No self-serve delete exists today.)
- **Web / docs-site / hosted-AuthKit items (O2).** Four of your entries live in properties other than the CLI: Ask WorkOS re-prompting an already-authenticated user for sign-in (P1 §1), the broken docs "copy" button on the `npx workos@latest` command in Firefox and Chrome (P1 §2), the "This is a temporary environment" pill that "does not explain itself" (P1 §3), and the email-first flow that "blurs sign-in and sign-up" (P1 §3). These are owned by the web, docs-site, and hosted AuthKit teams respectively, and have been routed to them.
- **`migrations --help` provider list (O3).** The human `--help` output for `migrations` is rendered by the upstream `@workos/migrations` package's own Commander program, not by this CLI. Only the CLI-owned description strings were ours to correct, which is exactly the F8 fix above.
- **Deliberately cut (O4).** Two things were considered and intentionally left out. A `verify-login --allow-production` override flag: `verify-login` creates and deletes a real user, so production is an unconditional refusal until a concrete goal requires otherwise, and a flag would add configurability for a state we do not want to enable. And wiring the installer's `status` events into the CLI adapter: that would surface previously-silent init/proxy messages, a separate behavior change to decide on its own rather than a side effect of the progress-log fix (F10). Relatedly, the `verify-login` `magic-auth` mode was deferred because its staging behavior (whether `createMagicAuth` returns the code in the API response) could not be confirmed in this run, so the password-grant path is the one shipped method.

## Downstream doc sync — @workos/skills

Because agents only reach for a command the skill tells them exists, the `@workos/skills` repo (the `workos` skill agents load) needs to learn about `env provision` and `verify-login`, the `--router` flag, the now-true "agent mode never prompts" invariant, and the fact that install-time validation (not `workos doctor`) is what checks the redirect-URI port. That sync is tracked as its own phase and runs against the skills repo after a CLI release contains these changes; it is pending at the time of writing.

## Appendix A — Source map

Every load-bearing claim above traces to one of: the friction log (LOG, with Part/section), a commit on the integration branch, or `contract-data.json` (CDJ). Commit hashes are verifiable with `git cat-file -e`.

| Claim | Source |
|-------|--------|
| F1 non-TTY dumped only `--help`/`--version`, no subcommands, "dead end", "same path CI pipelines and AI agents would hit" | LOG P1 §2 |
| F1 before: `showHelp()` on fresh yargs → two options, empty stdout; after: `buildCommandTree()` JSON / configured help | commit `36c47e9` (src/bin.ts, src/utils/help-json.ts) |
| F2 "even with `WORKOS_MODE=ci` and `--json`" the router prompt appeared; agent had to kill the process | LOG P2 |
| F2 after: `abortIfCancelled` structured `non_interactive_prompt`, per-site defaults, `--router app\|pages`, `WORKOS_MODE=ci` ⇒ `--ci` | commit `36c47e9` (clack-utils.ts, integrations/*, run.ts, bin.ts) |
| F3 installer set port 3000; app on 8080; callback `ERR_CONNECTION_REFUSED` | LOG P1 §3 |
| F3 after: `detectPort` reads `vite.config.{ts,js,mjs}` first, legacy `app.config.ts` fallback | commit `aa875e3` (src/lib/port-detection.ts) |
| F4 "Validation passed" while port wrong | LOG P1 §2 (👍 installer just worked) + §3 |
| F4 after: `validateRedirectUriPort` compares URI port vs detected dev port, error on mismatch; hints use real origin | commit `aa875e3` (src/lib/validation/validator.ts) |
| F5 hints say `workos …`; `zsh: command not found: workos`; only via npx | LOG P1 §4 |
| F5 after: live hints route through `formatWorkOSCommand`; repo-walk guard | commit `bb2c2b1` (bin.ts, env.ts, claim.ts, command-hints-guard.spec.ts) |
| F6 "'Using provided WorkOS credentials' but I never provided any"; "retrieved" implied reuse | LOG P1 §2 |
| F6 after: `credentialSource` threaded; "provided" only for cli/manual; `source` on staging:success | commit `bb2c2b1` (cli-adapter.ts + credential plumbing) |
| F7 claiming irreversible/no undo; `env remove` local-only, misleadingly named | LOG P1 §4 |
| F7 after: `env claim` permanent copy + `permanent` JSON; `env remove` local-only copy + `localOnly`/`wasUnclaimed` JSON | commit `bb2c2b1` (env.ts, claim.ts) |
| F8 Supabase migration via `npx workos migrations import` (Ask WorkOS praise) | LOG P1 §1 |
| F8 after: shared `MIGRATIONS_DESCRIPTION` advertises CSV/Supabase path; subcommands reconciled w/ @workos/migrations v2.5.0 | commit `bb2c2b1` (migrations.ts, help-json.ts, bin.ts) |
| F9 "post-install 'next step' guidance is too thin"; two static lines; no command, routes, or sign-in-link note | LOG P1 §2 |
| F9 after: `buildCompletionData` (dev command, app URL, changed files, per-framework next steps); headless `complete` carries fields | commit `f6c81d0` (completion-data.ts, adapters, nextjs/index.ts) |
| F10 "'Running AI agent' is opaque"; phase text replaced; "append-only step log" ask | LOG P1 §2 |
| F10 after: removed 2s `setInterval` clobber; append-only file step lines; headless NDJSON file events | commit `f6c81d0` (cli-adapter.ts, headless-adapter.ts, agent-interface.ts) |
| F11 "`install` was overloaded"; throwaway-directory workaround; `env provision` ask | LOG P2 |
| F11 after: `env provision` → `provisionUnclaimedEnvironment`, JSON creds, no code-gen/project writes, 429 structured | commit `f3452cb` (env.ts, bin.ts, help-json.ts) |
| F12 claimed one account, logged in as another; "Staging environment configured automatically", silent switch; "now using …" ask | LOG P1 §4 |
| F12 after: mismatch detection (ownerEmail > clientId), distinct-key write, prompt/warn split, explicit "Now using" | commit `f3452cb` (login.ts, config-store.ts) |
| F13 "The agent cannot self-test the post-login flow"; programmatic test-login ask | LOG P2 |
| F13 after: `verify-login` create→auth→assert→delete(finally); unconditional production refusal; human+JSON; magic-auth dropped | commit `738d8cc` (verify-login.ts, bin.ts, help-json.ts) |
| O1 "no discoverable or documented way to delete an environment"; every test run leaves one behind | LOG P1 §4 |
| O1 verified backend-blocked: no REST delete endpoint, no SDK resource, no internal teardown route | CDJ scope.outOfScope + gates.scope |
| O2 Ask WorkOS re-sign-in; broken docs copy button (FF+Chrome); temporary-environment pill; email-first flow | LOG P1 §1, §2, §3 |
| O2 web/docs/hosted-UI properties, other repos | CDJ scope.outOfScope |
| O3 `migrations --help` delegated to upstream `@workos/migrations` Commander program | CDJ scope.outOfScope |
| O4 production unconditional refusal; `status` events a separate behavior decision | CDJ scope.outOfScope; commit `738d8cc` (production refusal) |
| Six changes: `fix:` ×3, `feat:` ×3, on branch `nicknisi/akshay` pending PRs | git log (`aa875e3`, `36c47e9`, `bb2c2b1`, `f6c81d0`, `f3452cb`, `738d8cc`) |
| Repo gate green (build + 2310 tests + typecheck) at branch HEAD | `pnpm build && pnpm test && pnpm typecheck` |

## Appendix B — Removed / unverified claims

These were intentionally kept out of the body because no source confirmed them at drafting time. They can be added back once sourced.

- **A tracking-issue link for the `env delete` backend ask (O1).** The backend-blocked verification is sourced (contract), but no filed ticket/issue URL was available to cite. Add the link once the backend request is filed.
- **Specific owning repos/teams for the O2 items.** The disposition (web / docs-site / hosted AuthKit) is sourced from the contract's out-of-scope rationale, but exact repository names or team owners were not verified, so none are named.
- **The @workos/skills sync PR link.** Phase 8 is pending and gated on a published CLI release, so there is no PR/commit to cite yet; the section references it as pending rather than linking it.
- **PR numbers for the six changes.** These changes are committed to the integration branch but not yet opened as pull requests, so no `#NNN` numbers exist; each item is anchored to its commit hash instead. Replace with PR links once the PRs are opened/merged.
