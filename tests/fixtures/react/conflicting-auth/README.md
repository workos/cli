# React SPA - Conflicting Auth Fixture

## Edge Case Description

This fixture has an existing custom AuthProvider with user preferences, roles, and localStorage-based session management. The agent must integrate AuthKit while preserving or migrating existing functionality.

## Expected Agent Behavior

- Detect existing auth implementation in `src/auth/AuthProvider.tsx`
- Integrate AuthKitProvider while handling:
  - Existing `useAuth` hook that components depend on
  - User preferences (theme, notifications)
  - Role-based access patterns
- Should NOT simply delete existing auth code without migration plan

## Files of Interest

- `src/auth/AuthProvider.tsx` - Full auth implementation with useAuth hook
- `src/main.tsx` - Uses AuthProvider to wrap app
- `src/App.tsx` - Uses useAuth for logout button
- `src/pages/Dashboard.tsx` - Uses useAuth for protected content

## Success Criteria

- [ ] AuthKit is integrated
- [ ] Existing useAuth consumers don't break
- [ ] User preferences pattern is preserved or migrated
- [ ] Build succeeds

## Notes

This is a realistic scenario - many apps have custom auth before adopting a third-party solution. The agent should recognize this and propose a migration strategy rather than simply replacing.

Ideal approaches:

1. Wrap existing AuthProvider with AuthKitProvider
2. Migrate user data from custom auth to AuthKit user profile
3. Create adapter that maps AuthKit user to existing User type
