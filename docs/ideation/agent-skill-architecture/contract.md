# Agent Skill Architecture Contract

**Created**: 2026-01-16
**Confidence Score**: 96/100
**Status**: Draft

## Problem Statement

The WorkOS AuthKit wizard's `buildIntegrationPrompt()` function (in `packages/cli/src/lib/agent-runner.ts:200-292`) hardcodes integration instructions for ALL five framework SDKs (Next.js, React, React Router, TanStack Start, Vanilla JS) even though only one framework is used per invocation. This wastes tokens, creates maintenance burden, and prevents framework teams from owning their integration docs.

Additionally, the monolithic prompt conflates two concerns: sensitive credential handling (API keys → `.env.local`) and code integration (routes, middleware, UI). The agent currently handles both, unnecessarily exposing API keys in the prompt.

This affects:
- **Wizard maintainers**: Must update one giant prompt for any framework change
- **Agent efficiency**: Loads irrelevant framework docs, wasting context tokens
- **Users**: Cannot customize integration behavior locally
- **Framework teams**: Cannot own their SDK integration instructions

## Goals

1. **Modular skills**: Each framework has its own `SKILL.md` containing only relevant integration instructions, reducing prompt token usage by ~80% per invocation
2. **Separation of concerns**: CLI handles sensitive config (env vars); agent handles code integration only
3. **Skill discoverability**: Agent auto-selects the correct framework skill based on context
4. **Local customization**: Users can override/extend skills in their `.claude/skills/` directory
5. **Maintainability**: Framework teams can own and update their skill files independently

## Success Criteria

- [ ] `buildIntegrationPrompt()` no longer contains hardcoded framework-specific URLs or instructions
- [ ] Each framework (Next.js, React, React Router, TanStack Start, Vanilla JS) has its own skill directory
- [ ] Base skill (`workos-authkit-base`) contains shared patterns; framework skills reference it
- [ ] CLI writes `.env.local` before agent runs; agent prompt contains no API keys
- [ ] Agent SDK configured with `allowed_tools: ["Skill"]` and `settingSources: ["project"]`
- [ ] Agent correctly selects and uses the framework-appropriate skill
- [ ] Skills follow best practices: <500 lines, one-level-deep references, progressive disclosure
- [ ] Existing wizard flow works unchanged from user perspective

## Scope Boundaries

### In Scope

- Create base skill: `.claude/skills/workos-authkit-base/SKILL.md`
- Create framework skills: `workos-authkit-nextjs`, `workos-authkit-react`, `workos-authkit-react-router`, `workos-authkit-tanstack-start`, `workos-authkit-vanilla-js`
- Refactor `buildIntegrationPrompt()` to minimal context-only prompt
- Move env var writing to CLI (before agent initialization)
- Update `initializeAgent()` to enable skills via `allowed_tools` and `settingSources`
- Update `FrameworkConfig` to include skill name reference

### Out of Scope

- Auto-installing skills to user's Claude Code environment - future feature
- Publishing skills as separate npm package (`@workos/authkit-skills`) - future
- Hosting skills in framework SDK repos - future
- MCP tool integration for dynamic docs fetching - different approach

### Future Considerations

- CLI command to copy skills to user's `~/.claude/skills/` for local Claude Code use
- Versioned skill packages that can be installed independently
- Skills hosted alongside SDKs in WorkOS repos (e.g., `authkit-nextjs/skills/`)
- Community-contributed skill variants

---

*This contract was generated from brain dump input. Review and approve before proceeding to PRD generation.*
