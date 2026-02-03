# Vanilla JS - Conflicting Auth Fixture

## Edge Case Description

This fixture has an existing custom authentication module with localStorage-based session management, auth state listeners, and protected routes. The agent must integrate AuthKit while preserving or migrating this functionality.

## Expected Agent Behavior

- Detect existing auth implementation in `auth.js`
- Integrate AuthKit while handling:
  - Existing `onAuthStateChange` listeners
  - User preferences storage
  - Protected route patterns (`requireAuth`)
- Should NOT simply delete existing auth code without migration

## Files of Interest

- `auth.js` - Full auth module with login, logout, session management
- `main.js` - Uses auth for login form and UI updates
- `dashboard.js` - Uses `requireAuth` for page protection
- All HTML files - Reference auth status in nav

## Success Criteria

- [ ] AuthKit is integrated
- [ ] Existing auth state listeners still work
- [ ] Dashboard protection still works
- [ ] User preferences are migrated or preserved
- [ ] Build succeeds

## Notes

This is a realistic scenario - many vanilla JS apps have custom auth before adopting a third-party solution. The agent should recognize this and propose a migration strategy.

Ideal approaches:

1. Replace custom auth with AuthKit but preserve the listener pattern
2. Migrate user preferences to AuthKit user profile
3. Update requireAuth to use AuthKit session checking
