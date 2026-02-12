---
name: workos-widgets-framework-tanstack-start
description: TanStack Start adapter for WorkOS Widgets. Creates a route, fetches token, and invokes widget skill.
---

# WorkOS Widgets Adapter: TanStack Start

## Goals

- Create a route at the provided path.
- Acquire a widgets access token and pass it to the widget component.
- Invoke `workos-widgets-user-management` to generate the widget component.
- Both the page and the component must be created.
- Verify the page/route file exists and is wired into routing (import + usage).

## Instructions

1) Follow TanStack Start route/file conventions.
2) Prefer server loaders for token retrieval when present.
3) If AuthKit client access token is used, fetch token in the client component and pass it down.
4) Register the route if required by the app’s router setup.
5) Call `workos-widgets-user-management` to generate the component and import it into the route.

## Access Token Scope

Use scope: `widgets:users-table:manage`.
