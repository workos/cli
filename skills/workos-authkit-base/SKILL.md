---
name: workos-authkit-base
description: Base template for WorkOS AuthKit integration skills. Defines standard phases, task structure, and verification patterns.
---

# WorkOS AuthKit Base Template

## CRITICAL: Installation Order

1. **Install SDK package FIRST** - before writing ANY import statements
2. **Wait for install to complete** - verify node_modules exists
3. **Then write code** - imports will resolve correctly

## Task Structure (Required)

Every AuthKit integration MUST create these tasks:

| ID        | Subject                   | Blocked By         | Active Form               |
| --------- | ------------------------- | ------------------ | ------------------------- |
| preflight | Pre-flight checks         | -                  | Running pre-flight checks |
| install   | Install SDK package       | preflight          | Installing SDK            |
| callback  | Create callback route     | install            | Creating callback route   |
| provider  | Setup provider/middleware | install            | Setting up auth provider  |
| ui        | Add authentication UI     | callback, provider | Adding auth UI            |
| verify    | Verify installation       | ui                 | Verifying installation    |

**Task Creation Pattern**:

```
TaskCreate: { subject: "Pre-flight checks", description: "Verify framework and env vars", activeForm: "Running pre-flight checks" }
TaskCreate: { subject: "Install SDK package", description: "Install @workos-inc/authkit-{framework}", activeForm: "Installing SDK" }
TaskCreate: { subject: "Create callback route", description: "Create OAuth callback at REDIRECT_URI path", activeForm: "Creating callback route" }
TaskCreate: { subject: "Setup provider/middleware", description: "Configure auth context", activeForm: "Setting up auth provider" }
TaskCreate: { subject: "Add authentication UI", description: "Add sign-in/out to home page", activeForm: "Adding auth UI" }
TaskCreate: { subject: "Verify installation", description: "Run build and confirm success", activeForm: "Verifying installation" }

// Set dependencies
TaskUpdate: { taskId: "install", addBlockedBy: ["preflight"] }
TaskUpdate: { taskId: "callback", addBlockedBy: ["install"] }
TaskUpdate: { taskId: "provider", addBlockedBy: ["install"] }
TaskUpdate: { taskId: "ui", addBlockedBy: ["callback", "provider"] }
TaskUpdate: { taskId: "verify", addBlockedBy: ["ui"] }
```

## Phase 1: Pre-Flight Checks

**Start**: `TaskUpdate: { taskId: "preflight", status: "in_progress" }`

1. Verify framework marker exists
2. Read `.env.local` and confirm required vars:
   - `WORKOS_API_KEY` (server-side SDKs)
   - `WORKOS_CLIENT_ID`
   - `WORKOS_REDIRECT_URI` or `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
   - `WORKOS_COOKIE_PASSWORD` (32+ chars)
3. Create all tasks (see Task Structure above)

**Report**: `[STATUS] Pre-flight checks passed`

**VERIFY**: All env vars present, framework detected
**Complete**: `TaskUpdate: { taskId: "preflight", status: "completed" }`

## Phase 2: SDK Installation

**Start**: `TaskUpdate: { taskId: "install", status: "in_progress" }`

1. Detect package manager:
   - `pnpm-lock.yaml` → `pnpm add`
   - `yarn.lock` → `yarn add`
   - `bun.lockb` → `bun add`
   - `package-lock.json` or default → `npm install`

2. Run install command (framework skill provides package name)

3. **WAIT** for command to complete

**Report**: `[STATUS] SDK installed`

**VERIFY**: `ls node_modules/@workos-inc/authkit-{framework}` succeeds
**Complete**: `TaskUpdate: { taskId: "install", status: "completed" }`

## Phase 3: Callback Route Creation

**Start**: `TaskUpdate: { taskId: "callback", status: "in_progress" }`

1. Read redirect URI from `.env.local`
2. Extract URL path (e.g., `http://localhost:3000/auth/callback` → `/auth/callback`)
3. Create route file at framework-appropriate path
4. Use SDK's callback handler (NOT custom OAuth code)

**Report**: `[STATUS] Callback route created at {path}`

**VERIFY**: Route file exists and contains SDK import
**Complete**: `TaskUpdate: { taskId: "callback", status: "completed" }`

## Phase 4: Provider/Middleware Setup

**Start**: `TaskUpdate: { taskId: "provider", status: "in_progress" }`

Varies by framework:

- **Client-side**: Wrap app with `AuthKitProvider`
- **Server-side**: Add middleware for session handling

**Report**: `[STATUS] Provider/middleware configured`

**VERIFY**: Pattern exists in target file
**Complete**: `TaskUpdate: { taskId: "provider", status: "completed" }`

## Phase 5: UI Integration & Verification

**Start**: `TaskUpdate: { taskId: "ui", status: "in_progress" }`

1. Update home page:
   - **Logged out**: Show "Sign In" button
   - **Logged in**: Show user info + "Sign Out" button

2. Use SDK functions (NOT manual OAuth URLs)

**Report**: `[STATUS] Auth UI added`

**Complete**: `TaskUpdate: { taskId: "ui", status: "completed" }`

**Start verification**: `TaskUpdate: { taskId: "verify", status: "in_progress" }`

3. Run build to verify compilation:
   ```bash
   {pkg-manager} run build
   ```

**VERIFY**: Build exits with code 0

**Report**: `[STATUS] Integration complete`

**Complete**: `TaskUpdate: { taskId: "verify", status: "completed" }`

## Error Recovery

### "Module not found: @workos-inc/authkit-\*"

- **Cause**: SDK not installed
- **Fix**: Re-run install, verify `node_modules/@workos-inc` exists

### Build fails with import errors

- **Cause**: Package manager didn't install correctly
- **Fix**: Delete `node_modules`, run fresh install

### "Invalid redirect URI" at runtime

- **Cause**: Route path doesn't match `WORKOS_REDIRECT_URI`
- **Fix**: Read env var, create route at exact path

### "Cookie password too short"

- **Cause**: `WORKOS_COOKIE_PASSWORD` < 32 chars
- **Fix**: Generate with `openssl rand -base64 32`

### Auth state not persisting

- **Cause**: `AuthKitProvider` missing or misconfigured
- **Fix**: Verify provider wraps entire app in layout

## Environment Variables Reference

| Variable                          | Description                  | Required By |
| --------------------------------- | ---------------------------- | ----------- |
| `WORKOS_API_KEY`                  | Server-side API key (sk_xxx) | Server SDKs |
| `WORKOS_CLIENT_ID`                | Public client identifier     | All SDKs    |
| `WORKOS_REDIRECT_URI`             | OAuth callback URL           | Server SDKs |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | Callback URL (Next.js)       | Next.js SDK |
| `WORKOS_COOKIE_PASSWORD`          | 32+ char session secret      | Server SDKs |
