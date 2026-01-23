---
name: workos-authkit-nextjs
description: Integrate WorkOS AuthKit with Next.js App Router (13+). Server-side rendering required.
---

# WorkOS AuthKit for Next.js

## Step 1: Fetch SDK Documentation (BLOCKING)

**STOP. Do not proceed until complete.**

WebFetch: `https://github.com/workos/authkit-nextjs/blob/main/README.md`

The README is the source of truth. If this skill conflicts with README, follow README.

## Step 2: Pre-Flight Validation

### Project Structure
- Confirm `next.config.js` or `next.config.mjs` exists
- Confirm `package.json` contains `"next"` dependency

### Environment Variables
Check `.env.local` for:
- `WORKOS_API_KEY` - starts with `sk_`
- `WORKOS_CLIENT_ID` - starts with `client_`
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI` - valid callback URL
- `WORKOS_COOKIE_PASSWORD` - 32+ characters

## Step 3: Install SDK

Detect package manager, install `@workos-inc/authkit-nextjs`.

**Verify:** `node_modules/@workos-inc/authkit-nextjs` exists before continuing.

## Step 4: Version Detection (Decision Tree)

Read Next.js version from `package.json`:

```
Next.js version?
  |
  +-- 16+ --> Create proxy.ts at project root
  |
  +-- 13-15 --> Create middleware.ts at project root
```

**Critical:** File MUST be at project root (or `src/` if using src directory). Never in `app/`.

Middleware/proxy code: See README for `authkitMiddleware()` export pattern.

## Step 5: Create Callback Route

Parse `NEXT_PUBLIC_WORKOS_REDIRECT_URI` to determine route path:

```
URI path          --> Route location
/auth/callback    --> app/auth/callback/route.ts
/callback         --> app/callback/route.ts
```

Use `handleAuth()` from SDK. Do not write custom OAuth logic.

## Step 6: Provider Setup

Wrap app in `AuthKitProvider` in `app/layout.tsx`. See README for import path.

## Step 7: UI Integration

Add auth UI to `app/page.tsx` using SDK functions. See README for `getUser`, `getSignInUrl`, `signOut` usage.

## Verification Checklist

Run these commands to confirm integration:

```bash
# Check middleware/proxy exists (one should match)
ls proxy.ts middleware.ts src/proxy.ts src/middleware.ts 2>/dev/null

# Check provider is wrapped
grep -l "AuthKitProvider" app/layout.tsx

# Check callback route exists
find app -name "route.ts" -path "*/callback/*"

# Build succeeds
npm run build
```

All checks must pass before marking complete.

## Error Recovery

### "middleware.ts not found"
- Check: File at project root or `src/`, not inside `app/`
- Check: Filename matches Next.js version (proxy.ts for 16+, middleware.ts for 13-15)

### "Cannot use getUser in client component"
- Check: Component has no `'use client'` directive, or
- Check: Move auth logic to server component/API route

### "Module not found: @workos-inc/authkit-nextjs"
- Check: SDK installed before writing imports
- Check: `node_modules/@workos-inc/authkit-nextjs` directory exists

### "withAuth route not covered by middleware"
- Check: Middleware/proxy file exists at correct location
- Check: Matcher config includes the route path

### Build fails after AuthKitProvider
- Check: README for correct import path (may be subpath export)
- Check: No client/server boundary violations

### NEXT_PUBLIC_ prefix issues
- Client components need `NEXT_PUBLIC_*` prefix
- Server components use plain env var names
