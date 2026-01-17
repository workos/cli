# Implementation Spec: Agent Skill Architecture - Phase 3

**PRD**: ./prd-phase-3.md
**Estimated Effort**: M (Medium)

## Technical Approach

Phase 3 wires everything together: configuring the Agent SDK to discover skills, updating FrameworkConfigs with skill names, and refactoring `buildIntegrationPrompt()` to instruct the agent to use skills instead of hardcoded instructions.

The key changes are:
1. Add `"Skill"` to the agent's allowed tools
2. Configure `settingSources` to load skills from the project's `.claude/skills/` directory
3. Update each framework's config with its skill name
4. Simplify the integration prompt to just provide context and skill invocation

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| None | Wiring existing components |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `packages/cli/src/lib/agent-interface.ts` | Add Skill to allowed tools, configure settingSources |
| `packages/cli/src/lib/agent-runner.ts` | Refactor buildIntegrationPrompt() to use skill-based approach |
| `packages/cli/src/lib/framework-config.ts` | Document skillName property (added in Phase 1) |
| `packages/cli/src/nextjs/nextjs-wizard-agent.ts` | Add skillName: 'workos-authkit-nextjs' |
| `packages/cli/src/react/react-wizard-agent.ts` | Add skillName: 'workos-authkit-react' |
| `packages/cli/src/react-router/react-router-wizard-agent.ts` | Add skillName: 'workos-authkit-react-router' |
| `packages/cli/src/tanstack-start/tanstack-start-wizard-agent.ts` | Add skillName: 'workos-authkit-tanstack-start' |
| `packages/cli/src/vanilla-js/vanilla-js-wizard-agent.ts` | Add skillName: 'workos-authkit-vanilla-js' |

### Deleted Files

| File Path | Reason |
|-----------|--------|
| None | No deletions |

## Implementation Details

### Agent Interface Configuration

**Pattern to follow**: Existing `initializeAgent()` structure in `agent-interface.ts`

**Overview**: Configure the Agent SDK to discover and use skills from the project's `.claude/skills/` directory.

```typescript
// In agent-interface.ts - update initializeAgent() return or query options

// Current AgentRunConfig - needs extension for skill support
type AgentRunConfig = {
  workingDirectory: string;
  mcpServers: McpServersConfig;
  model: string;
  // NEW: Add skill configuration
  allowedTools: string[];
  settingSources: ('user' | 'project')[];
};

// In initializeAgent(), return updated config:
const agentRunConfig: AgentRunConfig = {
  workingDirectory: config.workingDirectory,
  mcpServers: {
    workos: {
      command: 'npx',
      args: ['-y', '@workos/mcp-docs-server'],
    },
  },
  model: 'claude-opus-4-5-20251101',
  // NEW: Enable skills
  allowedTools: [
    'Skill',
    'Read',
    'Write',
    'Edit',
    'Bash',
    'Glob',
    'Grep',
    'WebFetch',
    // ... other tools as needed
  ],
  settingSources: ['project'], // Load skills from .claude/skills/
};
```

**Key decisions**:
- Use `settingSources: ['project']` not `['user', 'project']` - we don't want user's personal skills interfering
- Include all tools the agent needs (Read, Write, Edit, Bash, WebFetch for README fetching)
- Skills directory is relative to `workingDirectory`

**Implementation steps**:
1. Extend `AgentRunConfig` type with `allowedTools` and `settingSources`
2. Update `initializeAgent()` to return these new fields
3. Ensure `runAgent()` passes these options to the Agent SDK query

### Build Integration Prompt Refactor

**Pattern to follow**: Minimal context + skill instruction

**Overview**: Replace the 90-line hardcoded prompt with a simple context block that instructs the agent to use the appropriate skill.

```typescript
// In agent-runner.ts - simplified buildIntegrationPrompt()

function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    // API key removed - now in .env.local
  },
  frameworkContext: Record<string, any>,
): string {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  const skillName = config.metadata.skillName;
  if (!skillName) {
    throw new Error(`Framework ${config.metadata.name} missing skillName in config`);
  }

  return `You are integrating WorkOS AuthKit into this ${config.metadata.name} application.

## Project Context

- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}${additionalContext}

## Environment

The following environment variables have been configured in .env.local:
- WORKOS_API_KEY
- WORKOS_CLIENT_ID
- WORKOS_REDIRECT_URI
- WORKOS_COOKIE_PASSWORD

## Your Task

