---
name: workos-authkit-tanstack-start
description: Integrate WorkOS AuthKit with TanStack Start applications. Full-stack TypeScript with server functions. Use when project uses TanStack Start, @tanstack/start, or vinxi.
---

# WorkOS AuthKit for TanStack Start

## Decision Tree

```
1. Fetch README (BLOCKING)
   ├── Extract package name from install command
   └── README is source of truth for ALL code patterns

2. Verify TanStack Start project
   ├── @tanstack/start or @tanstack/react-start in package.json
   └── app.config.ts exists (vinxi)

3. Follow README install/setup exactly
   └── Do not invent commands or patterns
```

## Fetch SDK Documentation (BLOCKING)

**STOP - Do not proceed until complete.**

WebFetch: `https://github.com/workos/authkit-tanstack-start/blob/main/README.md`

From README, extract:
1. Package name from install command (e.g., `pnpm add @workos/...`)
2. Use that exact name for all imports

**README overrides this skill if conflict.**

## Pre-Flight Checklist

- [ ] README fetched and package name extracted
- [ ] `@tanstack/start` or `@tanstack/react-start` in package.json
- [ ] `app.config.ts` exists
- [ ] Environment variables set (see below)

## Environment Variables

| Variable | Format | Required |
|----------|--------|----------|
| `WORKOS_API_KEY` | `sk_...` | Yes |
| `WORKOS_CLIENT_ID` | `client_...` | Yes |
| `WORKOS_REDIRECT_URI` | Full URL | Yes |
| `WORKOS_COOKIE_PASSWORD` | 32+ chars | Yes |

Generate password if missing: `openssl rand -base64 32`

## Middleware Configuration (CRITICAL)

**authkitMiddleware MUST be configured or auth will fail.**

Find file with `createRouter` (typically `app/router.tsx` or `app.tsx`).

### Verification Checklist

- [ ] `authkitMiddleware` imported from SDK package
- [ ] `middleware: [authkitMiddleware()]` in createRouter config
- [ ] Array syntax used: `[authkitMiddleware()]` not `authkitMiddleware()`

Verify: `grep "authkitMiddleware" app/router.tsx app.tsx src/router.tsx`

## Logout Route Pattern

Logout requires `signOut()` followed by redirect in a route loader. See README for exact implementation.

## Callback Route

Path must match `WORKOS_REDIRECT_URI`. If URI is `/api/auth/callback`:
- File: `app/routes/api/auth/callback.tsx`
- Use `handleAuth()` from SDK - do not write custom OAuth logic

## Error Recovery

### "AuthKit middleware is not configured"

**Cause:** `authkitMiddleware()` not added to router
**Fix:** Add `middleware: [authkitMiddleware()]` to createRouter config
**Verify:** `grep "authkitMiddleware" app/router.tsx app.tsx`

### "Module not found" for SDK

**Cause:** Wrong package name or not installed
**Fix:** Re-read README, extract correct package name, reinstall
**Verify:** `ls node_modules/` + package name from README

### Callback 404

**Cause:** Route path doesn't match WORKOS_REDIRECT_URI
**Fix:** File path must mirror URI path under `app/routes/`

### getAuth returns undefined

**Cause:** Middleware not configured
**Fix:** Same as "AuthKit middleware not configured" above

### "Cookie password too short"

**Cause:** WORKOS_COOKIE_PASSWORD < 32 chars
**Fix:** `openssl rand -base64 32`, update .env
