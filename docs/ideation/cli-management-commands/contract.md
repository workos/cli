# CLI Management Commands Contract

**Created**: 2026-02-17
**Confidence Score**: 95/100
**Status**: Draft

## Problem Statement

The WorkOS CLI (`workos`) currently focuses on AuthKit installation. Users who need to manage WorkOS resources (organizations, environments) must either use the dashboard UI or the separate Go-based CLI (`workos-cli`). This fragments the developer experience — two CLIs for one platform. The Go CLI is being retired, and its non-FGA management capabilities need to live in the TypeScript CLI.

Additionally, the CLI lacks multi-environment support. Developers working across production and sandbox environments have no way to switch context without re-authenticating or manually managing API keys.

## Goals

1. **Full organization CRUD** — `workos organization create/update/get/list/delete` matching the Go CLI's command structure, including domain management and pagination
2. **Multi-environment management** — `workos env add/remove/switch` allowing users to configure and switch between named environments (production, sandbox, custom endpoints)
3. **Secure API key storage** — API keys stored in the system keyring (via `@napi-rs/keyring`) as a second entry alongside OAuth credentials, with JSON file fallback
4. **Future-proof for additional resource commands** — Architecture that makes it straightforward to add `workos user`, `workos connection`, etc. when API access allows

## Success Criteria

- [ ] `workos organization create <name> [domain]:[state]` creates an organization via WorkOS API
- [ ] `workos organization update <org_id> <name>` updates an organization
- [ ] `workos organization get <org_id>` displays organization details
- [ ] `workos organization list` lists organizations with `--domain`, `--limit`, `--before`, `--after`, `--order` flags
- [ ] `workos organization delete <org_id>` deletes an organization
- [ ] `workos env add` prompts for name, API key, and endpoint; stores in keyring
- [ ] `workos env remove <name>` removes a named environment
- [ ] `workos env switch <name>` sets the active environment
- [ ] `workos env list` shows all environments with active indicator
- [ ] API keys are stored in system keyring under `workos-cli/config` with file fallback
- [ ] Management commands use the API key from the active environment
- [ ] `WORKOS_API_KEY` env var overrides stored key (for CI/headless use)
- [ ] Table output for list commands, JSON detail for get commands
- [ ] All new commands have unit tests

## Scope Boundaries

### In Scope

- Organization management commands (create, update, get, list, delete)
- Environment management commands (add, remove, switch, list)
- Config store abstraction using keyring (second entry: `workos-cli/config`)
- API key resolution: env var → active environment → error
- Table and JSON output formatting for management commands
- `--api-key` flag override on management commands
- Pagination support (before/after cursors, limit, order)

### Out of Scope

- FGA commands — excluded by design, staying in Go CLI or deprecated
- `workos init` command — existing `workos login` is sufficient
- User management commands — API key access may not support this yet
- Connection/SSO management commands — same API access concern
- Migration tooling from Go CLI config (`~/.workos.json`) — users can re-add environments
- Interactive TUI/dashboard mode for management commands — CLI output only

### Future Considerations

- User management commands (`workos user list/get/delete`) when API access allows
- Connection management commands
- Automatic API key provisioning via OAuth (when programmatic key access is available)
- Migration script from `~/.workos.json` to new config format
- `workos whoami` command showing active environment and user info

---

_This contract was generated from brain dump input. Review and approve before proceeding to specification._
