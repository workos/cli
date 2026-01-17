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
