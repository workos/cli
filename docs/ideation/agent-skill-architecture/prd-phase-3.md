# PRD: Agent Skill Architecture - Phase 3

**Contract**: ./contract.md
**Phase**: 3 of 3
**Focus**: Agent SDK integration and end-to-end wiring

## Phase Overview

This phase wires everything together: configuring the Agent SDK to discover and use skills, updating `FrameworkConfig` to reference skill names, and ensuring the complete wizard flow works end-to-end.

The agent will now auto-discover skills from `.claude/skills/`, select the appropriate framework skill based on context, and execute framework-specific instructions without the monolithic prompt.

After this phase, the wizard is fully operational with the skill-based architecture. Users can also use these skills directly with local Claude Code.

## User Stories

1. As a **wizard user**, I want the same seamless experience so that the refactor doesn't change my workflow
2. As a **Claude Code user**, I want to run skills locally so that I can integrate AuthKit without the CLI wizard
3. As a **wizard maintainer**, I want skills auto-discovered so that I don't manually wire each framework

## Functional Requirements

### Agent SDK Configuration

- **FR-3.1**: Update `initializeAgent()` to include `"Skill"` in `allowed_tools`
- **FR-3.2**: Configure `settingSources: ["project"]` to load skills from `.claude/skills/`
- **FR-3.3**: Ensure `cwd` points to wizard package root where skills live

### FrameworkConfig Updates

- **FR-3.4**: Add `skillName` property to `FrameworkMetadata` (e.g., `"workos-authkit-nextjs"`)
- **FR-3.5**: Update each framework config to specify its skill name
- **FR-3.6**: `buildIntegrationPrompt()` instructs agent: "Use the {skillName} skill for integration"

### Integration Flow

- **FR-3.7**: Wizard flow: gather context → write env vars → build prompt → run agent with skills
- **FR-3.8**: Agent reads skill metadata at startup, triggers appropriate skill based on prompt
- **FR-3.9**: Skill instructs agent to fetch SDK README, then implement integration

### Testing & Validation

- **FR-3.10**: Integration test: Next.js App Router project → correct skill selected → integration succeeds
- **FR-3.11**: Integration test: React SPA → correct skill selected → integration succeeds
- **FR-3.12**: Verify skill auto-selection by checking agent's tool use logs

## Non-Functional Requirements

- **NFR-3.1**: Wizard execution time within 10% of previous (skill loading overhead minimal)
- **NFR-3.2**: Agent correctly selects skill 95%+ of the time based on context
- **NFR-3.3**: Skills work both via wizard CLI and direct Claude Code usage
- **NFR-3.4**: No breaking changes to wizard CLI interface

## Dependencies

### Prerequisites

- Phase 1 complete (base skill, env var separation)
- Phase 2 complete (all framework skills created)

### Outputs for Next Phase

- N/A (final phase)
- Future: skills ready for extraction to npm package or SDK repos

## Acceptance Criteria

- [ ] `initializeAgent()` includes `"Skill"` in allowed tools
- [ ] `settingSources` configured for project-level skill discovery
- [ ] Each `FrameworkConfig` has `skillName` property
- [ ] `buildIntegrationPrompt()` references skill by name
- [ ] End-to-end test: `npx @anthropic-ai/wizard@latest` for Next.js creates working auth
- [ ] End-to-end test: wizard for React creates working auth
- [ ] Agent tool use logs show skill invocation
- [ ] Skills usable directly in Claude Code (manual verification)

## Open Questions

- Should we add a `--dry-run` flag to test skill selection without full integration?
- How do we handle skill versioning if wizard and skills evolve independently?

---

*Review this PRD and provide feedback before spec generation.*
