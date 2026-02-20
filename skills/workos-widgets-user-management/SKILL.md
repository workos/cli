---
name: workos-widgets-user-management
description: Build the WorkOS User Management widget UI using @workos-inc/widgets API helpers and existing UI components.
---

# WorkOS Widgets: User Management

## Inputs

You will receive:
- Component path (from the prompt)
- Data fetching style (react-query, swr, or fetch)
- Styling and component system preferences
- Access token strategy (token is provided to the component)

## Required Props

The widget component must accept:
- `accessToken` (string, required)

## Tasks

1) Create the User Management widget component at the given path.
2) Use `@workos-inc/widgets/experimental/api/*` for API calls (members, roles, invites, updates, removals) and reuse model/types from `@workos-inc/widgets`.
3) Implement full CRUD:
   - list members
   - search members (server-side, with debounce)
   - filter by role (server-side)
   - invite user
   - edit roles
   - resend/revoke invite
   - remove member
4) Use the detected data fetching library:
   - react-query: queries + mutations
   - swr: SWR hooks + mutate
   - fetch: local state + useEffect
5) Prefer existing UI components. If shadcn is available, use shadcn components.
6) Keep component names and props consistent with the project's conventions.

## IMPORTANT NOTES

- If no design system exists, fall back to basic JSX + detected styling solution.
- When using plain fetch, build reusable hooks outside the component (e.g., `useMembers`) so the main component stays clean.
- Never call `fetch` directly; always use exported API functions from `@workos-inc/widgets/experimental/api/*` (e.g., `members()`, `roles()`).
- Use reducers for list state like members/roles to manage loading/error/data.
- Avoid payload assertions/type casts for API responses. Rely on typed response shapes from the selected API helpers.
- Assume `@workos-inc/widgets/experimental/api/*` exposes typed request helpers for the widget endpoints; discover them by reading the selected import surface.
