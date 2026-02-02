# TanStack Start - Conflicting Middleware Fixture

## Edge Case Description

This fixture has existing server middleware using TanStack Start's server functions for rate limiting, request logging, and security headers. The agent must integrate AuthKit while preserving this custom middleware.

## Expected Agent Behavior

- Detect existing middleware in `src/middleware.server.ts`
- Integrate AuthKit while PRESERVING:
  - Rate limiting logic via server functions
  - Request logging
  - Security headers
  - Existing route loaders
- Compose AuthKit with existing server functions

## Files of Interest

- `src/middleware.server.ts` - Custom server functions for middleware
- `src/routes/dashboard.tsx` - Uses middleware in loader

## Success Criteria

- [ ] AuthKit is integrated
- [ ] Rate limiting still works
- [ ] Security headers still added
- [ ] Request logging still works
- [ ] Build succeeds

## Notes

TanStack Start uses server functions for server-side logic. The agent should compose AuthKit session management with existing patterns.
