---
name: workos-authkit-tanstack-start
description: Integrate WorkOS AuthKit with TanStack Start applications. Full-stack TypeScript with server functions. Use when project uses TanStack Start, @tanstack/start, or vinxi.
---

# WorkOS AuthKit for TanStack Start

## Phase 1: Pre-Flight Checks

TaskUpdate: { taskId: "preflight", status: "in_progress" }

### 1.1 Fetch SDK Documentation (BLOCKING)

**⛔ STOP - Do not proceed until this step completes.**

Use WebFetch to read the SDK README:

```
https://github.com/workos/authkit-tanstack-start/blob/main/README.md
```

**The README is the source of truth.** If this skill conflicts with the README, **follow the README**. Do not write any code until you have read and understood the current SDK documentation.

### 1.2 Verify TanStack Start Project

Check for TanStack Start markers:

- `package.json` has `"@tanstack/start"` dependency
- `app.config.ts` exists (vinxi config)
- `app/` directory with route files

### 1.3 Verify Environment Variables

Read `.env` and confirm:

- `WORKOS_API_KEY` (starts with `sk_`)
- `WORKOS_CLIENT_ID` (starts with `client_`)
- `WORKOS_REDIRECT_URI` (valid URL)
- `WORKOS_COOKIE_PASSWORD` (32+ characters)

### 1.4 Create Tasks

Create all tasks per base template, then:
TaskUpdate: { taskId: "preflight", status: "completed" }

[STATUS] Pre-flight checks passed

## Phase 2: Install SDK

TaskUpdate: { taskId: "install", status: "in_progress" }

Detect package manager and run:

```bash
# pnpm
pnpm add @workos/authkit-tanstack-react-start

# yarn
yarn add @workos/authkit-tanstack-react-start

# npm
npm install @workos/authkit-tanstack-react-start
```

**WAIT** for installation to complete.

**VERIFY**: Check `node_modules/@workos/authkit-tanstack-react-start` exists

TaskUpdate: { taskId: "install", status: "completed" }

[STATUS] SDK installed

## Phase 3: Create Callback Route

TaskUpdate: { taskId: "callback", status: "in_progress" }

### 3.1 Callback Route Path

The callback route **must** be at `/api/auth/callback`.

Set `WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback` in `.env`.

### 3.2 Create Callback Route

Create `app/routes/api/auth/callback.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { handleCallbackRoute } from '@workos/authkit-tanstack-react-start';

export const Route = createFileRoute('/api/auth/callback')({
  loader: handleCallbackRoute(),
});
```

**DO NOT** write custom OAuth callback logic. Use `handleCallbackRoute()`.

**VERIFY**: Route file exists at `app/routes/api/auth/callback.tsx`

TaskUpdate: { taskId: "callback", status: "completed" }

[STATUS] Callback route created

## Phase 4: Setup Auth Middleware

TaskUpdate: { taskId: "provider", status: "in_progress" }

### 4.1 Create Logout Route

Create `app/routes/logout.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { signOut } from '@workos/authkit-tanstack-react-start';

export const Route = createFileRoute('/logout')({
  preload: false,
  loader: async () => {
    await signOut();
  },
});
```

### 4.2 Add Auth to Root Route

Edit `app/routes/__root.tsx`:

```typescript
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { getAuth } from '@workos/authkit-tanstack-react-start';

export const Route = createRootRoute({
  loader: async () => {
    const { user } = await getAuth();
    return { user };
  },
  component: () => <Outlet />,
});
```

**VERIFY**: Auth loader in root route, server functions created

TaskUpdate: { taskId: "provider", status: "completed" }

[STATUS] Auth middleware configured

## Phase 5: UI Integration & Verification

TaskUpdate: { taskId: "ui", status: "in_progress" }

### 5.1 Update Index Route

Edit `app/routes/index.tsx`:

```typescript
import { createFileRoute, Link } from '@tanstack/react-router';
import { getAuth, getSignInUrl } from '@workos/authkit-tanstack-react-start';

export const Route = createFileRoute('/')({
  loader: async () => {
    const { user } = await getAuth();
    const signInUrl = await getSignInUrl();
    return { user, signInUrl };
  },
  component: Home,
});

function Home() {
  const { user, signInUrl } = Route.useLoaderData();

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
      <Link to="/logout" reloadDocument>
        Sign Out
      </Link>
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

## Error Recovery (TanStack Start Specific)

### "Module not found: @workos/authkit-tanstack-react-start"

- **Cause**: SDK not installed before writing imports
- **Fix**: Run install command, verify `node_modules/@workos/authkit-tanstack-react-start` exists

### Route loader not executing

- **Cause**: Route file not in correct location
- **Fix**: TanStack uses file-based routing - `app/routes/api/auth/callback.tsx` → `/api/auth/callback`

### Auth user undefined in child routes

- **Cause**: Not accessing loader data correctly
- **Fix**: Use `Route.useLoaderData()` to access data from route's own loader

### Sign-in redirects to /api/auth/signin (404)

- **Cause**: Using wrong pattern for sign-in URL
- **Fix**: Call `await getSignInUrl()` in loader, pass URL to component, use `<a href={signInUrl}>`

### Cookie errors

- **Cause**: `WORKOS_COOKIE_PASSWORD` missing or too short
- **Fix**: Add 32+ character password to `.env`
