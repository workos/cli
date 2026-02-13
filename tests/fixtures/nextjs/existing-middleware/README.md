# Next.js 16 - Existing Middleware in src/ Fixture

## Edge Case Description

This fixture is a Next.js 16+ project using `src/` directory structure that already has a `src/middleware.ts` with a no-op passthrough and empty matcher. Since `middleware.ts` is deprecated in Next.js 16 (replaced by `proxy.ts`), and Next.js 16 throws error E900 if both files exist, the agent must delete the existing `src/middleware.ts` and create `src/proxy.ts` with the AuthKit config.

The `src/` directory placement is critical — the middleware/proxy file must be placed alongside the `app/` directory, not at the project root.

## Expected Agent Behavior

- Detect `src/app/` directory structure
- Detect existing `src/middleware.ts`
- Delete `src/middleware.ts` (deprecated in Next.js 16)
- Create `src/proxy.ts` with AuthKit middleware config (not at project root)
- Never leave both `middleware.ts` and `proxy.ts` in place

## Files of Interest

- `src/middleware.ts` - Deprecated no-op middleware that must be replaced with `src/proxy.ts`

## Success Criteria

- [ ] `src/proxy.ts` is created with AuthKit middleware
- [ ] `src/middleware.ts` is deleted
- [ ] Matcher covers application routes
- [ ] Build succeeds
