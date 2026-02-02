# Next.js - Conflicting Middleware Fixture

## Edge Case Description

This fixture has existing middleware with rate limiting and custom header injection. The agent must MERGE AuthKit middleware with the existing logic, not replace it.

## Expected Agent Behavior

- Detect existing middleware.ts
- Integrate authkitMiddleware while PRESERVING:
  - Rate limiting logic
  - Custom header injection (X-App-Version, X-Request-Id, X-RateLimit-*)
  - Request logging
- Combine the matcher configurations appropriately

## Files of Interest

- `middleware.ts` - Has rate limiting, logging, and custom headers that MUST be preserved

## Success Criteria

- [ ] AuthKit middleware is integrated
- [ ] Rate limiting logic is preserved
- [ ] Custom headers (X-App-Version, X-Request-Id) still added
- [ ] Request logging still works
- [ ] Build succeeds

## Notes

This is a critical edge case. Many production apps have existing middleware for security, monitoring, or custom logic. The agent should compose middleware rather than overwrite.

Ideal solution patterns:
1. Chain middlewares: Call authkitMiddleware first, then apply custom logic
2. Wrap middlewares: Create a composed middleware function
3. Conditional routing: Apply different middleware based on path
