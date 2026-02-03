# React SPA - TypeScript Strict Fixture

## Edge Case Description

This fixture has the strictest TypeScript configuration. It tests whether the agent generates fully type-safe code.

## Expected Agent Behavior

- Generate code with explicit return types
- Use proper type annotations
- Handle null/undefined properly
- Not introduce unused variables

## Files of Interest

- `tsconfig.json` - Has all strict flags including exactOptionalPropertyTypes and noUncheckedIndexedAccess
- All `.tsx` files - Have explicit return types

## Success Criteria

- [ ] `pnpm build` passes with zero type errors
- [ ] Generated code has proper types
- [ ] No implicit any errors
- [ ] No unused variable errors

## Notes

Critical for enterprise React apps with strict TypeScript.
