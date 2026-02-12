---
name: workos-widgets-framework-vite
description: Vite adapter for WorkOS Widgets. Creates a page/component and wires routing if needed.
---

# WorkOS Widgets Adapter: Vite

## Goals

- Create a page at the provided path.
- Acquire a widgets access token and pass it to the widget component.
- Invoke `workos-widgets-user-management` to generate the widget component.
- Both the page and the component must be created.
- Verify the page file exists and is wired into routing (import + usage).

## Instructions

1) Detect the routing solution (React Router or custom).
2) If there is a router config, add the page route.
3) If no router exists, add a new route component and render it from the main app component.
4) Prefer AuthKit client access tokens when available; otherwise use server token if app uses backend SDKs.
5) Call `workos-widgets-user-management` to generate the component and import it into the page.

## Access Token Scope

Use scope: `widgets:users-table:manage`.
