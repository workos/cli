---
name: workos-authkit-react
description: Integrate WorkOS AuthKit with React single-page applications. Client-side only authentication. Use when the project is a React SPA, uses react without Next.js, or mentions React authentication.
---

# WorkOS AuthKit for React

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## CRITICAL: Follow Steps In Order

You MUST complete each step fully before moving to the next.

## Step 1: Fetch SDK Documentation

Use WebFetch to read: https://github.com/workos/authkit-react/blob/main/README.md
The README is the source of truth - follow it exactly.

Report: [STATUS] Reading SDK documentation

## Step 2: Install SDK Package

**CRITICAL**: The package MUST be installed before writing any code that imports it.

Detect package manager and run install:
```bash
npm install @workos-inc/authkit-react
```

**Wait for installation to complete** - do not proceed until you see success output.

Report: [STATUS] Installing @workos-inc/authkit-react

**Verify installation**: Check that `node_modules/@workos-inc/authkit-react` exists before proceeding.

## Step 3: Integration Steps

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

## Step 4: UI Integration

Update your main component:

1. Import `useAuth` hook:
   ```typescript
   import { useAuth } from '@workos-inc/authkit-react';
   ```

2. Use the hook:
   ```typescript
   const { user, signIn, signOut } = useAuth();
   ```

3. Add UI logic:
   - **Logged out**: Show "Sign In" button that calls `signIn()`
   - **Logged in**: Display `user.firstName`, `user.email`, and "Sign Out" button that calls `signOut()`

Follow the exact patterns from the SDK README.

Report: [STATUS] Adding authentication UI

## Step 5: Verify Installation

Before reporting complete:
1. Check that all imports can resolve (no "module not found" errors)
2. Verify AuthKitProvider wraps the app
3. Verify environment variable is configured

Report: [STATUS] Integration complete
