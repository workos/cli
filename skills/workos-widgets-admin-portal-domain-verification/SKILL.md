---
name: workos-widgets-admin-portal-domain-verification
description: Build the Admin Portal Domain Verification widget using @workos-inc/widgets API helpers and existing UI components.
---

# WorkOS Widgets: Admin Portal Domain Verification

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

1) Create the Admin Portal Domain Verification widget component at the given path.
2) Use `@workos-inc/widgets/experimental/api/*` for API calls and reuse exported types from `@workos-inc/widgets`.
3) Implement core behavior:
   - list organization domains
   - add domain by generating/opening Admin Portal link with intent `domain_verification`
   - reverify a domain
   - delete a domain
4) Include explicit loading and error states.
5) Keep component names, props, and file organization aligned with project conventions.

## API Requirements (Strict)

- Discover and use the selected entrypoint helpers for:
  - listing organization domains
  - generating admin portal link
  - reverifying a domain
  - deleting a domain
- Never hardcode endpoints.
- Never call `fetch` directly.
- Avoid payload assertions/type casts for API responses. Rely on typed response shapes from the selected API helpers.
- Invalidate/refetch the domains query after successful reverify/delete operations.

## Behavior Requirements (Strict)

- Always render a clear empty state when there are no domains, with an "Add domain" action.
- Treat add/manage actions as mutation-driven flows and show pending state on action buttons.
- Open generated admin portal links in a new tab with `noopener,noreferrer`.
- Surface mutation failures in UI state; do not rely only on `console.error`.
- Keep the last known domains list visible when a mutation fails.
- Do not silently map unexpected server payloads to empty data; show an error branch for invalid/unexpected responses.

## Edge Cases to Cover

- Empty domains list.
- Query loading and query error.
- Mutation error for add domain link generation.
- Mutation error for reverify.
- Mutation error for delete.
- Concurrent mutation attempts (disable the relevant action while pending).
- Unknown domain verification states from backend (render safe fallback label instead of crashing).

## Important Notes

- Progress reporting:
  - Emit `[STATUS] <short step>` before each major phase.
  - Optionally emit a short reason only for major non-obvious decisions.
  - Keep status lines concise and avoid verbose internal reasoning.
- Use query/mutation hook state as the source of truth for server data.
- Do not mirror query loading/error/data into reducer state.
- If local reducer state is needed, use it only for local interaction state (for example selected row/action).
- Avoid mutating existing user files beyond the required new page/route wiring and imports.
- Do not use emojis and avoid icons unless the existing design system already uses them for status UI.
