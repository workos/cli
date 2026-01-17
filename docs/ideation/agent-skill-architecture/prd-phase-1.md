# PRD: Agent Skill Architecture - Phase 1

**Contract**: ./contract.md
**Phase**: 1 of 3
**Focus**: Foundation - Separation of concerns and base skill structure

## Phase Overview

This phase establishes the foundation for the skill-based architecture by separating sensitive credential handling from code integration. Currently, `buildIntegrationPrompt()` passes API keys directly to the agent. We'll move env var writing to the CLI layer, ensuring credentials never appear in agent prompts.

We'll also create the base skill (`workos-authkit-base`) containing shared patterns that all framework skills will reference. This enables DRY principles while maintaining per-framework customization.

After this phase, the wizard will write `.env.local` before the agent runs, and the base skill structure will be ready for framework-specific extensions.

## User Stories

1. As a **security-conscious developer**, I want API keys written to `.env.local` without passing through AI prompts so that sensitive credentials aren't exposed unnecessarily
2. As a **wizard maintainer**, I want shared integration patterns in one place so that I don't duplicate instructions across frameworks
3. As a **Claude Code user**, I want skills in `.claude/skills/` so that I can discover and use them locally

## Functional Requirements

### Environment Variable Handling

- **FR-1.1**: CLI writes `.env.local` with `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, and `WORKOS_COOKIE_PASSWORD` before agent initialization
- **FR-1.2**: Cookie password generation (32-char random string) happens in CLI, not agent
- **FR-1.3**: `buildIntegrationPrompt()` no longer includes API key in the prompt text

### Base Skill Structure

- **FR-1.4**: Create `.claude/skills/workos-authkit-base/SKILL.md` with YAML frontmatter (name, description)
- **FR-1.5**: Base skill contains: authentication flow overview, UI component patterns, environment variable reference, testing guidance
- **FR-1.6**: Base skill follows best practices: <500 lines, progressive disclosure, no framework-specific content
- **FR-1.7**: Base skill description enables auto-discovery when user mentions "WorkOS", "AuthKit", or "authentication"

### Prompt Refactor

- **FR-1.8**: `buildIntegrationPrompt()` returns minimal context: framework name, version, TypeScript flag, router type (if applicable)
- **FR-1.9**: Prompt instructs agent to use the appropriate `workos-authkit-{framework}` skill
- **FR-1.10**: Remove hardcoded SDK URLs from `buildIntegrationPrompt()`

## Non-Functional Requirements

- **NFR-1.1**: Env var writing completes in <100ms (no network calls)
- **NFR-1.2**: API keys never logged, printed, or included in analytics
- **NFR-1.3**: Base skill loads in <50 tokens (metadata only at startup)
- **NFR-1.4**: Backward compatible - existing wizard invocations still work

## Dependencies

### Prerequisites

- None (first phase)

### Outputs for Next Phase

- `.claude/skills/workos-authkit-base/SKILL.md` ready for framework skills to reference
- CLI env var writing extracted and tested
- `buildIntegrationPrompt()` simplified to context-only

## Acceptance Criteria

- [ ] `.env.local` is written by CLI before `runAgent()` is called
- [ ] `buildIntegrationPrompt()` output contains no API keys
- [ ] Base skill exists at `.claude/skills/workos-authkit-base/SKILL.md`
- [ ] Base skill has valid YAML frontmatter with name and description
- [ ] Base skill is <500 lines
- [ ] Wizard runs successfully end-to-end with these changes
- [ ] No sensitive data in console output or analytics

## Open Questions

- Should base skill include example UI code, or just describe patterns?
- Should we generate cookie password in CLI or let agent do it (for user visibility)?

---

*Review this PRD and provide feedback before spec generation.*
