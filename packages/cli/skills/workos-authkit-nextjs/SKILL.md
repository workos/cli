---
name: workos-authkit-nextjs
description: Integrate WorkOS AuthKit with Next.js applications. Supports App Router and Pages Router. Use when the project uses Next.js, next, or when user mentions Next.js authentication.
---

# WorkOS AuthKit for Next.js

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## CRITICAL: Follow Steps In Order

You MUST complete each step fully before moving to the next. Do NOT skip steps.

## Step 1: Fetch SDK Documentation

Use WebFetch to read: https://github.com/workos/authkit-nextjs/blob/main/README.md
The README is the source of truth - follow it exactly.

Report: [STATUS] Reading SDK documentation

## Step 2: Install SDK Package

**CRITICAL**: The package MUST be installed before writing any code that imports it.

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

**Verify installation**: Check that `node_modules/@workos-inc/authkit-nextjs` exists before proceeding.

## Step 3: Detect Router Type

- App Router: Has `app/` directory with `layout.tsx`
- Pages Router: Has `pages/` directory with `_app.tsx`

## Step 4: App Router Integration

Check Next.js version in package.json to determine which approach to use.

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

Report: [STATUS] Adding AuthKit provider to layout

## Pages Router Integration

### API Routes
Create `pages/api/auth/[...auth].ts` using the SDK's handler.

### Callback Route
Create `pages/callback.tsx` or use the API route pattern from the README.

### Session Access
Use `getUser()` in `getServerSideProps` for server-side user access.

## Step 5: UI Integration

Update the home page (`app/page.tsx`):

1. Import required functions:
   ```typescript
   import { getUser, getSignInUrl, signOut } from '@workos-inc/authkit-nextjs';
   ```

2. Get user in server component:
   ```typescript
   const user = await getUser();
   ```

3. Add UI logic:
   - **Logged out**: Show "Sign In" button that links to `await getSignInUrl()`
   - **Logged in**: Display user.firstName, user.email, and "Sign Out" form using `signOut()`

Follow the exact patterns from the SDK README.

Report: [STATUS] Adding authentication UI to home page

## Step 6: Verify Installation

Before reporting complete:
1. Check that all imports can resolve (no "module not found" errors)
2. Verify callback route exists at the path in WORKOS_REDIRECT_URI
3. Verify AuthKitProvider wraps the app in layout.tsx

Report: [STATUS] Integration complete
