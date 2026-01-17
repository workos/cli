# Implementation Spec: Agent Skill Architecture - Phase 2

**PRD**: ./prd-phase-2.md
**Estimated Effort**: L (Large)

## Technical Approach

Phase 2 creates the five framework-specific skills, each containing SDK-specific integration instructions. Each skill references the base skill from Phase 1 and follows progressive disclosure patterns.

Skills are authored following the best practices from the Claude platform docs: <500 lines, one-level-deep references, clear descriptions with trigger keywords, and framework-specific README URLs.

Each skill instructs the agent to fetch the SDK README first, then implement based on those docs - ensuring integration stays current with SDK changes.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `packages/cli/.claude/skills/workos-authkit-nextjs/SKILL.md` | Next.js integration skill |
| `packages/cli/.claude/skills/workos-authkit-react/SKILL.md` | React SPA integration skill |
| `packages/cli/.claude/skills/workos-authkit-react-router/SKILL.md` | React Router integration skill |
| `packages/cli/.claude/skills/workos-authkit-tanstack-start/SKILL.md` | TanStack Start integration skill |
| `packages/cli/.claude/skills/workos-authkit-vanilla-js/SKILL.md` | Vanilla JS integration skill |

### Modified Files

| File Path | Changes |
|-----------|---------|
| None | Framework configs updated in Phase 3 |

### Deleted Files

| File Path | Reason |
|-----------|--------|
| None | No deletions |

## Implementation Details

### Next.js Skill

**Overview**: Full-stack Next.js integration supporting both App Router and Pages Router.

```yaml
# packages/cli/.claude/skills/workos-authkit-nextjs/SKILL.md

---
name: workos-authkit-nextjs
description: Integrate WorkOS AuthKit with Next.js applications. Supports App Router and Pages Router. Use when the project uses Next.js, next, or when user mentions Next.js authentication.
---

# WorkOS AuthKit for Next.js

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-nextjs/blob/main/README.md
   The README is the source of truth - follow it exactly.

2. **Install SDK**
   ```bash
   npm install @workos-inc/authkit-nextjs
   # or: pnpm add @workos-inc/authkit-nextjs
   ```

3. **Detect Router Type**
   - App Router: Has `app/` directory with `layout.tsx`
   - Pages Router: Has `pages/` directory with `_app.tsx`

## App Router Integration

### Middleware (Next.js < 16)
Create `middleware.ts` at project root using the pattern from the SDK README.

### Proxy Route (Next.js 16+)
Create `app/auth/[...proxy]/route.ts` using the pattern from the SDK README.

### Callback Route
Create `app/callback/route.ts` at the exact path matching `WORKOS_REDIRECT_URI`.
Use the SDK's `handleAuth()` function - do NOT write custom callback logic.

### Server Components
Use `getUser()` from the SDK to get the authenticated user in Server Components.

### Client Components
Use `useUser()` hook for client-side user access.

## Pages Router Integration

### API Routes
Create `pages/api/auth/[...auth].ts` using the SDK's handler.

### Callback Route
Create `pages/callback.tsx` or use the API route pattern from the README.

### Session Access
Use `getUser()` in `getServerSideProps` for server-side user access.

## UI Integration

Update the home page (`app/page.tsx` or `pages/index.tsx`):

**Logged out state:**
- Show "Sign In" button using `getSignInUrl()` from SDK

**Logged in state:**
- Display user name/email from `getUser()` result
- Show "Sign Out" button using `signOut()` from SDK

## Status Reporting

Report progress with `[STATUS]` prefix:
- [STATUS] Reading SDK documentation
- [STATUS] Installing @workos-inc/authkit-nextjs
- [STATUS] Creating callback route at /callback
- [STATUS] Setting up middleware/proxy
- [STATUS] Adding authentication UI
- [STATUS] Complete
```

**Key decisions**:
- Detect router type from file structure
- Different patterns for Next.js 16+ (proxy.ts) vs older (middleware.ts)
- Always fetch README first for latest patterns

**Implementation steps**:
1. Create skill directory
2. Write SKILL.md with YAML frontmatter
3. Include both App Router and Pages Router sections
4. Reference base skill at top

### React Skill

**Overview**: Client-side only React SPA integration.

