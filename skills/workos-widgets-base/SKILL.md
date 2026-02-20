---
name: workos-widgets-base
description: Shared guidance for WorkOS Widgets integrations (framework-agnostic).
---

# WorkOS Widgets Base

## Core Rules

- Ensure `@workos-inc/widgets` is installed at `>= 1.8.1` and prefer latest.
- Select the correct package entrypoint for the data fetching library:
  - fetch → `@workos-inc/widgets/experimental/api/fetch`
  - react-query → `@workos-inc/widgets/experimental/api/react-query`
  - swr → `@workos-inc/widgets/experimental/api/swr`
- Reuse model/types exported by `@workos-inc/widgets`. Do not recreate duplicated models in widget components.
- Widgets API host priority: `WORKOS_WIDGETS_API_URL` → `WORKOS_API_HOST` → `https://api.workos.com`.
- Prefer existing UI components in the codebase.
- If shadcn is detected and required components are missing, run the shadcn CLI to add them.
- Avoid global CSS. If styles are needed, use CSS Modules or the project's existing styling system.
- Keep changes minimal and aligned with existing conventions (naming, props, file layout).
- When handling complex states (loading, error, data), use a reducer per item to keep state updates predictable.
- Do not duplicate server query state into reducers. For react-query/swr/fetch-hooks, use hook state (`data`, `error`, loading flags, `refetch`) as the single source of truth for server data.
- Use reducers only for local interaction state that is not owned by the data-fetching library (for example dialog visibility, selected row ids, transient UI modes).
- Always create both the widget component and an example page/route that renders it.
- Never call `fetch` directly. Always use API helpers from `@workos-inc/widgets/experimental/api/{fetch|react-query|swr}`.
- Discover available API methods from the selected import surface and existing imports/usages; do not hardcode endpoints.
- Do not manually edit existing user code. Only add new files and wire up new routes/pages as needed.
- If the WorkOS backend SDK is required for token generation, create a `workos-sdk.ts` in the project root or `src/` with:
  - `export const workos = new WorkOS(process.env.WORKOS_API_KEY, { clientId: process.env.WORKOS_CLIENT_ID });`

## Access Tokens

Widgets require an access token. Prefer AuthKit client access token when available.
If server-side token generation is already used, call:

```
const token = await workos.widgets.getToken({
  userId,
  organizationId,
  scopes: ['widgets:users-table:manage'],
})
```

Tokens expire after one hour; reuse existing patterns in the app.

IMPORTANT: Make sure the `@workos-inc/node` package is installed when using it.

## IMPORTANT NOTES

- When using text inputs, add a debounce a perform the action when the user stops typing
- When using select, combobox, dropdown or similar components, perform the actions immediately upon selection
- Do not use emojis and avoid using icons whenever possible
- Prioritise using a Select when giving a list of options
- When setting a `value` prop to items from Select, Dropdown and similar, don't use an empty value.
