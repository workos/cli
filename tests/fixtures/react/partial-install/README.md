# React SPA - Partial Install Fixture

## Edge Case Description

This fixture represents a React SPA where AuthKit was partially installed - the package is in dependencies but integration was never completed.

## Expected Agent Behavior

- Detect that @workos-inc/authkit-react is already installed
- Complete the integration by:
  - Adding AuthKitProvider to main.tsx
  - Creating callback route
- Should NOT reinstall the package

## Files of Interest

- `package.json` - Already has @workos-inc/authkit-react dependency
- `src/main.tsx` - Has commented-out import as signal of abandoned attempt

## Success Criteria

- [ ] AuthKitProvider wraps the app in main.tsx
- [ ] Callback route is configured
- [ ] Build succeeds with no type errors
- [ ] Package is not reinstalled

## Notes

Common scenario when developers start integration but don't finish.
