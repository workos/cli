---
name: workos-widgets-framework-nextjs
description: Next.js adapter for WorkOS Widgets. Creates a page/route, fetches token, and invokes widget skill.
---

# WorkOS Widgets Adapter: Next.js

## Goals

- Create a page/route at the provided path.
- Acquire a widgets access token and pass it to the widget component.
- Invoke `workos-widgets-user-management` to generate the widget component.
- Both the page and the component must be created.
- Verify the page/route file exists and is wired into routing (import + usage).

## Instructions

1) Detect router type (app or pages) and follow existing conventions.
2) Implement a page that obtains the access token:
   - Prefer existing AuthKit usage.
   - If AuthKit client token is used, obtain token client-side and pass down.
   - If server-side WorkOS SDK is used, call `workos.widgets.getToken` on the server and pass the token to the component.
3) Wire the page into routing if necessary (App Router: place file; Pages Router: add route file).
4) Call the `workos-widgets-user-management` skill to generate the component and import it into the page.

## Access Token Scope

Use scope: `widgets:users-table:manage`.
