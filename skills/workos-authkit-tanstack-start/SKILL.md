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

- `package.json` has `"@tanstack/start"` or `"@tanstack/react-start"` dependency
- `app.config.ts` exists (vinxi config)
- `app/` directory with route files
- Look for `app/router.tsx` or `app.tsx` with `createRouter`

### 1.3 Verify Environment Variables

Read `.env` or `.env.local` and confirm:

- `WORKOS_API_KEY` (starts with `sk_`)
- `WORKOS_CLIENT_ID` (starts with `client_`)
- `WORKOS_REDIRECT_URI` (valid URL, e.g., `http://localhost:3000/api/auth/callback`)
- `WORKOS_COOKIE_PASSWORD` (32+ characters)

If `WORKOS_COOKIE_PASSWORD` missing or too short, generate:

```bash
openssl rand -base64 32
```

### 1.4 Create Tasks

Create all tasks per base template, then:
TaskUpdate: { taskId: "preflight", status: "completed" }

[STATUS] Pre-flight checks passed

## Phase 2: Install SDK

TaskUpdate: { taskId: "install", status: "in_progress" }

**IMPORTANT**: The package name is `@workos/authkit-tanstack-react-start` (NOT `@workos-inc/`).

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

**VERIFY**: Check package exists:

```bash
ls node_modules/@workos/authkit-tanstack-react-start
```

TaskUpdate: { taskId: "install", status: "completed" }

[STATUS] SDK installed

## Phase 3: Create Callback Route

TaskUpdate: { taskId: "callback", status: "in_progress" }

### 3.1 Callback Route Path

Read `WORKOS_REDIRECT_URI` from `.env`. Extract path component.
Example: `http://localhost:3000/api/auth/callback` → `/api/auth/callback`

### 3.2 Create Callback Route File

Create `app/routes/api/auth/callback.tsx`:

```typescript
import { createAPIFileRoute } from '@tanstack/react-start/api';
import { handleAuth } from '@workos/authkit-tanstack-react-start';

export const APIRoute = createAPIFileRoute('/api/auth/callback')({
  GET: handleAuth(),
});
```

**DO NOT** write custom OAuth callback logic. Use `handleAuth()`.

**VERIFY**: Route file exists and contains `handleAuth`:

```bash
grep -l "handleAuth" app/routes/api/auth/callback.tsx
```

TaskUpdate: { taskId: "callback", status: "completed" }

[STATUS] Callback route created at /api/auth/callback

## Phase 4: Configure Router Middleware (CRITICAL)

TaskUpdate: { taskId: "provider", status: "in_progress" }

### 4.1 Add authkitMiddleware to Router

**⚠️ THIS STEP IS REQUIRED - SKIPPING IT CAUSES "AuthKit middleware is not configured" ERROR**

Find the file where `createRouter` is called. This is typically:

- `app/router.tsx`
- `app.tsx`
- `src/router.tsx`

Edit that file to add `authkitMiddleware`:

```typescript
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { authkitMiddleware } from '@workos/authkit-tanstack-react-start';
import { routeTree } from './routeTree.gen';

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    context: {
      // your existing context here
    },
    middleware: [authkitMiddleware()],
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
```

**Key points:**

- Import `authkitMiddleware` from `@workos/authkit-tanstack-react-start`
- Add `middleware: [authkitMiddleware()]` to the router config
- The middleware MUST be in an array: `[authkitMiddleware()]`

### 4.2 Create Logout Route

Create `app/routes/logout.tsx`:

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router';
import { signOut } from '@workos/authkit-tanstack-react-start';

export const Route = createFileRoute('/logout')({
  preload: false,
  loader: async () => {
    await signOut();
    throw redirect({ to: '/' });
  },
});
```

### 4.3 Verify Middleware Configuration

**VERIFY**: `authkitMiddleware` is imported and used:

```bash
grep "authkitMiddleware" app/router.tsx app.tsx src/router.tsx 2>/dev/null
```

At least one file must match with both import and usage.

TaskUpdate: { taskId: "provider", status: "completed" }

[STATUS] Router middleware configured

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
      <Link to="/logout">Sign Out</Link>
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
pnpm run build
# or
npm run build
```

**VERIFY**: Build exits with code 0

TaskUpdate: { taskId: "verify", status: "completed" }

[STATUS] Integration complete

## Error Recovery (TanStack Start Specific)

### "AuthKit middleware is not configured"

- **Cause**: `authkitMiddleware()` not added to router
- **Fix**: Edit `app/router.tsx` or `app.tsx`, add `middleware: [authkitMiddleware()]` to `createRouter()` config
- **Code**:
  ```typescript
  import { authkitMiddleware } from '@workos/authkit-tanstack-react-start';
  // in createRouter config:
  middleware: [authkitMiddleware()]
  ```
- **Verify**: `grep "authkitMiddleware" app/router.tsx app.tsx`

### "Module not found: @workos/authkit-tanstack-react-start"

- **Cause**: SDK not installed or wrong package name
- **Fix**: Run `pnpm add @workos/authkit-tanstack-react-start` (note: `@workos/` NOT `@workos-inc/`)
- **Verify**: `ls node_modules/@workos/authkit-tanstack-react-start`

### Callback route 404

- **Cause**: Route file path doesn't match `WORKOS_REDIRECT_URI`
- **Fix**: If URI is `/api/auth/callback`, file must be at `app/routes/api/auth/callback.tsx`
- **Verify**: File exists at correct nested path

### "getAuth is not a function" or returns undefined

- **Cause**: Middleware not running, so auth context not available
- **Fix**: Ensure `authkitMiddleware()` is configured in router (see first error)

### Sign out doesn't redirect

- **Cause**: Missing redirect after `signOut()`
- **Fix**: Add `throw redirect({ to: '/' })` after `await signOut()` in loader

### "Cookie password too short"

- **Cause**: `WORKOS_COOKIE_PASSWORD` < 32 chars
- **Fix**: Generate with `openssl rand -base64 32`, add to `.env`

### Build fails with type errors on routeTree

- **Cause**: Routes not generated
- **Fix**: Run `pnpm dev` once to generate `routeTree.gen.ts`, or check `tsr.config.json`

## Environment Variables Reference

| Variable                 | Description                  | Required |
| ------------------------ | ---------------------------- | -------- |
| `WORKOS_API_KEY`         | Server-side API key (sk_xxx) | Yes      |
| `WORKOS_CLIENT_ID`       | Public client identifier     | Yes      |
| `WORKOS_REDIRECT_URI`    | OAuth callback URL           | Yes      |
| `WORKOS_COOKIE_PASSWORD` | 32+ char session secret      | Yes      |
| `WORKOS_COOKIE_MAX_AGE`  | Session duration (seconds)   | No       |
| `WORKOS_COOKIE_DOMAIN`   | Cookie domain                | No       |
