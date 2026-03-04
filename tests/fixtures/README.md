# Eval Fixtures

Each framework directory contains one or more fixture states — minimal project setups that the eval runner copies into temp directories before running the installer agent.

## Fixture States

| State                    | Description                            | What it contains                                                                        |
| ------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `example`                | Clean starter app, no auth             | Basic app structure with framework boilerplate                                          |
| `example-auth0`          | App with Auth0 configured              | Same as example but with Auth0 SDK installed and configured                             |
| `partial-install`        | Half-completed AuthKit attempt         | WorkOS SDK in deps but incomplete integration (client initialized, some routes missing) |
| `conflicting-auth`       | Existing non-WorkOS auth to merge with | App has a working auth system that the skill must detect and work alongside             |
| `typescript-strict`      | Strict TypeScript configuration        | Same as example but with `strict: true`, `noImplicitAny`, `strictNullChecks` enabled    |
| `conflicting-middleware` | Existing middleware to merge           | Framework-specific middleware that AuthKit must compose with (frontend only)            |
| `existing-middleware`    | Pre-existing middleware file           | Middleware file already exists, skill must merge not overwrite (Next.js only)           |

## Requirements

Every fixture must:

1. **Install cleanly** — running the language's install command should exit 0
2. **Build/compile** — the app code must be syntactically valid (even if functionally incomplete for partial-install)
3. **Be minimal** — only what's needed to test the scenario, no extra dependencies
4. **Include non-auth routes** — at least one route (e.g., `/api/health`, `/`) so graders can verify the skill preserves existing functionality

## Per-Language Fixture Guidance

### Node.js (`node/`)

- **Manifest**: `package.json`
- **Install**: `pnpm install`
- **partial-install**: `@workos-inc/node` in package.json, WorkOS client initialized, login route incomplete (TODO), no callback route
- **conflicting-auth**: `passport` + `passport-local` with working form-based auth, express-session configured

### Python (`python/`)

- **Manifest**: `requirements.txt`
- **Install**: `pip install -r requirements.txt`
- **partial-install**: `workos` in requirements.txt, WorkOS client imported but no routes, commented-out login handler
- **conflicting-auth**: `flask-login` + `flask-bcrypt` with working LoginManager, @login_required on protected routes

### Ruby (`ruby/`)

- **Manifest**: `Gemfile`
- **Install**: `bundle install`
- **partial-install**: `workos` gem in Gemfile, `WorkOS.configure` in initializer, empty route handlers
- **conflicting-auth**: `warden` (Sinatra) or `devise` (Rails) with working session-based auth

### Go (`go/`)

- **Manifest**: `go.mod`
- **Install**: `go mod download`
- **partial-install**: `workos-go/v4` in go.mod, `SetAPIKey()` called, login handler returns 501, no callback handler
- **conflicting-auth**: Custom JWT middleware using `crypto/hmac`, `/login` returns JWT, protected `/dashboard`

### PHP (`php/`)

- **Manifest**: `composer.json`
- **Install**: `composer install --no-interaction`
- **partial-install**: `workos/workos-php` in composer.json, autoloader required, empty `login.php`
- **conflicting-auth**: Native PHP session auth (`$_SESSION`), form-based login, `session_destroy()` logout

### PHP-Laravel (`php-laravel/`)

- **Manifest**: `composer.json`
- **Install**: `composer install --no-interaction`
- **partial-install**: `workos/workos-php-laravel` in composer.json, config published but no middleware registered
- **conflicting-auth**: `laravel/breeze` scaffolded with auth controllers, routes, and views

### Kotlin (`kotlin/`)

- **Manifest**: `build.gradle.kts`
- **Install**: (resolved at build time by Gradle)
- **partial-install**: WorkOS SDK in dependencies, imported but no controller
- **conflicting-auth**: `spring-boot-starter-security` with SecurityFilterChain, form login configured

### Elixir (`elixir/`)

- **Manifest**: `mix.exs`
- **Install**: `mix deps.get`
- **partial-install**: `:workos` in deps, config set, empty AuthController with TODO
- **conflicting-auth**: `ueberauth` + `ueberauth_identity` with working auth pipeline, session handling via `put_session`

### .NET (`dotnet/`)

- **Manifest**: `*.csproj`
- **Install**: `dotnet restore`
- **Status**: Disabled — SDK is broken. Do not add new fixture states until SDK stabilizes.

## Frontend Frameworks

Frontend frameworks (nextjs, react, react-router, tanstack-start, vanilla-js, sveltekit) follow the same state conventions but also include framework-specific states like `conflicting-middleware` and `existing-middleware`. See the eval runner's `SCENARIOS` array in `tests/evals/runner.ts` for the full matrix.
