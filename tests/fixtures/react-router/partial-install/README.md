# React Router - Partial Install Fixture

## Edge Case Description

This fixture represents a React Router project where AuthKit was partially installed - the package is in dependencies but integration was never completed.

## Expected Agent Behavior

- Detect that @workos-inc/authkit-react-router is already installed
- Complete the integration by:
  - Adding AuthKitProvider to root.tsx
  - Creating callback route
  - Adding middleware if needed
- Should NOT reinstall the package

## Files of Interest

- `package.json` - Already has @workos-inc/authkit-react-router dependency
- `app/root.tsx` - Has commented-out import as signal of abandoned attempt

## Success Criteria

- [ ] AuthKitProvider wraps the app
- [ ] Callback route is created
- [ ] Build succeeds
- [ ] Package is not reinstalled

## Notes

Common scenario when developers start integration but don't finish.