```yaml
# packages/cli/.claude/skills/workos-authkit-react/SKILL.md

---
name: workos-authkit-react
description: Integrate WorkOS AuthKit with React single-page applications. Client-side only authentication. Use when the project is a React SPA, uses react without Next.js, or mentions React authentication.
---

# WorkOS AuthKit for React

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-react/blob/main/README.md
   The README is the source of truth - follow it exactly.

2. **Install SDK**
   ```bash
   npm install @workos-inc/authkit-react
   ```

## Integration Steps

### AuthKitProvider Setup

Wrap your app with `AuthKitProvider` from the SDK.
Get the exact implementation from the README.

```tsx
// Example structure - get exact code from README
import { AuthKitProvider } from '@workos-inc/authkit-react';

function App() {
  return (
    <AuthKitProvider clientId={process.env.REACT_APP_WORKOS_CLIENT_ID}>
      {/* Your app */}
    </AuthKitProvider>
  );
}
```

### Environment Variables

For React SPAs, use:
- `REACT_APP_WORKOS_CLIENT_ID` (Create React App)
- `VITE_WORKOS_CLIENT_ID` (Vite)

Note: No API key needed - client-side only.

### useAuth Hook

Use the `useAuth()` hook from the SDK for:
- Checking authentication status
- Getting user information
- Triggering sign in/out

### Callback Handling

The React SDK handles OAuth callbacks internally.
No server-side callback route needed.

## UI Integration

Update your main component:

**Logged out:**
- Show "Sign In" button using `signIn()` from `useAuth()`

**Logged in:**
- Display user info from `user` object
- Show "Sign Out" button using `signOut()` from `useAuth()`

## Status Reporting

- [STATUS] Reading SDK documentation
- [STATUS] Installing @workos-inc/authkit-react
- [STATUS] Setting up AuthKitProvider
- [STATUS] Adding authentication UI
- [STATUS] Complete
```

**Implementation steps**:
1. Create skill directory
2. Write SKILL.md focusing on client-side patterns
3. Note different env var prefixes for CRA vs Vite

### React Router Skill

**Overview**: React Router integration supporting multiple modes (v6, v7 Framework, v7 Data, v7 Declarative).

```yaml
# packages/cli/.claude/skills/workos-authkit-react-router/SKILL.md

---
name: workos-authkit-react-router
description: Integrate WorkOS AuthKit with React Router applications. Supports v6 and v7 (Framework, Data, Declarative modes). Use when project uses react-router, react-router-dom, or mentions React Router authentication.
---

# WorkOS AuthKit for React Router

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-react-router/blob/main/README.md

2. **Install SDK**
   ```bash
   npm install @workos-inc/authkit-react-router
   ```

3. **Detect Router Mode**
   - v7 Framework: Has `react-router.config.ts`
   - v7 Data: Uses `createBrowserRouter` in source files
   - v7 Declarative: Uses `<BrowserRouter>` component
   - v6: Check package.json version

## Mode-Specific Integration

### v7 Framework Mode (with react-router.config.ts)

Use loader-based authentication. The SDK provides:
- `authLoader` for route loaders
- `handleCallbackRoute` for the callback route

Create callback route at the exact path matching `WORKOS_REDIRECT_URI`.

### v7 Data Mode (createBrowserRouter)

Similar to Framework mode but configured in your router setup.
Use loaders for auth checks.

### v7 Declarative Mode (<BrowserRouter>)

Use the SDK's React hooks and components.
Wrap routes with auth checks.

### v6 Mode

Follow v7 Declarative patterns with version-appropriate APIs.

## Callback Route

All modes need a callback route at the path matching `WORKOS_REDIRECT_URI`.
Use the SDK's callback handler - do NOT write custom OAuth code.

## UI Integration

Update your home route component:

**Logged out:** Sign In button triggering auth flow
**Logged in:** User info display + Sign Out button

## Status Reporting

- [STATUS] Reading SDK documentation
- [STATUS] Installing @workos-inc/authkit-react-router
- [STATUS] Detecting router mode
- [STATUS] Creating callback route
- [STATUS] Adding authentication UI
- [STATUS] Complete
```

**Implementation steps**:
1. Create skill directory
2. Include mode detection guidance
3. Cover all four router modes

### TanStack Start Skill

**Overview**: TanStack Start integration with server functions.

