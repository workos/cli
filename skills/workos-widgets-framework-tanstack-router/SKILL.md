---
name: workos-widgets-framework-tanstack-router
description: TanStack Router adapter for WorkOS Widgets. Creates a route, fetches token, and invokes widget skill.
---

# WorkOS Widgets Adapter: TanStack Router

## Goals

- Create a route at the provided path.
- Acquire a widgets access token and pass it to the widget component.
- Invoke the widget skill specified in the installer prompt to generate the widget component.
- Both the page and the component must be created.
- Verify the page/route file exists and is wired into routing (import + usage).

## Instructions

1) Follow existing TanStack Router file/route conventions.
2) Prefer loader-based token retrieval when supported by the app.
3) If AuthKit client access token is used, fetch token in the client component and pass it down.
4) Add the route to router configuration if necessary.
5) Call the widget skill specified in the prompt to generate the component and import it into the route.

## Access Token Scope

Use the widget-specific scope guidance from the installer prompt and selected API methods.
