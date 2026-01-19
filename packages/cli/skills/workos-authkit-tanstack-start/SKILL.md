---
name: workos-authkit-tanstack-start
description: Integrate WorkOS AuthKit with TanStack Start applications. Full-stack TypeScript with server functions. Use when project uses TanStack Start, @tanstack/start, or vinxi.
---

# WorkOS AuthKit for TanStack Start

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-tanstack-start/blob/main/README.md

2. **Install SDK**
   ```bash
   npm install @workos-inc/authkit-tanstack-start
   ```

## Integration Steps

### Server Functions

TanStack Start uses server functions for auth operations.
Follow the README for setting up:

- Auth middleware
- Session handling
- User retrieval

### Callback Route

Create a route at the exact path matching `WORKOS_REDIRECT_URI`.
Use the SDK's handler - do NOT write custom callback logic.

### Route Protection

Use the SDK's auth utilities to protect routes.
Check authentication status in route loaders.

## UI Integration

Update your index route:

**Logged out:** Sign In button
**Logged in:** User display + Sign Out button

Use the SDK's provided functions for sign-in/out URLs.

## Status Reporting

- [STATUS] Reading SDK documentation
- [STATUS] Installing @workos-inc/authkit-tanstack-start
- [STATUS] Creating callback route
- [STATUS] Setting up auth middleware
- [STATUS] Adding authentication UI
- [STATUS] Complete
