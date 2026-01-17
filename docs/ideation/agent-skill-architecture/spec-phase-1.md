# Implementation Spec: Agent Skill Architecture - Phase 1

**PRD**: ./prd-phase-1.md
**Estimated Effort**: M (Medium)

## Technical Approach

Phase 1 establishes the foundation by separating env var handling from the agent and creating the base skill structure.

Currently, env vars are built in `agent-runner.ts:142` via `config.environment.getEnvVars()` and written after the agent runs via `uploadEnvironmentVariablesStep()`. We'll move this earlier - writing `.env.local` before agent initialization so credentials never appear in agent prompts.

We'll also create the base skill at `packages/cli/.claude/skills/workos-authkit-base/SKILL.md` containing shared AuthKit integration patterns that all framework skills will reference.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `packages/cli/.claude/skills/workos-authkit-base/SKILL.md` | Base skill with shared AuthKit patterns |
| `packages/cli/src/lib/env-writer.ts` | Extracted env var writing logic |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `packages/cli/src/lib/agent-runner.ts` | Move env var writing before agent init; simplify `buildIntegrationPrompt()` |
| `packages/cli/src/lib/framework-config.ts` | Add `skillName` to `FrameworkMetadata` interface |

### Deleted Files

| File Path | Reason |
|-----------|--------|
| None | No deletions in this phase |

## Implementation Details

### Environment Variable Writer

**Pattern to follow**: `packages/cli/src/steps/upload-env-vars.ts` (existing env upload logic)

**Overview**: Extract env var writing to a dedicated module that writes `.env.local` synchronously before agent runs.

```typescript
// packages/cli/src/lib/env-writer.ts

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

interface EnvVars {
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_REDIRECT_URI: string;
  WORKOS_COOKIE_PASSWORD: string;
}

/**
 * Generate a cryptographically secure cookie password
 */
function generateCookiePassword(): string {
  return crypto.randomBytes(16).toString('hex'); // 32 chars
}

/**
 * Write environment variables to .env.local before agent runs.
 * Merges with existing .env.local if present.
 */
export function writeEnvLocal(
  installDir: string,
  envVars: Partial<EnvVars>,
): void {
  const envPath = join(installDir, '.env.local');

  // Read existing env if present
  let existingEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    existingEnv = parseEnvFile(content);
  }

  // Merge with new vars (new vars take precedence)
  const merged = { ...existingEnv, ...envVars };

  // Generate cookie password if not provided
  if (!merged.WORKOS_COOKIE_PASSWORD) {
    merged.WORKOS_COOKIE_PASSWORD = generateCookiePassword();
  }

  // Write back
  const content = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  writeFileSync(envPath, content + '\n');
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        result[key] = valueParts.join('=');
      }
    }
  }
  return result;
}
```

**Key decisions**:
- Synchronous writes (fast, no network)
- Merge with existing .env.local (don't overwrite user's vars)
- Generate cookie password in CLI, not agent

**Implementation steps**:
1. Create `env-writer.ts` with `writeEnvLocal()` function
2. Add cookie password generation using `crypto.randomBytes()`
3. Implement env file parsing and merging

### Agent Runner Refactor

**Pattern to follow**: Existing `runAgentWizard()` structure

**Overview**: Move env var writing to happen before `initializeAgent()` call, and simplify `buildIntegrationPrompt()` to context-only.

```typescript
// In agent-runner.ts - changes to runAgentWizard()

// BEFORE agent init, write env vars
const callbackPath = getCallbackPath(config.metadata.integration);
const envVars = {
  ...(apiKey ? { WORKOS_API_KEY: apiKey } : {}),
  WORKOS_CLIENT_ID: clientId,
  WORKOS_REDIRECT_URI: `http://localhost:${port}${callbackPath}`,
};

writeEnvLocal(options.installDir, envVars);

// Then init agent (no API key in prompt)
const agent = initializeAgent(
  {
    workingDirectory: options.installDir,
    // Remove workOSApiKey from here - no longer needed in config
  },
  options,
);
```

**Key decisions**:
- Env vars written synchronously before agent
- API key removed from `buildIntegrationPrompt()` output
- Cookie password auto-generated if not present

**Implementation steps**:
1. Import `writeEnvLocal` from new module
2. Call `writeEnvLocal()` before `initializeAgent()`
3. Remove API key from prompt template
4. Update `AgentConfig` interface to remove `workOSApiKey`

### Base Skill Creation

**Overview**: Create the base skill with shared WorkOS AuthKit patterns.

```yaml
# packages/cli/.claude/skills/workos-authkit-base/SKILL.md

