---
name: workos-authkit-react
description: Integrate WorkOS AuthKit with React single-page applications. Client-side only authentication. Use when the project is a React SPA, uses react without Next.js, or mentions React authentication.
---

# WorkOS AuthKit for React

## Phase 1: Pre-Flight Checks

TaskUpdate: { taskId: "preflight", status: "in_progress" }

### 1.1 Verify React Project

Check for React SPA markers:

- `package.json` has `"react"` and `"react-dom"` dependencies
- No `next` dependency (use Next.js skill instead)
- No `react-router` dependency (use React Router skill instead)

### 1.2 Fetch SDK Documentation

**REQUIRED**: Use WebFetch to read:

```
https://github.com/workos/authkit-react/blob/main/README.md
```

The README is the source of truth. If this skill conflicts, follow the README.

### 1.3 Detect Build Tool

Check for:

- `vite.config.ts` → Vite (use `VITE_` prefix for env vars)
- `craco.config.js` or default → Create React App (use `REACT_APP_` prefix)

### 1.4 Verify Environment Variables

Read `.env` or `.env.local` and confirm:

- `VITE_WORKOS_CLIENT_ID` or `REACT_APP_WORKOS_CLIENT_ID`
- `VITE_WORKOS_REDIRECT_URI` or `REACT_APP_WORKOS_REDIRECT_URI`

Note: No `WORKOS_API_KEY` needed - client-side only SDK.

### 1.5 Create Tasks

Create all tasks per base template, then:
TaskUpdate: { taskId: "preflight", status: "completed" }

[STATUS] Pre-flight checks passed

## Phase 2: Install SDK

TaskUpdate: { taskId: "install", status: "in_progress" }

Detect package manager and run:

```bash
# pnpm
pnpm add @workos-inc/authkit-react

# yarn
yarn add @workos-inc/authkit-react

# npm
npm install @workos-inc/authkit-react
```

**WAIT** for installation to complete.

**VERIFY**: Check `node_modules/@workos-inc/authkit-react` exists

TaskUpdate: { taskId: "install", status: "completed" }

[STATUS] SDK installed

## Phase 3: Callback Route (Client-Side Handled)

TaskUpdate: { taskId: "callback", status: "in_progress" }

The React SDK handles OAuth callbacks **internally** via the AuthKitProvider.

**No server-side callback route needed.**

The SDK intercepts the redirect URI and handles token exchange client-side.

Ensure the redirect URI in your environment variables matches the one configured in WorkOS Dashboard.

**VERIFY**: Redirect URI env var is set correctly

TaskUpdate: { taskId: "callback", status: "completed" }

[STATUS] Callback handling configured (SDK internal)

## Phase 4: Setup AuthKitProvider

TaskUpdate: { taskId: "provider", status: "in_progress" }

### 4.1 Wrap App with AuthKitProvider

Edit your main entry file (`src/main.tsx` or `src/index.tsx`):

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthKitProvider } from '@workos-inc/authkit-react';
import App from './App';

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID; // or process.env.REACT_APP_WORKOS_CLIENT_ID

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthKitProvider clientId={clientId}>
      <App />
    </AuthKitProvider>
  </StrictMode>
);
```

**VERIFY**: `grep AuthKitProvider src/main.tsx` or `src/index.tsx` finds match

TaskUpdate: { taskId: "provider", status: "completed" }

[STATUS] Provider configured

## Phase 5: UI Integration & Verification

TaskUpdate: { taskId: "ui", status: "in_progress" }

### 5.1 Update App Component

Edit `src/App.tsx`:

```typescript
import { useAuth } from '@workos-inc/authkit-react';

function App() {
  const { user, isLoading, signIn, signOut } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return (
      <main>
        <h1>Welcome</h1>
        <button onClick={() => signIn()}>Sign In</button>
      </main>
    );
  }

  return (
    <main>
      <h1>Welcome, {user.firstName || user.email}</h1>
      <p>{user.email}</p>
      <button onClick={() => signOut()}>Sign Out</button>
    </main>
  );
}

export default App;
```

TaskUpdate: { taskId: "ui", status: "completed" }

[STATUS] Auth UI added

### 5.2 Verify Build

TaskUpdate: { taskId: "verify", status: "in_progress" }

Run build to confirm no errors:

```bash
npm run build
```

**VERIFY**: Build exits with code 0

TaskUpdate: { taskId: "verify", status: "completed" }

[STATUS] Integration complete

## Error Recovery (React SPA Specific)

### "Module not found: @workos-inc/authkit-react"

- **Cause**: SDK not installed before writing imports
- **Fix**: Run install command, verify `node_modules/@workos-inc/authkit-react` exists

### "clientId is required" error

- **Cause**: Environment variable not accessible
- **Fix**: Check prefix matches build tool (`VITE_` or `REACT_APP_`)

### Auth state lost on refresh

- **Cause**: Token not persisted
- **Fix**: SDK handles this via localStorage; check browser dev tools for stored tokens

### Sign in redirects but callback fails

- **Cause**: Redirect URI mismatch
- **Fix**: Ensure env var URI exactly matches WorkOS Dashboard configuration

### useAuth returns undefined

- **Cause**: Component not wrapped in AuthKitProvider
- **Fix**: Verify provider wraps entire app in entry file
