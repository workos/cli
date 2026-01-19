---
name: workos-authkit-nextjs
description: Integrate WorkOS AuthKit with Next.js applications. Supports App Router and Pages Router.
---

# WorkOS AuthKit for Next.js

## CRITICAL: Follow These Steps Exactly

## Step 1: Fetch SDK Documentation

Use WebFetch to read: https://github.com/workos/authkit-nextjs/blob/main/README.md

The README is the source of truth. If anything in this skill conflicts with the README, follow the README.

Report: [STATUS] Reading SDK documentation

## Step 2: Install SDK

Detect package manager and install:
- `pnpm-lock.yaml` → `pnpm add @workos-inc/authkit-nextjs`
- `yarn.lock` → `yarn add @workos-inc/authkit-nextjs`
- `package-lock.json` → `npm install @workos-inc/authkit-nextjs`

Detect package manager (check for lock files):

- `package-lock.json` → use `npm install`
- `pnpm-lock.yaml` → use `pnpm add`
- `yarn.lock` → use `yarn add`

Run the install command:

```bash
npm install @workos-inc/authkit-nextjs
```

**Wait for installation to complete** - do not proceed until you see success output.

Report: [STATUS] Installing @workos-inc/authkit-nextjs

## Step 3: Create Callback Route

Read `.env.local` to find `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. The URL path determines the file path:
- URI `http://localhost:3000/auth/callback` → create `app/auth/callback/route.ts`
- URI `http://localhost:3000/callback` → create `app/callback/route.ts`

Create the callback route file:

```typescript
import { handleAuth } from '@workos-inc/authkit-nextjs';

export const GET = handleAuth();
```

### For Next.js 16+: Create Proxy Route

Create `app/auth/[...proxy]/route.ts` using the exact pattern from the SDK README.
Report: [STATUS] Creating auth proxy route

### For Next.js < 16: Create Middleware

Create `middleware.ts` at project root using the pattern from the SDK README.
Report: [STATUS] Creating middleware

### Callback Route

Create `app/callback/route.ts` at the exact path matching `WORKOS_REDIRECT_URI` (check .env.local).
Use the SDK's `handleAuth()` function - do NOT write custom callback logic.
Report: [STATUS] Creating callback route at /callback

### Layout Provider

Wrap the app with `<AuthKitProvider>` in `app/layout.tsx`:

- Import: `import { AuthKitProvider } from "@workos-inc/authkit-nextjs/client";`
- Wrap {children} with the provider

```typescript
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthKitProvider>{children}</AuthKitProvider>
      </body>
    </html>
  );
}
```

### API Routes

Create `pages/api/auth/[...auth].ts` using the SDK's handler.

### Callback Route

Create `pages/callback.tsx` or use the API route pattern from the README.

### Session Access

Use `getUser()` in `getServerSideProps` for server-side user access.

Update `app/page.tsx` with authentication UI:

```typescript
import { withAuth, getSignInUrl, signOut } from '@workos-inc/authkit-nextjs';

1. Import required functions:

   ```typescript
   import { getUser, getSignInUrl, signOut } from '@workos-inc/authkit-nextjs';
   ```

2. Get user in server component:

   ```typescript
   const user = await getUser();
   ```

  return (
    <main>
      <h1>Welcome, {user.firstName || user.email}!</h1>
      <p>{user.email}</p>
      <form action={async () => { 'use server'; await signOut(); }}>
        <button type="submit">Sign Out</button>
      </form>
    </main>
  );
}
```

Report: [STATUS] Adding authentication UI

## Step 7: Verify

## Step 6: Verify Installation

Before reporting complete:

1. Check that all imports can resolve (no "module not found" errors)
2. Verify callback route exists at the path in WORKOS_REDIRECT_URI
3. Verify AuthKitProvider wraps the app in layout.tsx

Report: [STATUS] Integration complete
