# TanStack Start - Partial Install Fixture

## Edge Case Description

This fixture represents a TanStack Start project where AuthKit was partially installed - the package is in dependencies but integration was never completed.

## Expected Agent Behavior

- Detect that @workos-inc/authkit-react is already installed
- Complete the integration by:
  - Adding AuthKitProvider
  - Creating callback route
  - Setting up server functions for auth
- Should NOT reinstall the package

## Files of Interest

- `package.json` - Already has @workos-inc/authkit-react dependency
- `src/router.tsx` - Has commented-out import

## Success Criteria

- [ ] AuthKitProvider wraps the app
- [ ] Callback route is created
- [ ] Build succeeds
- [ ] Package is not reinstalled

## Notes

Common scenario when developers start integration but don't finish.
