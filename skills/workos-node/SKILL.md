---
name: workos-node
description: Integrate WorkOS AuthKit with Node.js/Express backend applications. Server-side authentication with redirect-based OAuth flow. Use when project has express in package.json without a frontend framework.
---

# WorkOS AuthKit for Node.js (Express)

## Decision Tree

```
1. Fetch README (BLOCKING)
   ├── Extract package name from install command
   └── README is source of truth for ALL code patterns

2. Detect project structure
   ├── TypeScript? (tsconfig.json present)
   │   ├── Yes → use .ts files, verify with tsc --noEmit
   │   └── No → use .js files, verify with node --check
   ├── Entry point location
   │   ├── src/index.ts or src/app.ts (modern TS setup)
   │   ├── app.js or server.js (classic CJS)
   │   └── index.js (minimal)
   └── ESM or CJS?
       ├── "type": "module" in package.json → ESM (import/export)
       └── else → CJS (require/module.exports)

3. Follow README install/setup exactly
   └── Do not invent commands or patterns
```

## Fetch SDK Documentation (BLOCKING)

**STOP - Do not proceed until complete.**

WebFetch: `https://raw.githubusercontent.com/workos/workos-node/main/README.md`

From README, extract:

1. Package name (expected: `@workos-inc/node`)
2. Install command
3. Client initialization pattern
4. API usage for User Management / AuthKit

**README overrides this skill if conflict.**

## Pre-Flight Checklist

- [ ] README fetched and package name extracted
- [ ] `package.json` exists with `express` dependency
- [ ] Identify entry point file (src/index.ts, src/app.ts, app.js, server.js, index.js)
- [ ] Detect TypeScript (tsconfig.json exists)
- [ ] Detect module system ("type": "module" → ESM, else CJS)
- [ ] Detect package manager (pnpm-lock.yaml → yarn.lock → bun.lockb → npm)
- [ ] Environment variables set or .env file prepared

## Environment Variables

| Variable                 | Format       | Required |
| ------------------------ | ------------ | -------- |
| `WORKOS_API_KEY`         | `sk_...`     | Yes      |
| `WORKOS_CLIENT_ID`       | `client_...` | Yes      |
| `WORKOS_REDIRECT_URI`    | Full URL     | Yes      |
| `WORKOS_COOKIE_PASSWORD` | 32+ chars    | Yes      |

Default redirect URI: `http://localhost:3000/auth/callback`

Generate cookie password if missing: `openssl rand -base64 32`

## Step 1: Install SDK

Detect package manager, then install:

```
pnpm-lock.yaml → pnpm add @workos-inc/node
yarn.lock      → yarn add @workos-inc/node
bun.lockb      → bun add @workos-inc/node
else           → npm install @workos-inc/node
```

### Verification

- [ ] `@workos-inc/node` in package.json dependencies
- [ ] No install errors in output

## Step 2: Initialize WorkOS Client

Create or update a WorkOS client module. Adapt to the project's module system:

**ESM / TypeScript:**

```typescript
import { WorkOS } from '@workos-inc/node';

const workos = new WorkOS(process.env.WORKOS_API_KEY);
const clientId = process.env.WORKOS_CLIENT_ID;
```

**CJS:**

```javascript
const { WorkOS } = require('@workos-inc/node');

const workos = new WorkOS(process.env.WORKOS_API_KEY);
const clientId = process.env.WORKOS_CLIENT_ID;
```

Place this where the Express app is initialized, or in a shared module that routes can import.

## Step 3: Create /auth/login Route

Redirects the user to WorkOS AuthKit for sign-in:

```typescript
app.get('/auth/login', (req, res) => {
  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    redirectUri: process.env.WORKOS_REDIRECT_URI,
    clientId,
  });

  res.redirect(authorizationUrl);
});
```

## Step 4: Create /auth/callback Route

Exchanges the authorization code for a user object:

```typescript
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code as string;

  try {
    const { user, accessToken, refreshToken } = await workos.userManagement.authenticateWithCode({
      code,
      clientId,
    });

    // Store user in session
    req.session.user = user;
    req.session.accessToken = accessToken;
    req.session.refreshToken = refreshToken;

    res.redirect('/');
  } catch (error) {
    res.redirect('/auth/login');
  }
});
```

