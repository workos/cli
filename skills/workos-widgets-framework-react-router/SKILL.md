---
name: workos-widgets-framework-react-router
description: React Router adapter for WorkOS Widgets. Creates a route/page, fetches token, and invokes widget skill.
---

# WorkOS Widgets Adapter: React Router

## Goals

- Create a route/page at the provided path.
- Acquire a widgets access token and pass it to the widget component.
- Invoke the widget skill specified in the installer prompt to generate the widget component.
- Both the page and the component must be created.
- Verify the page/route file exists and is wired into routing (import + usage).

## Instructions

1) Follow existing React Router conventions (routes folder, route config, etc.).
2) If loaders/actions exist, prefer them for server-side token retrieval.
3) If AuthKit client access token is used, fetch token in the component and pass it down.
4) Add the route to the router configuration if needed.
5) Call the widget skill specified in the prompt to generate the component and import it into the page.
6) Do not add payload assertions/type casts for API responses in generated route code; rely on typed helper responses.

## Access Token Scope

Use the widget-specific scope guidance from the installer prompt and selected API methods.

## Progress Reporting

- Emit `[STATUS] <short step>` before each major phase (detect, create files, wire route, validate).
- Keep status lines concise and user-facing.
- Optionally emit a short reason only for major non-obvious decisions.
- Do not include verbose internal reasoning.
