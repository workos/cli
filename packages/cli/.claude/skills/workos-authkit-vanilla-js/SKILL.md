---
name: workos-authkit-vanilla-js
description: Integrate WorkOS AuthKit with vanilla JavaScript applications. No framework required, browser-only. Use when project is plain HTML/JS, doesn't use React/Vue/etc, or mentions vanilla JavaScript authentication.
---

# WorkOS AuthKit for Vanilla JavaScript

First, read the shared patterns: [../workos-authkit-base/SKILL.md](../workos-authkit-base/SKILL.md)

## Quick Start

1. **Fetch SDK Documentation**
   Use WebFetch to read: https://github.com/workos/authkit-js/blob/main/README.md

2. **Install SDK**

   Via npm (if using bundler):
   ```bash
   npm install @workos-inc/authkit-js
   ```

   Via CDN (no build step):
   ```html
   <script src="https://unpkg.com/@workos-inc/authkit-js"></script>
   ```

## Integration Steps

### Initialize AuthKit

Initialize the AuthKit client with your Client ID.
Get the exact initialization code from the README.

### Callback Handling

The browser SDK handles OAuth callbacks internally.
No server-side route needed.

### Authentication Methods

Use the SDK's methods:
- `signIn()` - Trigger authentication
- `signOut()` - Clear session
- `getUser()` - Get current user

## UI Integration

Add to your HTML:

```html
<div id="auth-container">
  <!-- SDK will manage this -->
</div>
```

JavaScript:
- On page load, check auth status
- Show Sign In button if not authenticated
- Show user info + Sign Out if authenticated

## Status Reporting

- [STATUS] Reading SDK documentation
- [STATUS] Adding AuthKit JS to project
- [STATUS] Initializing AuthKit client
- [STATUS] Adding authentication UI
- [STATUS] Complete
