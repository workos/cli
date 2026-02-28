# Non-TTY Mode for WorkOS CLI

**Created**: 2026-02-28
**Confidence Score**: 95/100
**Status**: Draft

## Problem Statement

The WorkOS CLI currently assumes a human at a terminal. 26+ interactive prompts (via clack), browser-based OAuth, and chalk-formatted tables make it unusable by coding agents like Claude Code, Codex, or Cursor. Agents must either avoid the CLI entirely or rely on users to copy-paste credentials and command output — defeating the purpose of automation.

This is a growing problem. AI coding agents are becoming primary consumers of developer tools, and CLIs that can't operate headlessly lose relevance. The `gh` CLI solved this well: it works identically for humans and agents, with automatic non-TTY detection, structured output, and env-var auth. The WorkOS CLI should follow this proven model.

The constraint is clear: non-TTY support must not degrade the human experience. Interactive prompts, colored output, spinners, and the TUI dashboard remain the default for humans. Agents get a parallel path that's equally capable but designed for machine consumption.

## Goals

1. **All management commands work non-interactively** — `env`, `organization`, `user` commands accept all required inputs via flags and produce structured output without prompts.
2. **Structured JSON output everywhere** — Auto-detect non-TTY and switch to JSON. Provide `--json` flag for explicit control. Errors go to stderr as structured JSON.
3. **Consistent exit codes** — Follow gh convention: 0=success, 1=general error, 2=cancelled, 4=auth required. Agents can branch on exit codes without parsing output.
4. **Auth works without a browser** — Agents use pre-existing credentials (from prior `workos login`) or `WORKOS_API_KEY` env var. No TTY + no credentials = exit code 4 with clear message.
5. **Headless installer mode** — The installer runs non-interactively with flags for overrides (`--api-key`, `--client-id`) and sensible auto-defaults (create branch, auto-commit, skip confirmations).
6. **Zero breaking changes for humans** — All existing interactive behavior is preserved. Non-TTY detection is automatic. Humans never see JSON unless they ask for it.

## Success Criteria

- [ ] Running any management command piped (`workos org list | jq .`) produces valid JSON with no ANSI escape codes
- [ ] Running `workos org list --json` in a TTY produces JSON instead of a table
- [ ] Running `workos env add prod sk_live_xxx` in non-TTY succeeds silently (exit 0) with JSON confirmation to stdout
- [ ] Running `workos install` in non-TTY with `--api-key` and `--client-id` flags completes without prompts, using auto-defaults for branch/commit
- [ ] Running any authenticated command without credentials in non-TTY exits with code 4 and a JSON error to stderr
- [ ] Running `workos install` in a TTY with no flags behaves identically to today (interactive clack prompts, colored output)
- [ ] All commands in non-TTY produce structured errors to stderr as `{ "error": { "code": "...", "message": "..." } }`
- [ ] `WORKOS_API_KEY` env var is respected as auth for commands that need it, bypassing OAuth entirely
- [ ] A `GH_PROMPT_DISABLED`-equivalent env var (`WORKOS_NO_PROMPT`) explicitly prevents all interactive prompts
- [ ] Installer in non-TTY streams NDJSON progress events to stdout (one JSON object per line) so agents can monitor real-time status
- [ ] `workos --help --json` outputs a machine-readable command tree (commands, flags, types, descriptions)
- [ ] Every subcommand's `--help` output includes complete flag documentation with types and defaults

## Scope

### In Scope

- **Non-TTY auto-detection** — Enhance `isNonInteractiveEnvironment()` to drive behavior throughout the CLI
- **JSON output mode** — Global `--json` flag + auto-detect for non-TTY. Strip ANSI, use JSON for all output
- **Structured errors** — JSON error objects to stderr with error codes
- **Exit code standardization** — Consistent exit codes across all commands (0, 1, 2, 4)
- **Management command non-interactive paths** — All `env`, `org`, `user` subcommands work with flags-only, no prompts
- **Auth in non-TTY** — Require pre-existing credentials or `WORKOS_API_KEY`. Exit 4 if neither available
- **Headless installer adapter** — New adapter (alongside CLI and Dashboard) for non-interactive installs with flag overrides and auto-defaults
- **`WORKOS_NO_PROMPT` env var** — Explicit prompt suppression (like `GH_PROMPT_DISABLED`)
- **`WORKOS_FORCE_TTY` env var** — Force TTY behavior when piped (like `GH_FORCE_TTY`)
- **NDJSON streaming for installer** — Headless installer outputs progress as newline-delimited JSON events to stdout (detection, auth, file changes, agent thinking, completion). Agents consume in real-time.
- **Agent-discoverable help** — `--help --json` outputs machine-readable command schema. All subcommand help is thorough with complete flag docs, types, defaults, and examples. Agents can introspect the CLI without guessing.

### Out of Scope

- **New TUI features** — Dashboard stays as-is. No changes to Ink components.
- **Service account / machine tokens** — Future consideration. Pre-existing OAuth tokens and API keys are sufficient for now.
- **`--jq` / `--template` flags** — Nice-to-have but not needed for initial non-TTY support. Agents can pipe to `jq` themselves.
- **Interactive NDJSON consumer** — No TUI for consuming NDJSON events. Agents read stdout directly. A future "agent dashboard" could visualize the stream.
- **CI-specific mode** — The existing `--ci` flag on install is subsumed by the broader non-TTY support. May deprecate later.

### Future Considerations

- `--jq` and `--template` flags for inline output transformation
- Service account tokens for long-lived automation
- MCP server mode (expose CLI commands as MCP tools directly)
- `workos status` command for agents to check auth/config state
