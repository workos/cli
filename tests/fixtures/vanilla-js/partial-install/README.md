# Vanilla JS - Partial Install Fixture

## Edge Case Description

This fixture represents a Vanilla JS project where AuthKit was partially installed - the package is in dependencies but integration was never completed.

## Expected Agent Behavior

- Detect that @workos-inc/authkit-js is already installed
- Complete the integration by:
  - Creating AuthKit client in main.js
  - Setting up login/logout buttons
  - Creating callback handler
- Should NOT reinstall the package

## Files of Interest

- `package.json` - Already has @workos-inc/authkit-js dependency
- `main.js` - Has commented-out import

## Success Criteria

- [ ] AuthKit client is created
- [ ] Login/logout functionality works
- [ ] Callback route is handled
- [ ] Build succeeds
- [ ] Package is not reinstalled

## Notes

Common scenario when developers start integration but don't finish.
