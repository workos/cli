---
name: workos-authkit-tanstack-start
description: Integrate WorkOS AuthKit with TanStack Start applications. Full-stack TypeScript with server functions. Use when project uses TanStack Start, @tanstack/start, or vinxi.
---

# WorkOS AuthKit for TanStack Start

## Phase 1: Pre-Flight Checks

TaskUpdate: { taskId: "preflight", status: "in_progress" }

### 1.1 Verify TanStack Start Project

Check for TanStack Start markers:

- `package.json` has `"@tanstack/start"` dependency
- `app.config.ts` exists (vinxi config)
- `app/` directory with route files

### 1.2 Fetch SDK Documentation

**REQUIRED**: Use WebFetch to read:

```
https://github.com/workos/authkit-tanstack-start/blob/main/README.md
```

The README is the source of truth. If this skill conflicts, follow the README.

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
pnpm add @workos-inc/authkit-tanstack-start

# yarn
yarn add @workos-inc/authkit-tanstack-start

# npm
npm install @workos-inc/authkit-tanstack-start
```

**WAIT** for installation to complete.

**VERIFY**: Check `node_modules/@workos-inc/authkit-tanstack-start` exists

TaskUpdate: { taskId: "install", status: "completed" }

[STATUS] SDK installed

## Phase 3: Create Callback Route

TaskUpdate: { taskId: "callback", status: "in_progress" }

### 3.1 Determine Route Path

Read `WORKOS_REDIRECT_URI` from `.env`.
Extract path (e.g., `http://localhost:3000/auth/callback` → `/auth/callback`)

### 3.2 Create Callback Route

TanStack Start uses file-based routing. Create route file at matching path.

For `/auth/callback`, create `app/routes/auth/callback.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { handleCallback } from '@workos-inc/authkit-tanstack-start';

export const Route = createFileRoute('/auth/callback')({
  loader: handleCallback,
  component: () => <div>Authenticating...</div>,
});
```

**DO NOT** write custom OAuth callback logic. Use `handleCallback`.

**VERIFY**: Route file exists at path matching `WORKOS_REDIRECT_URI`

TaskUpdate: { taskId: "callback", status: "completed" }

[STATUS] Callback route created

## Phase 4: Setup Auth Middleware

TaskUpdate: { taskId: "provider", status: "in_progress" }

### 4.1 Create Auth Server Functions

Create `app/lib/auth.ts`:

```typescript
import { createServerFn } from '@tanstack/start';
import { getUser, signOut as authSignOut } from '@workos-inc/authkit-tanstack-start';

export const getAuthUser = createServerFn('GET', async () => {
  return await getUser();
});

export const signOut = createServerFn('POST', async () => {
  await authSignOut();
});
```

### 4.2 Add Auth to Root Route

Edit `app/routes/__root.tsx`:

```typescript
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { getAuthUser } from '../lib/auth';

export const Route = createRootRoute({
  loader: async () => {
    const user = await getAuthUser();
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
import { createFileRoute } from '@tanstack/react-router';
import { getSignInUrl } from '@workos-inc/authkit-tanstack-start';
import { signOut } from '../lib/auth';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const { user } = Route.useRouteContext();

  if (!user) {
    return (
      <main>
        <h1>Welcome</h1>
        <a href={getSignInUrl()}>Sign In</a>
      </main>
    );
  }

  return (
    <main>
      <h1>Welcome, {user.firstName || user.email}</h1>
      <p>{user.email}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await signOut();
          window.location.href = '/';
        }}
      >
        <button type="submit">Sign Out</button>
      </form>
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

### "Module not found: @workos-inc/authkit-tanstack-start"

- **Cause**: SDK not installed before writing imports
- **Fix**: Run install command, verify `node_modules/@workos-inc/authkit-tanstack-start` exists

### "createServerFn is not a function"

- **Cause**: Wrong TanStack Start version or import
- **Fix**: Check `@tanstack/start` version, verify import path

### Route loader not executing

- **Cause**: Route file not in correct location
- **Fix**: TanStack uses file-based routing - file path must match URL path

### Auth user undefined in child routes

- **Cause**: Not accessing from route context
- **Fix**: Access via `Route.useRouteContext()` from root loader

### Server function errors

- **Cause**: Mixing client/server code incorrectly
- **Fix**: Server functions must be defined separately and imported

### Cookie errors

- **Cause**: `WORKOS_COOKIE_PASSWORD` missing or too short
- **Fix**: Add 32+ character password to `.env`
