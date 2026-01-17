# PRD: Agent Skill Architecture - Phase 2

**Contract**: ./contract.md
**Phase**: 2 of 3
**Focus**: Framework-specific skills creation

## Phase Overview

This phase creates the five framework-specific skills, each referencing the base skill from Phase 1. Each skill contains only the framework-specific instructions: SDK installation, callback route setup, middleware/proxy configuration, and UI integration patterns.

Skills are organized using progressive disclosure: the SKILL.md body provides quick-start instructions, with detailed reference material in separate files when needed. Each skill explicitly references `../workos-authkit-base/SKILL.md` for shared patterns.

After this phase, all framework skills exist and can be used independently. The agent will have access to targeted, framework-specific instructions instead of a monolithic prompt.

## User Stories

1. As a **Next.js developer**, I want AuthKit integration instructions specific to my router type (App vs Pages) so that I follow the correct patterns
2. As a **React SPA developer**, I want client-side-only instructions so that I don't get confused by server-side patterns
3. As a **wizard maintainer**, I want each framework's docs in separate skills so that teams can update them independently
4. As an **agent**, I want skills with clear descriptions so that I can auto-select the right one

## Functional Requirements

### Next.js Skill

- **FR-2.1**: Create `.claude/skills/workos-authkit-nextjs/SKILL.md`
- **FR-2.2**: Include App Router and Pages Router variants (detect from context)
- **FR-2.3**: Reference Next.js 16+ proxy.ts pattern vs older middleware.ts
- **FR-2.4**: Link to authkit-nextjs README: `https://github.com/workos/authkit-nextjs/blob/main/README.md`

### React Skill

- **FR-2.5**: Create `.claude/skills/workos-authkit-react/SKILL.md`
- **FR-2.6**: Client-side only patterns (no server components)
- **FR-2.7**: AuthKitProvider setup and useAuth hook usage
- **FR-2.8**: Link to authkit-react README: `https://github.com/workos/authkit-react/blob/main/README.md`

### React Router Skill

- **FR-2.9**: Create `.claude/skills/workos-authkit-react-router/SKILL.md`
- **FR-2.10**: Support v6, v7 Framework, v7 Data, v7 Declarative modes
- **FR-2.11**: Loader-based authentication patterns
- **FR-2.12**: Link to authkit-react-router README: `https://github.com/workos/authkit-react-router/blob/main/README.md`

### TanStack Start Skill

- **FR-2.13**: Create `.claude/skills/workos-authkit-tanstack-start/SKILL.md`
- **FR-2.14**: Server function and middleware patterns
- **FR-2.15**: Link to authkit-tanstack-start README: `https://github.com/workos/authkit-tanstack-start/blob/main/README.md`

### Vanilla JS Skill

- **FR-2.16**: Create `.claude/skills/workos-authkit-vanilla-js/SKILL.md`
- **FR-2.17**: Browser-only, no build step patterns
- **FR-2.18**: Direct AuthKit JS usage
- **FR-2.19**: Link to authkit-js README: `https://github.com/workos/authkit-js/blob/main/README.md`

### Skill Quality

- **FR-2.20**: Each skill references base skill: `See [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md) for shared patterns`
- **FR-2.21**: Each skill description includes framework name and trigger keywords
- **FR-2.22**: Each skill <500 lines; use separate reference files if needed

## Non-Functional Requirements

- **NFR-2.1**: Skill descriptions enable 95%+ correct auto-selection by agent
- **NFR-2.2**: Each skill independently usable (doesn't break if used without others)
- **NFR-2.3**: Skills follow naming convention: `workos-authkit-{framework}`
- **NFR-2.4**: No hardcoded API keys, client IDs, or other secrets in skills

## Dependencies

### Prerequisites

- Phase 1 complete (base skill exists, env var handling moved to CLI)

### Outputs for Next Phase

- All 5 framework skills ready for agent discovery
- Skill descriptions tuned for auto-selection
- Reference files created for complex frameworks (if needed)

## Acceptance Criteria

- [ ] All 5 framework skill directories exist in `.claude/skills/`
- [ ] Each SKILL.md has valid YAML frontmatter
- [ ] Each skill references the base skill
- [ ] Each skill includes correct SDK README URL
- [ ] Each skill is <500 lines
- [ ] Skills contain no secrets or placeholder credentials
- [ ] Manual test: agent selects correct skill when given framework context

## Open Questions

- Should React Router skill have separate files per mode, or one file with conditionals?
- Should skills fetch README dynamically (WebFetch) or embed key instructions?

---

*Review this PRD and provide feedback before spec generation.*
