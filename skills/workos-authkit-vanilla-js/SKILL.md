---
name: workos-authkit-vanilla-js
description: Integrate WorkOS AuthKit with vanilla JavaScript applications. No framework required, browser-only. Use when project is plain HTML/JS, doesn't use React/Vue/etc, or mentions vanilla JavaScript authentication.
---

# WorkOS AuthKit for Vanilla JavaScript

## Phase 1: Pre-Flight Checks

TaskUpdate: { taskId: "preflight", status: "in_progress" }

### 1.1 Verify Vanilla JS Project

Check for vanilla JS markers:

- Has `index.html` file
- No React, Vue, Angular, etc. in `package.json` (if exists)
- JavaScript files use standard DOM APIs

### 1.2 Fetch SDK Documentation

**REQUIRED**: Use WebFetch to read:

```
https://github.com/workos/authkit-js/blob/main/README.md
```

The README is the source of truth. If this skill conflicts, follow the README.

### 1.3 Detect Project Type

Check for:

- **Bundled**: Has `package.json` with build tool (Vite, webpack, etc.)
- **CDN/Static**: Plain HTML files with script tags

### 1.4 Verify Environment Variables / Config

For bundled projects, check `.env`:

- `VITE_WORKOS_CLIENT_ID` or equivalent for build tool

For CDN/static projects, ensure Client ID will be provided in script.

Note: No `WORKOS_API_KEY` needed - client-side only SDK.

### 1.5 Create Tasks

Create all tasks per base template, then:
TaskUpdate: { taskId: "preflight", status: "completed" }

[STATUS] Pre-flight checks passed

## Phase 2: Install SDK

TaskUpdate: { taskId: "install", status: "in_progress" }

### 2.1 For Bundled Projects (npm/pnpm/yarn)

```bash
# pnpm
pnpm add @workos-inc/authkit-js

# yarn
yarn add @workos-inc/authkit-js

# npm
npm install @workos-inc/authkit-js
```

**WAIT** for installation to complete.

**VERIFY**: Check `node_modules/@workos-inc/authkit-js` exists

### 2.2 For CDN/Static Projects

Add to `index.html` in `<head>`:

```html
<script src="https://unpkg.com/@workos-inc/authkit-js"></script>
```

**VERIFY**: Script tag added to HTML file

TaskUpdate: { taskId: "install", status: "completed" }

[STATUS] SDK added to project

## Phase 3: Callback Route (Client-Side Handled)

TaskUpdate: { taskId: "callback", status: "in_progress" }

The AuthKit JS SDK handles OAuth callbacks **internally**.

**No server-side callback route needed.**

The SDK intercepts the redirect URI and handles token exchange client-side.

For SPAs/static sites, the redirect URI should point to your main page (e.g., `http://localhost:3000/`).

**VERIFY**: Redirect URI configured in WorkOS Dashboard matches your app URL

TaskUpdate: { taskId: "callback", status: "completed" }

[STATUS] Callback handling configured (SDK internal)

## Phase 4: Initialize AuthKit Client

TaskUpdate: { taskId: "provider", status: "in_progress" }

### 4.1 For Bundled Projects

Create `src/auth.js` or `src/auth.ts`:

```javascript
import { createAuthKit } from '@workos-inc/authkit-js';

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID; // adjust for your build tool

export const authkit = createAuthKit({
  clientId,
});

// Initialize on page load
authkit.init();
```

Import in your main entry:

```javascript
import { authkit } from './auth';
```

### 4.2 For CDN/Static Projects

Add to your main `<script>`:

```html
<script>
  const authkit = WorkOS.createAuthKit({
    clientId: 'your_client_id_here',
  });

  authkit.init();
</script>
```

**VERIFY**: AuthKit initialized in main script

TaskUpdate: { taskId: "provider", status: "completed" }

[STATUS] AuthKit client initialized

## Phase 5: UI Integration & Verification

TaskUpdate: { taskId: "ui", status: "in_progress" }

### 5.1 Add Auth Container to HTML

Add to `index.html`:

```html
<div id="auth-container">
  <div id="auth-loading">Loading...</div>
  <div id="auth-signed-out" style="display: none;">
    <h1>Welcome</h1>
    <button id="sign-in-btn">Sign In</button>
  </div>
  <div id="auth-signed-in" style="display: none;">
    <h1>Welcome, <span id="user-name"></span></h1>
    <p id="user-email"></p>
    <button id="sign-out-btn">Sign Out</button>
  </div>
</div>
```

### 5.2 Add Auth Logic

```javascript
// For bundled projects
import { authkit } from './auth';

// Or for CDN, use the global authkit variable

async function updateAuthUI() {
  const user = await authkit.getUser();

  document.getElementById('auth-loading').style.display = 'none';

  if (!user) {
    document.getElementById('auth-signed-out').style.display = 'block';
    document.getElementById('auth-signed-in').style.display = 'none';
  } else {
    document.getElementById('auth-signed-out').style.display = 'none';
    document.getElementById('auth-signed-in').style.display = 'block';
    document.getElementById('user-name').textContent = user.firstName || user.email;
    document.getElementById('user-email').textContent = user.email;
  }
}

document.getElementById('sign-in-btn').addEventListener('click', () => {
  authkit.signIn();
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  await authkit.signOut();
  updateAuthUI();
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', updateAuthUI);
```

TaskUpdate: { taskId: "ui", status: "completed" }

[STATUS] Auth UI added

### 5.3 Verify (if bundled)

TaskUpdate: { taskId: "verify", status: "in_progress" }

For bundled projects, run build:

```bash
npm run build
```

For CDN/static projects, open in browser and check console for errors.

**VERIFY**: No console errors, auth UI displays correctly

TaskUpdate: { taskId: "verify", status: "completed" }

[STATUS] Integration complete

## Error Recovery (Vanilla JS Specific)

### "WorkOS is not defined"

- **Cause**: CDN script not loaded
- **Fix**: Add script tag to `<head>`, ensure it loads before your code

### "createAuthKit is not a function"

- **Cause**: Wrong import or SDK not installed
- **Fix**: For npm, verify import path; for CDN, use `WorkOS.createAuthKit`

### Auth state lost on refresh

- **Cause**: Token not persisted
- **Fix**: SDK handles via localStorage; check browser dev tools

### Sign in popup blocked

- **Cause**: Browser blocking popup
- **Fix**: `signIn()` must be called from user gesture (click handler)

### "clientId is required" error

- **Cause**: Client ID not provided or undefined
- **Fix**: Check env var prefix matches build tool, or hardcode for testing

### CORS errors

- **Cause**: Running from `file://` protocol
- **Fix**: Use local dev server (`npx serve`, `python -m http.server`, etc.)
