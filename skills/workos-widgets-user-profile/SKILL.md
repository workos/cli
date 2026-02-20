---
name: workos-widgets-user-profile
description: Build the User Profile widget using @workos-inc/widgets API helpers and existing UI components.
---

# WorkOS Widgets: User Profile

## Inputs

You will receive:
- Component path (from the prompt)
- Data fetching style (react-query, swr, or fetch)
- Styling and component system preferences
- Access token strategy (token is provided to the component/page)

## Required Props

The widget component must accept:
- `accessToken` (string, required)

## Tasks

1) Create the User Profile widget component at the given path.
2) Use `@workos-inc/widgets/experimental/api/*` helpers and reuse exported model/types from `@workos-inc/widgets`.
3) Implement core behavior:
   - load current user profile (`me`)
   - display profile picture, full name, email
   - display connected OAuth accounts when available
   - list user sessions
   - revoke an individual session
   - revoke all other sessions while keeping the current session
   - provide edit profile action and submit profile updates when supported by the selected API helpers
4) Include explicit loading and error states.
5) Keep component names, props, and file organization aligned with project conventions.

## API Requirements (Strict)

- Discover and use available helper methods from the selected entrypoint; do not invent endpoints.
- Never hardcode API routes.
- Never call `fetch` directly.
- Reuse package types for user and oauth profile data. Do not recreate model types locally.
- Avoid payload assertions/type casts (for example `as { data: ... }`) when reading query/mutation responses; use the typed client response shape directly.
- After successful profile update, invalidate/refetch the profile query.
- After successful session revocation actions, invalidate/refetch sessions query data.

## Behavior Requirements (Strict)

- Show stable, readable fallback values for optional fields:
  - missing profile picture -> avatar fallback
  - missing OAuth profiles -> omit section cleanly
- Treat profile update as mutation-driven UI:
  - disable submit while pending
  - surface mutation failure in UI state
  - keep last known profile data visible if update fails
- Treat session revoke actions as mutation-driven UI:
  - disable duplicate revoke actions while pending
  - surface mutation failures in UI state
  - keep last known sessions visible if revoke fails
- Keep query/mutation hook state as source of truth for server data.
- Do not mirror query loading/error/data into reducer state.

## Edge Cases to Cover

- API not ready + loading state.
- Query error branch with retry/refetch path.
- Null/partial user data (name fields, profile picture, oauth profiles).
- Unknown OAuth provider keys in oauth profile map (render safe text fallback; do not crash).
- Profile update validation or server error.
- Concurrent submits (disable duplicate submissions).
- Sessions query error branch with retry/refetch path.
- No sessions, only current session, and mixed current/other sessions.
- Individual session revoke error.
- Revoke-all-other-sessions error.

## Important Notes

- Progress reporting:
  - Emit `[STATUS] <short step>` before each major phase.
  - Optionally emit a short reason only for major non-obvious decisions.
  - Keep status lines concise and avoid verbose internal reasoning.
- Use reducers only for local UI interaction state if needed (for example edit dialog open state).
- Avoid mutating existing user files beyond the required new page/route wiring and imports.
- Do not use emojis and avoid icons unless the existing design system already uses them for status UI.
