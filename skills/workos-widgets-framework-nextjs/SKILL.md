---
name: workos-widgets-framework-nextjs
description: Next.js adapter for WorkOS Widgets. Creates a page/route, fetches token, and invokes widget skill.
---

# WorkOS Widgets Adapter: Next.js

## Goals

- Create a page/route at the provided path.
- Acquire a widgets access token and pass it to the widget component.
- Invoke the widget skill specified in the installer prompt to generate the widget component.
- Both the page and the component must be created.
- Verify the page/route file exists and is wired into routing (import + usage).

## Instructions

1) Detect router type (app or pages) and follow existing conventions.
2) Implement a page that obtains the access token:
   - Prefer existing AuthKit usage.
   - If AuthKit client token is used, obtain token client-side and pass down.
   - If server-side WorkOS SDK is used, call `workos.widgets.getToken` on the server and pass the token to the component.
3) Wire the page into routing if necessary (App Router: place file; Pages Router: add route file).
4) Call the widget skill specified in the prompt to generate the component and import it into the page.
5) Do not add payload assertions/type casts for API responses in generated page/route code; rely on typed helper responses.

## Access Token Scope

Use the widget-specific scope guidance from the installer prompt and selected API methods.
