# WorkOS CLI Widgets - Local Testing Guide

This guide is for engineers testing `workos widgets` locally.

## 1) Prerequisites

- Node.js `>= 20.20`
- `pnpm` (repo uses `pnpm@10.x`)
- A test app (Next.js / React Router / TanStack Start / TanStack Router / Vite)
- WorkOS dashboard access for your test environment

## 2) Clone and run the CLI locally

```bash
git clone https://github.com/workos/cli.git
cd cli
git checkout feature/explore-widgets-skills
pnpm install
pnpm build
```

Run in dev/watch mode (this also links `workos` globally):

```bash
pnpm dev
```

In another terminal, verify:

```bash
workos --help
```

## 3) Auth for local CLI runs

Use one of the following:

### Option A: Standard WorkOS auth (recommended)

```bash
workos login
```

Then run installer normally from your test app.

### Option B: Direct Anthropic mode

Use your own Anthropic key and bypass llm-gateway:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
workos widgets --direct
```

## 4) Prepare the test app

From your test app root, ensure AuthKit is already configured (Widgets installer expects this).

If needed, install AuthKit first:

```bash
workos install
```

## 5) Run Widgets installer

From the test app root:

```bash
workos widgets
```

Pick the widget interactively when prompted by the CLI.

## 6) Dashboard setup and permissions per widget

### User Management (`user-management`)

- Required scope: `widgets:users-table:manage`
- Dashboard setup:
  - Verify permission slug exists: `widgets:users-table:manage`
  - Assign that permission to a role (for example `admin`)
  - Assign the role to the test user in the test organization

### User Profile (`user-profile`)

- Scope guidance: no special widget permission required
- Dashboard setup:
  - Ensure the test user can authenticate and access profile endpoints
  - Validate the widget shows current sessions and supports revoking sessions

### Admin Portal SSO Connection (`admin-portal-sso-connection`)

- Required scope: `widgets:sso:manage`
- Dashboard setup:
  - Create permission slug: `widgets:sso:manage`
  - Assign to admin-capable role
  - Assign that role to the test user in the target organization

### Admin Portal Domain Verification (`admin-portal-domain-verification`)

- Required scope: `widgets:domain-verification:manage`
- Dashboard setup:
  - Create permission slug: `widgets:domain-verification:manage`
  - Assign to admin-capable role
  - Assign that role to the test user in the target organization

## 7) What to verify after generation

For every widget run:

- Component file is created at requested/default path
- Page/route file is created (default behavior is both page + component)
- Route is wired and reachable
- `@workos-inc/widgets@latest` is installed/upgraded
- Generated code uses:
  - `@workos-inc/widgets/experimental/api/react-query` or
  - `@workos-inc/widgets/experimental/api/swr` or
  - `@workos-inc/widgets/experimental/api/fetch`
- Generated code does **not** use direct `fetch` or hardcoded API endpoints
- Generated code follows the app's existing styling solution and component library conventions
- Generated code follows existing app conventions (naming, file layout, props patterns, and route conventions)

## 8) Debugging

Run with debug logs:

```bash
workos widgets --debug
```

Check logs:

```bash
ls -t ~/.workos/logs | head
tail -f ~/.workos/logs/<latest-log-file>
```

## 9) Suggested test matrix

- Frameworks: Next.js, React Router, TanStack Start, TanStack Router, Vite
- Data fetching: React Query, SWR, fetch helpers
- Styling/component systems: Tailwind + Base UI, Tailwind + Radix, CSS Modules
- Widgets: all 4 current widgets