```yaml
# packages/cli/.claude/skills/workos-authkit-tanstack-start/SKILL.md

---
name: workos-authkit-tanstack-start
description: Integrate WorkOS AuthKit with TanStack Start applications. Full-stack TypeScript with server functions. Use when project uses TanStack Start, @tanstack/start, or vinxi.
---

# WorkOS AuthKit for TanStack Start

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-tanstack-start/blob/main/README.md

2. **Install SDK**
   ```bash
   npm install @workos-inc/authkit-tanstack-start
   ```

## Integration Steps

### Server Functions

TanStack Start uses server functions for auth operations.
Follow the README for setting up:
- Auth middleware
- Session handling
- User retrieval

### Callback Route

Create a route at the exact path matching `WORKOS_REDIRECT_URI`.
Use the SDK's handler - do NOT write custom callback logic.

### Route Protection

Use the SDK's auth utilities to protect routes.
Check authentication status in route loaders.

## UI Integration

Update your index route:

**Logged out:** Sign In button
**Logged in:** User display + Sign Out button

Use the SDK's provided functions for sign-in/out URLs.

## Status Reporting

- [STATUS] Reading SDK documentation
- [STATUS] Installing @workos-inc/authkit-tanstack-start
- [STATUS] Creating callback route
- [STATUS] Setting up auth middleware
- [STATUS] Adding authentication UI
- [STATUS] Complete
```

### Vanilla JS Skill

**Overview**: Browser-only JavaScript integration without frameworks.

```yaml
# packages/cli/.claude/skills/workos-authkit-vanilla-js/SKILL.md

---
name: workos-authkit-vanilla-js
description: Integrate WorkOS AuthKit with vanilla JavaScript applications. No framework required, browser-only. Use when project is plain HTML/JS, doesn't use React/Vue/etc, or mentions vanilla JavaScript authentication.
---

# WorkOS AuthKit for Vanilla JavaScript

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-js/blob/main/README.md

2. **Install SDK**

   Via npm (if using bundler):
   ```bash
   npm install @workos-inc/authkit-js
   ```

   Via CDN (no build step):
   ```html
   <script src="https://unpkg.com/@workos-inc/authkit-js"></script>
   ```

## Integration Steps

### Initialize AuthKit

Initialize the AuthKit client with your Client ID.
Get the exact initialization code from the README.

### Callback Handling

The browser SDK handles OAuth callbacks internally.
No server-side route needed.

### Authentication Methods

Use the SDK's methods:
- `signIn()` - Trigger authentication
- `signOut()` - Clear session
- `getUser()` - Get current user

## UI Integration

Add to your HTML:

```html
<div id="auth-container">
  <!-- SDK will manage this -->
</div>
```

JavaScript:
- On page load, check auth status
- Show Sign In button if not authenticated
- Show user info + Sign Out if authenticated

## Status Reporting

- [STATUS] Reading SDK documentation
- [STATUS] Adding AuthKit JS to project
- [STATUS] Initializing AuthKit client
- [STATUS] Adding authentication UI
- [STATUS] Complete
```

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| None | Skills are markdown files - no unit tests |

### Manual Testing

For each skill:
- [ ] YAML frontmatter parses correctly (valid name, description)
- [ ] Skill is under 500 lines
- [ ] Base skill reference is valid relative path
- [ ] SDK README URL is accessible
- [ ] Description contains framework name and trigger keywords

### Integration Testing

- [ ] Create test Next.js project, run wizard, verify skill would be selected
- [ ] Create test React SPA, verify skill selection
- [ ] Repeat for each framework

## Error Handling

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| SDK README unreachable | Skill instructions are self-contained enough to proceed |
| Wrong skill selected | Description keywords refined based on testing |

## Validation Commands

```bash
# Validate YAML frontmatter in all skills
find packages/cli/.claude/skills -name "SKILL.md" -exec head -10 {} \;

# Check line counts
wc -l packages/cli/.claude/skills/*/SKILL.md

# Verify no secrets in skills
grep -r "sk_" packages/cli/.claude/skills/ && echo "ERROR: Found API key" || echo "OK: No secrets"
```

## Rollout Considerations

- **Feature flag**: None - skills are passive until Phase 3 enables them
- **Monitoring**: N/A until skills are actively used
- **Rollback plan**: Delete skill directories

## Open Items

- [ ] Test skill descriptions for reliable auto-selection
- [ ] Determine if React Router needs separate files per mode

---

*This spec is ready for implementation. Follow the patterns and validate at each step.*
