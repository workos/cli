---
name: workos-widgets-admin-portal-sso-connection
description: Build the AdminPortalSsoConnection widget using @workos-inc/widgets API helpers and existing UI components.
---

# WorkOS Widgets: AdminPortalSsoConnection

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

1) Create the AdminPortalSsoConnection widget component at the given path.
2) Use `@workos-inc/widgets/experimental/api/*` for API calls and reuse exported types from `@workos-inc/widgets`.
3) Implement the behavior shown in the reference:
   - load SSO connection status
   - derive states (`NotConfigured`, `Active`, `Inactive`, `Expiring`, `Expired`)
   - open admin portal link in a new tab for setup/management action
4) Include loading and error states with explicit components/branches.
5) Keep component names, props, and file organization aligned with project conventions.

## Status Logic Requirements (Strict)

- Follow the reference status semantics exactly.
- Cover all relevant backend states when deriving connection status:
  - treat `Active`, `Validating`, and `Deleting` as active-equivalent flow.
  - treat `Inactive` as inactive flow.
- Certificate-based status (`Expiring` / `Expired`) must be derived from certificate expiry fields (`notAfter`), not `notBefore`.
- Apply certificate-expiry logic only where appropriate for connection/provider type, matching the reference behavior.
- Do not introduce fallback mappings that change canonical meanings of statuses.

## Error Handling Requirements (Strict)

- Errors must be surfaced in UI state; do not rely on `console.error` as the only handling path.
- Handle both query and mutation failures with explicit user-visible error branches.
- Keep last known good data while mutation is pending or after mutation failure; do not reset state to `NotConfigured` unless a fresh server result indicates it.
- Preserve retry/refetch behavior via the selected API helper patterns.
- Do not mirror query loading/error/data into reducer state. Use query/mutation hook state as the server-state source of truth and keep reducer state limited to local UI workflow state only.

## Important Notes

- Never call `fetch` directly; always use exported API functions from `@workos-inc/widgets/experimental/api/*`.
- Use reducer-based state handling for complex loading/error/data flows.
- Avoid mutating existing user files beyond the required new page/route wiring and imports.
- Do not use emojis and avoid icons unless the existing design system already uses them for status UI.
