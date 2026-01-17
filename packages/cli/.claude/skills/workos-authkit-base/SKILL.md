---
name: workos-authkit-base
description: Shared patterns for WorkOS AuthKit integration. Provides authentication flow overview, UI component patterns, and testing guidance. Use as a foundation when integrating AuthKit with any framework.
---

# WorkOS AuthKit Base Patterns

This skill provides shared patterns for integrating WorkOS AuthKit. Framework-specific skills extend this with implementation details.

## Authentication Flow

1. User clicks "Sign In" → Redirect to WorkOS hosted login
2. User authenticates → WorkOS redirects to your callback URL
3. Callback handler exchanges code for session → Sets secure cookie
4. Subsequent requests include session cookie → Middleware validates

## Environment Variables

Your `.env.local` should contain:
- `WORKOS_API_KEY` - Server-side API key (sk_xxx)
- `WORKOS_CLIENT_ID` - Public client identifier
- `WORKOS_REDIRECT_URI` - OAuth callback URL
- `WORKOS_COOKIE_PASSWORD` - 32+ char secret for cookie encryption

## UI Patterns

### Sign In Button
Use the SDK's sign-in URL helper. Do NOT build OAuth URLs manually.

### User Display
When authenticated, show:
- User's name or email
- Sign out button using SDK's signOut function

### Protected Routes
Use SDK middleware/guards to protect routes. Do NOT manually check cookies.

## Testing Checklist

- [ ] Sign in flow completes without errors
- [ ] Session persists across page reloads
- [ ] Sign out clears session
- [ ] Protected routes redirect unauthenticated users
- [ ] Callback URL matches WORKOS_REDIRECT_URI exactly

## Common Mistakes to Avoid

1. **Custom OAuth code** - Use SDK handlers, not manual implementation
2. **Hardcoded URLs** - Use environment variables
3. **Missing cookie password** - Required for session encryption
4. **Wrong callback path** - Must match dashboard configuration exactly