**Key points:**

- Use `authenticateWithCode` — do not write custom OAuth logic
- Route path MUST match `WORKOS_REDIRECT_URI`
- Store tokens in session for subsequent requests

## Step 5: Create /auth/logout Route

```typescript
app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});
```

## Step 6: Configure Session Management

If `express-session` is not already installed, install it:

```
pnpm add express-session
# TypeScript projects also need:
pnpm add -D @types/express-session
```

Add session middleware **before** auth routes:

```typescript
import session from 'express-session';

app.use(session({
  secret: process.env.WORKOS_COOKIE_PASSWORD,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true },
}));
```

### Verification

- [ ] `express-session` in package.json dependencies
- [ ] Session middleware registered before routes
- [ ] Secret uses WORKOS_COOKIE_PASSWORD env var

## Step 7: Add Auth Middleware for Protected Routes (Optional)

```typescript
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

// Usage:
app.get('/dashboard', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});
```

## Step 8: Write .env File

Create `.env` if it doesn't exist. Do NOT overwrite existing values:

```
WORKOS_API_KEY=sk_test_...
WORKOS_CLIENT_ID=client_...
WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback
WORKOS_COOKIE_PASSWORD=<generate with openssl rand -base64 32>
```

Ensure `.env` is in `.gitignore`.

## Step 9: Verify Build

**TypeScript projects:**

```bash
npx tsc --noEmit
```

**JavaScript projects:**

```bash
node --check <entry-file>
```

### Final Verification Checklist

- [ ] SDK package installed (`@workos-inc/node` in node_modules)
- [ ] WorkOS client initialized with API key
- [ ] `/auth/login` route redirects to AuthKit
- [ ] `/auth/callback` route exchanges code for user
- [ ] `/auth/logout` route destroys session
- [ ] Session middleware configured before auth routes
- [ ] `.env` file has all required variables
- [ ] Build/syntax check passes with exit code 0

## Error Recovery

### Module not found: @workos-inc/node

**Cause:** SDK not installed or wrong package name
**Fix:** Re-run install command for detected package manager
**Verify:** `ls node_modules/@workos-inc/node`

### Session not persisting across requests

**Cause:** express-session middleware not configured or registered after routes
**Fix:** Ensure `app.use(session(...))` appears BEFORE route definitions
**Verify:** Check middleware order in entry point file

### Callback returns 404

**Cause:** Route path doesn't match WORKOS_REDIRECT_URI
**Fix:** Compare route path string to WORKOS_REDIRECT_URI env var — must match exactly
**Verify:** `grep -r "auth/callback" src/ app.js server.js index.js 2>/dev/null`

### authenticateWithCode fails

**Cause:** Invalid or expired code, or wrong clientId
**Fix:** Verify WORKOS_CLIENT_ID matches dashboard, ensure redirect URI matches exactly
**Verify:** Check WorkOS dashboard logs for error details

### Cookie password error

**Cause:** WORKOS_COOKIE_PASSWORD not set or < 32 chars
**Fix:** `openssl rand -base64 32`, update .env
**Verify:** `echo $WORKOS_COOKIE_PASSWORD | wc -c` (should be 33+)

### TypeScript compilation errors

**Cause:** Missing type definitions or import issues
**Fix:** Install `@types/express-session`, verify tsconfig includes source files
**Verify:** `npx tsc --noEmit` exits with code 0

### ESM/CJS mismatch

**Cause:** Using `import` in CJS project or `require` in ESM project
**Fix:** Check `"type"` field in package.json — `"module"` means ESM, absent means CJS
**Verify:** Match import style to module system

## Critical Rules

1. **Install SDK before writing imports** — never create import statements for uninstalled packages
2. **Use SDK functions** — never construct OAuth URLs manually
3. **Follow README patterns** — SDK APIs change between versions
4. **Match module system** — detect ESM vs CJS before writing any code
5. **Session before routes** — express-session middleware must be registered before auth routes
6. **Production note** — mention that in-memory sessions should be replaced with Redis/DB for production
