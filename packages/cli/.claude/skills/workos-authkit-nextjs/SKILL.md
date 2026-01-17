---
name: workos-authkit-nextjs
description: Integrate WorkOS AuthKit with Next.js applications. Supports App Router and Pages Router. Use when the project uses Next.js, next, or when user mentions Next.js authentication.
---

# WorkOS AuthKit for Next.js

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-nextjs/blob/main/README.md
   The README is the source of truth - follow it exactly.

2. **Install SDK**
   ```bash
   npm install @workos-inc/authkit-nextjs
   # or: pnpm add @workos-inc/authkit-nextjs
   ```

3. **Detect Router Type**
   - App Router: Has `app/` directory with `layout.tsx`
   - Pages Router: Has `pages/` directory with `_app.tsx`

## App Router Integration

### Middleware (Next.js < 16)
Create `middleware.ts` at project root using the pattern from the SDK README.

### Proxy Route (Next.js 16+)
Create `app/auth/[...proxy]/route.ts` using the pattern from the SDK README.

### Callback Route
Create `app/callback/route.ts` at the exact path matching `WORKOS_REDIRECT_URI`.
Use the SDK's `handleAuth()` function - do NOT write custom callback logic.

### Server Components
Use `getUser()` from the SDK to get the authenticated user in Server Components.

### Client Components
Use `useUser()` hook for client-side user access.

## Pages Router Integration

### API Routes
Create `pages/api/auth/[...auth].ts` using the SDK's handler.

### Callback Route
Create `pages/callback.tsx` or use the API route pattern from the README.

### Session Access
Use `getUser()` in `getServerSideProps` for server-side user access.

## UI Integration

Update the home page (`app/page.tsx` or `pages/index.tsx`):

**Logged out state:**
- Show "Sign In" button using `getSignInUrl()` from SDK

**Logged in state:**
- Display user name/email from `getUser()` result
- Show "Sign Out" button using `signOut()` from SDK

## Status Reporting

Report progress with `[STATUS]` prefix:
- [STATUS] Reading SDK documentation
- [STATUS] Installing @workos-inc/authkit-nextjs
- [STATUS] Creating callback route at /callback
- [STATUS] Setting up middleware/proxy
- [STATUS] Adding authentication UI
- [STATUS] Complete
