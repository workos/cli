---
name: workos-authkit-nextjs
description: Integrate WorkOS AuthKit with Next.js. Supports App Router (Next.js 13+). Requires server-side rendering.
---

# WorkOS AuthKit for Next.js

## Phase 1: Pre-Flight Checks

TaskUpdate: { taskId: "preflight", status: "in_progress" }

### 1.1 Verify Next.js Project

Check for Next.js markers:

- `next.config.js` or `next.config.mjs` exists
- `package.json` has `"next"` dependency

### 1.2 Fetch SDK Documentation

**REQUIRED**: Use WebFetch to read:

```
https://github.com/workos/authkit-nextjs/blob/main/README.md
```

The README is the source of truth. If this skill conflicts, follow the README.

### 1.3 Verify Environment Variables

Read `.env.local` and confirm:

- `WORKOS_API_KEY` (starts with `sk_`)
- `WORKOS_CLIENT_ID` (starts with `client_`)
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (valid URL)
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
pnpm add @workos-inc/authkit-nextjs

# yarn
yarn add @workos-inc/authkit-nextjs

# npm
npm install @workos-inc/authkit-nextjs
```

**WAIT** for installation to complete.

**VERIFY**: Check `node_modules/@workos-inc/authkit-nextjs` exists

TaskUpdate: { taskId: "install", status: "completed" }

[STATUS] SDK installed

## Phase 3: Create Callback Route

TaskUpdate: { taskId: "callback", status: "in_progress" }

### 3.1 Determine Route Path

Read `NEXT_PUBLIC_WORKOS_REDIRECT_URI` from `.env.local`.
Extract path:

- `http://localhost:3000/auth/callback` → create at `app/auth/callback/route.ts`
- `http://localhost:3000/callback` → create at `app/callback/route.ts`

### 3.2 Create Route File

Create `app/{path}/route.ts`:

```typescript
import { handleAuth } from '@workos-inc/authkit-nextjs';

export const GET = handleAuth();
```

**DO NOT** write custom OAuth callback logic. Use `handleAuth()`.

**VERIFY**: File exists and contains `handleAuth`

TaskUpdate: { taskId: "callback", status: "completed" }

[STATUS] Callback route created

## Phase 4: Setup Provider & Middleware

TaskUpdate: { taskId: "provider", status: "in_progress" }

### 4.1 Detect Next.js Version

Check `package.json` for Next.js version:

- **v16+**: Use proxy route pattern (no middleware.ts)
- **v13-15**: Use middleware.ts

### 4.2a For Next.js 16+: Create Proxy Route

Create `app/auth/[...proxy]/route.ts`:

```typescript
import { handleAuth } from '@workos-inc/authkit-nextjs';

export const GET = handleAuth();
export const POST = handleAuth();
```

### 4.2b For Next.js < 16: Create Middleware

Create `middleware.ts` at project root (NOT in `app/`):

```typescript
import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

export default authkitMiddleware();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 4.3 Add AuthKitProvider to Layout

Edit `app/layout.tsx`:

```typescript
import { AuthKitProvider } from '@workos-inc/authkit-nextjs';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthKitProvider>{children}</AuthKitProvider>
      </body>
    </html>
  );
}
```

**VERIFY**: `grep AuthKitProvider app/layout.tsx` finds match

TaskUpdate: { taskId: "provider", status: "completed" }

[STATUS] Provider and middleware configured

## Phase 5: UI Integration & Verification

TaskUpdate: { taskId: "ui", status: "in_progress" }

### 5.1 Update Home Page

Edit `app/page.tsx`:

```typescript
import { getUser, getSignInUrl, signOut } from '@workos-inc/authkit-nextjs';

export default async function Home() {
  const { user } = await getUser();

  if (!user) {
    const signInUrl = await getSignInUrl();
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
      <form action={async () => {
        'use server';
        await signOut();
      }}>
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

## Error Recovery (Next.js Specific)

### "middleware.ts not found" errors

- **Cause**: Middleware at wrong path
- **Fix**: Must be at project root or `src/middleware.ts`, NOT in `app/`

### "Cannot use getUser in client component"

- **Cause**: Using server function in client component
- **Fix**: Add `'use server'` or fetch via API route

### NEXT*PUBLIC* prefix issues

- **Cause**: Using wrong env var prefix
- **Fix**: Client-side needs `NEXT_PUBLIC_*`, server-side uses plain names

### "Module not found: @workos-inc/authkit-nextjs"

- **Cause**: SDK not installed before writing imports
- **Fix**: Run install command, verify `node_modules/@workos-inc/authkit-nextjs` exists

### Build fails after adding AuthKitProvider

- **Cause**: Missing client directive or wrong import path
- **Fix**: Check SDK README for correct import (may be `/components` or `/client`)
