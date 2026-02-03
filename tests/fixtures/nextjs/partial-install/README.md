# Next.js - Partial Install Fixture

## Edge Case Description

This fixture represents a project where AuthKit was partially installed - the package is in dependencies but integration was never completed. This tests the agent's ability to detect and complete abandoned installations.

## Expected Agent Behavior

- Detect that @workos-inc/authkit-nextjs is already installed
- Complete the integration by:
  - Adding AuthKitProvider to layout.tsx
  - Creating middleware.ts
  - Creating callback route
- Should NOT reinstall the package

## Files of Interest

- `package.json` - Already has @workos-inc/authkit-nextjs dependency
- `app/layout.tsx` - Has commented-out import as signal of abandoned attempt

## Success Criteria

- [ ] AuthKitProvider wraps the app in layout.tsx
- [ ] middleware.ts is created with authkitMiddleware
- [ ] Callback route is created at app/api/auth/callback/route.ts
- [ ] Build succeeds with no type errors
- [ ] Package is not reinstalled (already present)

## Notes

This is a common scenario when developers start integration but get interrupted or confused.
