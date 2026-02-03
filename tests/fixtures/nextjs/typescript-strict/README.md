# Next.js - TypeScript Strict Fixture

## Edge Case Description

This fixture has the strictest TypeScript configuration possible. It tests whether the agent generates fully type-safe code that passes strict checks.

## Expected Agent Behavior

- Generate code with explicit return types
- Use proper type annotations (no implicit any)
- Handle null/undefined properly with strictNullChecks
- Not introduce unused variables or parameters

## Files of Interest

- `tsconfig.json` - Has all strict flags enabled including exactOptionalPropertyTypes and noUncheckedIndexedAccess
- All `.tsx` files - Have explicit return types that agent must maintain pattern

## Success Criteria

- [ ] `pnpm build` passes with zero type errors
- [ ] Generated middleware.ts has proper types
- [ ] Generated callback route has proper types
- [ ] No implicit any errors
- [ ] No unused variable/parameter errors

## Notes

This is critical for enterprise codebases that enforce strict TypeScript. Agent-generated code must not break the build.
