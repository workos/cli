---
name: workos-ruby
description: Integrate WorkOS AuthKit with Ruby applications. Adapts to Rails, Sinatra, or vanilla Ruby. Server-side authentication with redirect-based OAuth flow.
---

# WorkOS AuthKit for Ruby

## Step 1: Fetch SDK Documentation (BLOCKING)

**STOP — Do not proceed until this fetch is complete.**

WebFetch: `https://raw.githubusercontent.com/workos/workos-ruby/main/README.md`

Also fetch the AuthKit quickstart for reference:
WebFetch: `https://workos.com/docs/authkit/vanilla/ruby`

The README is the **source of truth** for gem API usage. If this skill conflicts with the README, **follow the README**.

## Step 2: Detect Framework

Examine the project to determine which Ruby web framework is in use:

```
config/routes.rb exists?                 → Rails
  Gemfile has 'rails' gem?               → Confirmed Rails

Gemfile has 'sinatra' gem?               → Sinatra
  server.rb/app.rb has Sinatra routes?   → Confirmed Sinatra

None of the above?                       → Vanilla Ruby (use Sinatra quickstart pattern)
```

**Adapt all subsequent steps to the detected framework.** Do not force Rails on a Sinatra project or vice versa.

## Step 3: Install WorkOS Gem

```bash
bundle add workos
```

If `dotenv` is not in the Gemfile:

```bash
# Rails
bundle add dotenv-rails --group development,test

# Sinatra / other
bundle add dotenv
```

**Verify:** `bundle show workos`

## Step 4: Integrate Authentication

### If Rails

1. **Create initializer** — `config/initializers/workos.rb`:

   ```ruby
   WorkOS.configure do |config|
     config.api_key = ENV.fetch("WORKOS_API_KEY")
     config.client_id = ENV.fetch("WORKOS_CLIENT_ID")
   end
   ```

2. **Create AuthController** — `app/controllers/auth_controller.rb`:
   - `login` action: call `WorkOS::UserManagement.get_authorization_url(provider: "authkit", redirect_uri: ...)`, redirect
   - `callback` action: call `WorkOS::UserManagement.authenticate_with_code(code: params[:code])`, store user in session
   - `logout` action: clear session, redirect

3. **Add routes** to `config/routes.rb`:

   ```ruby
   get "/auth/login", to: "auth#login"
   get "/auth/callback", to: "auth#callback"
   get "/auth/logout", to: "auth#logout"
   ```

4. **Add current_user helper** to `ApplicationController` (optional):

   ```ruby
   helper_method :current_user
   def current_user
     @current_user ||= session[:user] && JSON.parse(session[:user])
   end
   ```

5. **Verify:** `bundle exec rails routes | grep auth`

### If Sinatra

Follow the quickstart pattern exactly:

1. **Configure WorkOS** in `server.rb`:

   ```ruby
   require "dotenv/load"
   require "workos"
   require "sinatra"

   WorkOS.configure do |config|
     config.key = ENV["WORKOS_API_KEY"]
   end
   ```

2. **Create `/login` route** — call `WorkOS::UserManagement.authorization_url(provider: "authkit", client_id: ..., redirect_uri: ...)`, redirect

3. **Create `/callback` route** — call `WorkOS::UserManagement.authenticate_with_code(client_id: ..., code: ...)`, store in session cookie

4. **Create `/logout` route** — clear session cookie, redirect

5. **Update home route** — read session, show user info if present

6. **Verify:** `ruby -c server.rb`

### If Vanilla Ruby (no framework detected)

Install Sinatra and follow the Sinatra pattern above. This matches the official quickstart.

## Step 5: Environment Setup

Create/update `.env` with WorkOS credentials. Do NOT overwrite existing values.

```
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
```

## Step 6: Verification

### Rails

```bash
bundle show workos
bundle exec rails routes | grep auth
grep WORKOS .env
```

### Sinatra

```bash
bundle show workos
ruby -c server.rb
grep WORKOS .env
```

## Error Recovery

### "uninitialized constant WorkOS"

Gem not loaded. Verify `bundle show workos` succeeds. For Rails, ensure initializer exists. For Sinatra, ensure `require "workos"` is at top of server file.

### "NoMethodError" on WorkOS methods

SDK API may differ from this skill. Re-read the README (Step 1) and use exact method names.

### Routes not working (Rails)

Run `bundle exec rails routes | grep auth`. Verify routes are inside `Rails.application.routes.draw` block.

### Session not persisting (Sinatra)

Enable sessions: `enable :sessions` in server.rb, or use `rack-session` gem.
