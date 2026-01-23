---
name: workos-authkit-react-router
description: Integrate WorkOS AuthKit with React Router applications. Supports v6 and v7 (Framework, Data, Declarative modes). Use when project uses react-router, react-router-dom, or mentions React Router authentication.
---

# WorkOS AuthKit for React Router

## Phase 1: Pre-Flight Checks

TaskUpdate: { taskId: "preflight", status: "in_progress" }

### 1.1 Fetch SDK Documentation (BLOCKING)

**⛔ STOP - Do not proceed until this step completes.**

Use WebFetch to read the SDK README:

```
https://github.com/workos/authkit-react-router/blob/main/README.md
```

**The README is the source of truth.** If this skill conflicts with the README, **follow the README**. Do not write any code until you have read and understood the current SDK documentation.

### 1.2 Verify React Router Project

Check for React Router markers:

- `package.json` has `"react-router"` or `"react-router-dom"` dependency
- Check version: v6 vs v7

### 1.3 Detect Router Mode

Check for mode indicators:

| Mode           | Detection                       | Key Files                 |
| -------------- | ------------------------------- | ------------------------- |
| v7 Framework   | `react-router.config.ts` exists | Routes in `app/routes/`   |
| v7 Data        | `createBrowserRouter` in source | Loaders in route config   |
| v7 Declarative | `<BrowserRouter>` component     | Routes as JSX             |
| v6             | package.json version `"6.x"`    | Similar to v7 Declarative |

### 1.4 Verify Environment Variables

Read `.env` or `.env.local` and confirm:

- `WORKOS_API_KEY` (starts with `sk_`)
- `WORKOS_CLIENT_ID` (starts with `client_`)
- `WORKOS_REDIRECT_URI` (valid URL)
- `WORKOS_COOKIE_PASSWORD` (32+ characters, for server modes)

### 1.5 Create Tasks

Create all tasks per base template, then:
TaskUpdate: { taskId: "preflight", status: "completed" }

[STATUS] Pre-flight checks passed

## Phase 2: Install SDK

TaskUpdate: { taskId: "install", status: "in_progress" }

Detect package manager and run:

```bash
# pnpm
pnpm add @workos-inc/authkit-react-router

# yarn
yarn add @workos-inc/authkit-react-router

# npm
npm install @workos-inc/authkit-react-router
```

**WAIT** for installation to complete.

**VERIFY**: Check `node_modules/@workos-inc/authkit-react-router` exists

TaskUpdate: { taskId: "install", status: "completed" }

[STATUS] SDK installed

## Phase 3: Create Callback Route

TaskUpdate: { taskId: "callback", status: "in_progress" }

### 3.1 Determine Route Path

Read `WORKOS_REDIRECT_URI` from `.env` or `.env.local`.
Extract path (e.g., `http://localhost:3000/auth/callback` → `/auth/callback`)

### 3.2 Create Callback Route (by mode)

**IMPORTANT**: Use `authLoader` (NOT `authkitLoader`) for the callback route. `authLoader` handles the OAuth callback and redirects. `authkitLoader` is for fetching user data in other routes.

#### v7 Framework Mode

Create `app/routes/auth.callback.tsx`:

```typescript
import { authLoader } from '@workos-inc/authkit-react-router';

export const loader = authLoader();
```

#### v7 Data Mode

Add to your router configuration:

```typescript
import { authLoader } from '@workos-inc/authkit-react-router';

const router = createBrowserRouter([
  // ... other routes
  {
    path: '/auth/callback',
    loader: authLoader(),
  },
]);
```

#### v7 Declarative / v6 Mode

Create `src/routes/AuthCallback.tsx`:

```typescript
import { authLoader } from '@workos-inc/authkit-react-router';
import { redirect } from 'react-router-dom';

// Add callback route to your router config
{
  path: '/auth/callback',
  loader: authLoader({ returnPathname: '/' }),
}
```

The SDK handles the callback internally via `authLoader()`. No custom component needed.

**VERIFY**: Callback route exists at path matching `WORKOS_REDIRECT_URI`

TaskUpdate: { taskId: "callback", status: "completed" }

[STATUS] Callback route created

## Phase 4: Setup Auth Loader/Provider

TaskUpdate: { taskId: "provider", status: "in_progress" }

### 4.1 Framework Mode: Add Auth Loader

Edit `app/root.tsx`:

```typescript
import { authLoader } from '@workos-inc/authkit-react-router';

export const loader = authLoader;

export default function Root() {
  // ...
}
```

### 4.2 Data Mode: Add Auth to Root Loader

```typescript
import { authLoader } from '@workos-inc/authkit-react-router';

const router = createBrowserRouter([
  {
    path: '/',
    loader: authLoader,
    element: <Root />,
    children: [/* ... */],
  },
]);
```

### 4.3 Declarative/v6 Mode: Use AuthKitProvider

Wrap app with provider in entry file:

```typescript
import { AuthKitProvider } from '@workos-inc/authkit-react-router';

function App() {
  return (
    <AuthKitProvider clientId={process.env.WORKOS_CLIENT_ID}>
      <BrowserRouter>
        {/* routes */}
      </BrowserRouter>
    </AuthKitProvider>
  );
}
```

**VERIFY**: Auth setup present in root/entry file

TaskUpdate: { taskId: "provider", status: "completed" }

[STATUS] Auth loader/provider configured

## Phase 5: UI Integration & Verification

TaskUpdate: { taskId: "ui", status: "in_progress" }

### 5.1 Update Home Route

#### Framework/Data Mode (with loaders)

```typescript
import { useLoaderData } from 'react-router';
import { getSignInUrl, signOut, authkitLoader } from '@workos-inc/authkit-react-router';

// In your route config, use authkitLoader to get user AND signInUrl
export const loader = async () => {
  const { user } = await authkitLoader();
  const signInUrl = await getSignInUrl();
  return { user, signInUrl };
};

export default function Home() {
  const { user, signInUrl } = useLoaderData();

  if (!user) {
    return (
      <main>
        <h1>Welcome</h1>
        <a href={signInUrl}>Sign In</a>
      </main>
    );
  }

  return (
    <main>
      <h1>Welcome, {user.firstName || user.email}</h1>
      <p>{user.email}</p>
      <form action={signOut} method="post">
        <button type="submit">Sign Out</button>
      </form>
    </main>
  );
}
```

#### Declarative/v6 Mode (with hooks)

```typescript
import { useAuth } from '@workos-inc/authkit-react-router';

export function Home() {
  const { user, signIn, signOut } = useAuth();

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

## Error Recovery (React Router Specific)

### "Module not found: @workos-inc/authkit-react-router"

- **Cause**: SDK not installed before writing imports
- **Fix**: Run install command, verify `node_modules/@workos-inc/authkit-react-router` exists

### "loader is not a function" error

- **Cause**: Using loader pattern in wrong mode
- **Fix**: Check router mode - loaders only work in Framework/Data modes

### useAuth returns undefined

- **Cause**: Using hooks without AuthKitProvider
- **Fix**: Wrap app with AuthKitProvider (Declarative/v6 mode)

### Callback route 404

- **Cause**: Route path doesn't match redirect URI
- **Fix**: Extract exact path from `WORKOS_REDIRECT_URI` and create route there

### Auth state not available in child routes

- **Cause**: Auth loader only on specific routes
- **Fix**: Add auth loader to root route so all children inherit auth context
