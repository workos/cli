# React Router - Conflicting Middleware Fixture

## Edge Case Description

This fixture has existing server middleware logic for rate limiting, request logging, and security headers. The agent must integrate AuthKit while preserving this custom middleware.

## Expected Agent Behavior

- Detect existing middleware in `app/middleware.server.ts`
- Integrate AuthKit while PRESERVING:
  - Rate limiting logic
  - Request logging
  - Security headers (X-App-Version, X-Content-Type-Options, etc.)
- Compose AuthKit with existing middleware, don't replace it

## Files of Interest

- `app/middleware.server.ts` - Custom middleware functions
- `app/routes/dashboard.tsx` - Uses middleware in loader

## Success Criteria

- [ ] AuthKit is integrated
- [ ] Rate limiting still works
- [ ] Security headers still added
- [ ] Request logging still works
- [ ] Build succeeds

## Notes

React Router v7 uses loaders for server-side logic. The agent should compose AuthKit session checking with existing middleware patterns.
