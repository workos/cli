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