Use the \`${skillName}\` skill to integrate WorkOS AuthKit into this application.

The skill contains step-by-step instructions including:
1. Fetching the SDK documentation
2. Installing the SDK
3. Creating the callback route
4. Setting up middleware/auth handling
5. Adding authentication UI to the home page

Report your progress using [STATUS] prefixes.

Begin by invoking the ${skillName} skill.`;
}
```

**Key decisions**:
- No SDK URLs in prompt - skill has them
- No API key in prompt - already in .env.local
- Explicit instruction to use the named skill
- ~30 lines vs previous ~90 lines

**Implementation steps**:
1. Remove hardcoded SDK URLs section
2. Remove API key from context parameter
3. Add skillName lookup and validation
4. Add explicit skill invocation instruction

### Framework Config Updates

**Overview**: Add `skillName` to each framework's configuration.

```typescript
// packages/cli/src/nextjs/nextjs-wizard-agent.ts

const NEXTJS_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Next.js',
    integration: Integration.nextjs,
    docsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
    skillName: 'workos-authkit-nextjs', // NEW
    gatherContext: detectNextJsRouter,
  },
  // ... rest unchanged
};
```

```typescript
// packages/cli/src/react/react-wizard-agent.ts

const REACT_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'React',
    integration: Integration.react,
    docsUrl: 'https://workos.com/docs/user-management/authkit/react',
    skillName: 'workos-authkit-react', // NEW
  },
  // ... rest unchanged
};
```

**Implementation steps** (repeat for all 5 frameworks):
1. Open framework config file
2. Add `skillName` property to `metadata`
3. Verify skill name matches directory name in `.claude/skills/`

### Wiring in runAgent()

**Overview**: Ensure the Agent SDK query receives skill configuration.

```typescript
// In agent-interface.ts - update runAgent() or the SDK query call

// The exact implementation depends on how the Agent SDK is invoked
// If using @anthropic-ai/claude-agent-sdk:

import { query } from '@anthropic-ai/claude-agent-sdk';

export async function runAgent(
  config: AgentRunConfig,
  prompt: string,
  // ...
) {
  for await (const message of query({
    prompt,
    options: {
      cwd: config.workingDirectory,
      settingSources: config.settingSources, // NEW
      allowedTools: config.allowedTools,     // NEW
      // ... other options
    },
  })) {
    // Handle messages
  }
}
```

**Key decisions**:
- Pass `settingSources` and `allowedTools` to SDK query
- Skills loaded from project-relative `.claude/skills/`

**Implementation steps**:
1. Locate where Agent SDK query is called
2. Add `settingSources` and `allowedTools` to options
3. Verify skill discovery works by checking agent output

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `packages/cli/src/lib/__tests__/agent-runner.test.ts` | buildIntegrationPrompt() returns skill-based prompt |

**Key test cases**:
- buildIntegrationPrompt() throws if skillName missing
- buildIntegrationPrompt() includes skill invocation instruction
- buildIntegrationPrompt() does NOT contain API key
- buildIntegrationPrompt() does NOT contain hardcoded SDK URLs

### Integration Tests

| Test File | Coverage |
|-----------|----------|
| `packages/cli/src/__tests__/wizard-e2e.test.ts` | Full wizard flow with skills |

**Key scenarios**:
- Next.js App Router project → skill selected → auth works
- React SPA → skill selected → auth works
- Agent tool use logs show "Skill" invocation

### Manual Testing

- [ ] Run `npx @anthropic-ai/wizard nextjs` on fresh Next.js project
- [ ] Verify agent output shows skill invocation
- [ ] Verify callback route created at correct path
- [ ] Verify sign-in/sign-out works
- [ ] Repeat for React SPA
- [ ] Verify skills work directly in Claude Code (without wizard)

## Error Handling

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| Skill not found | Clear error: "Skill {name} not found. Ensure .claude/skills/{name}/SKILL.md exists" |
| skillName missing from config | Throw at startup: "Framework {name} missing skillName" |
| Agent doesn't use skill | Prompt explicitly says "Begin by invoking the {skill} skill" |

## Validation Commands

```bash
# Type checking
pnpm --filter @anthropic-ai/wizard typecheck

# Linting
pnpm --filter @anthropic-ai/wizard lint

# Unit tests
pnpm --filter @anthropic-ai/wizard test

# Build
pnpm --filter @anthropic-ai/wizard build

# E2E test (if available)
pnpm --filter @anthropic-ai/wizard test:e2e

# Verify skills exist
ls -la packages/cli/.claude/skills/*/SKILL.md
```

## Rollout Considerations

- **Feature flag**: Could use `WIZARD_USE_SKILLS=true` env var for gradual rollout
- **Monitoring**: Log whether skill was invoked; track success rate
- **Alerting**: Alert if skill invocation rate drops below 90%
- **Rollback plan**: Restore old `buildIntegrationPrompt()` if skills fail

## Open Items

- [ ] Verify exact Agent SDK query API for `settingSources` and `allowedTools`
- [ ] Determine if we need `['project']` or if skills should be at package level
- [ ] Consider `--dry-run` flag to test skill selection without full integration

---

*This spec is ready for implementation. Follow the patterns and validate at each step.*