---
name: workos-authkit-base
description: Shared patterns for WorkOS AuthKit integration. Provides authentication flow overview, UI component patterns, and testing guidance. Use as a foundation when integrating AuthKit with any framework.
---

# WorkOS AuthKit Base Patterns

This skill provides shared patterns for integrating WorkOS AuthKit. Framework-specific skills extend this with implementation details.

## Authentication Flow

1. User clicks "Sign In" → Redirect to WorkOS hosted login
2. User authenticates → WorkOS redirects to your callback URL
3. Callback handler exchanges code for session → Sets secure cookie
4. Subsequent requests include session cookie → Middleware validates

## Environment Variables

Your `.env.local` should contain:
- `WORKOS_API_KEY` - Server-side API key (sk_xxx)
- `WORKOS_CLIENT_ID` - Public client identifier
- `WORKOS_REDIRECT_URI` - OAuth callback URL
- `WORKOS_COOKIE_PASSWORD` - 32+ char secret for cookie encryption

## UI Patterns

### Sign In Button
Use the SDK's sign-in URL helper. Do NOT build OAuth URLs manually.

### User Display
When authenticated, show:
- User's name or email
- Sign out button using SDK's signOut function

### Protected Routes
Use SDK middleware/guards to protect routes. Do NOT manually check cookies.

## Testing Checklist

- [ ] Sign in flow completes without errors
- [ ] Session persists across page reloads
- [ ] Sign out clears session
- [ ] Protected routes redirect unauthenticated users
- [ ] Callback URL matches WORKOS_REDIRECT_URI exactly

## Common Mistakes to Avoid

1. **Custom OAuth code** - Use SDK handlers, not manual implementation
2. **Hardcoded URLs** - Use environment variables
3. **Missing cookie password** - Required for session encryption
4. **Wrong callback path** - Must match dashboard configuration exactly
```

**Key decisions**:
- Keep under 100 lines for quick loading
- Focus on patterns, not framework-specific code
- Include testing checklist for validation

**Implementation steps**:
1. Create directory: `packages/cli/.claude/skills/workos-authkit-base/`
2. Write `SKILL.md` with YAML frontmatter
3. Include auth flow, env vars, UI patterns, testing checklist

### FrameworkConfig Update

**Overview**: Add `skillName` property to `FrameworkMetadata` for later phases.

```typescript
// In framework-config.ts

export interface FrameworkMetadata {
  name: string;
  integration: Integration;
  docsUrl: string;
  unsupportedVersionDocsUrl?: string;
  gatherContext?: (options: WizardOptions) => Promise<Record<string, any>>;
  skillName?: string; // NEW: Name of the framework-specific skill
}
```

**Implementation steps**:
1. Add optional `skillName` property to `FrameworkMetadata`
2. Will be populated per-framework in Phase 3

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `packages/cli/src/lib/__tests__/env-writer.test.ts` | Env var writing and merging |

**Key test cases**:
- Writes new .env.local when none exists
- Merges with existing .env.local without overwriting
- Generates cookie password when not provided
- Handles empty/malformed existing .env files

### Manual Testing

- [ ] Run wizard on Next.js project - verify .env.local created before agent output
- [ ] Check .env.local contains all required vars
- [ ] Verify API key NOT in console output or agent logs
- [ ] Existing .env.local vars preserved after wizard run

## Error Handling

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| .env.local write fails (permissions) | Log error, continue - agent can still write it |
| Malformed existing .env.local | Parse what we can, log warning |
| Cookie password generation fails | Fallback to Math.random-based generation |

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
```

## Rollout Considerations

- **Feature flag**: None needed - internal refactor
- **Monitoring**: Watch for env var write failures in wizard logs
- **Rollback plan**: Revert to agent writing env vars if issues arise

## Open Items

- [ ] Confirm cookie password length requirement (32 chars assumed)
- [ ] Decide if we should backup existing .env.local before modifying

---

*This spec is ready for implementation. Follow the patterns and validate at each step.*
