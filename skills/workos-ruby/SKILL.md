---
name: workos-ruby
description: Integrate WorkOS AuthKit with Ruby on Rails. Server-side auth with controllers and routes. Use when Gemfile exists with rails gem or config/routes.rb exists.
---

# WorkOS AuthKit for Ruby on Rails

## Step 1: Fetch SDK Documentation (BLOCKING)

**STOP — Do not proceed until this fetch is complete.**

```
WebFetch: https://raw.githubusercontent.com/workos/workos-ruby/main/README.md
```

The README is the **source of truth** for gem installation, API usage, and code patterns.
If this skill conflicts with the README, **follow the README**.

## Step 2: Pre-Flight Validation

### Confirm Rails Project Structure

```bash
ls config/routes.rb app/controllers/application_controller.rb Gemfile
```

All three must exist. If not, abort — this is not a Rails project.

### Check Rails Version

```bash
grep "gem ['\"]rails['\"]" Gemfile
```

Note the version constraint for compatibility awareness.

### Check Existing Auth

```bash
grep -r "workos\|devise\|omniauth" Gemfile app/controllers/ config/initializers/ 2>/dev/null || true
```

If WorkOS is already configured, note what exists and adapt rather than duplicate.

## Step 3: Install WorkOS Gem

Install the gem using Bundler:

```bash
bundle add workos
```

### Verify Installation

```bash
bundle show workos
```

Must output a path. If it fails, check `Gemfile` for the entry and run `bundle install`.

## Step 4: Install dotenv-rails (if needed)

Check if dotenv-rails is already in the Gemfile:

```bash
grep "dotenv" Gemfile
```

If NOT present, install it for `.env` support:

```bash
bundle add dotenv-rails --group development,test
```

## Step 5: Create WorkOS Initializer

Create `config/initializers/workos.rb`:

```ruby
# config/initializers/workos.rb
WorkOS.configure do |config|
  config.api_key = ENV.fetch("WORKOS_API_KEY")
  config.client_id = ENV.fetch("WORKOS_CLIENT_ID")
end
```

### Verify

```bash
cat config/initializers/workos.rb
```

## Step 6: Create Environment File

Create or update `.env` in the project root:

```
WORKOS_API_KEY=your_api_key_here
WORKOS_CLIENT_ID=your_client_id_here
WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback
```

**Important**: If `.env` already exists, append only missing variables — do not overwrite existing values.

If the environment variables were already provided (check if they have real values, not placeholder text), use those values.

### Verify

```bash
grep WORKOS .env
```

## Step 7: Create Auth Controller

Create `app/controllers/auth_controller.rb` following the patterns from the README:

```ruby
# app/controllers/auth_controller.rb
class AuthController < ApplicationController
  def login
    authorization_url = WorkOS::UserManagement.get_authorization_url(
      redirect_uri: ENV.fetch("WORKOS_REDIRECT_URI"),
      provider: "authkit"
    )
    redirect_to authorization_url, allow_other_host: true
  end

  def callback
    code = params[:code]

    auth_response = WorkOS::UserManagement.authenticate_with_code(
      code: code,
      ip_address: request.remote_ip,
      user_agent: request.user_agent
    )

    session[:user] = auth_response.user.to_json
    redirect_to root_path
  end

  def logout
    session.delete(:user)
    redirect_to root_path
  end
end
```

**IMPORTANT**: Cross-check the controller code with the README. The README is the source of truth for:
- Method names (`get_authorization_url`, `authenticate_with_code`)
- Parameter names and structure
- Response object shape

If the README shows different method signatures, **use the README version**.

### Verify

```bash
cat app/controllers/auth_controller.rb
```

## Step 8: Add Routes

Add authentication routes to `config/routes.rb`. Insert these inside the existing `Rails.application.routes.draw` block:

```ruby
get "/auth/login", to: "auth#login"
get "/auth/callback", to: "auth#callback"
get "/auth/logout", to: "auth#logout"
```

**Do not replace** the existing routes file. Insert the new routes alongside existing ones.

### Verify

```bash
grep -A 5 "auth" config/routes.rb
```

## Step 9: Add Current User Helper (Optional but Recommended)

If the project has `app/controllers/application_controller.rb`, add a helper method:

```ruby
# Add to ApplicationController
class ApplicationController < ActionController::Base
  helper_method :current_user

  private

  def current_user
    return nil unless session[:user]
    @current_user ||= JSON.parse(session[:user])
  end
end
```

**Only add the `current_user` method and `helper_method` declaration** — do not overwrite the entire file. Merge into the existing class.

## Step 10: Final Verification

### Check Routes Compile

```bash
bundle exec rails routes | grep auth
```

Expected output should show three routes: `/auth/login`, `/auth/callback`, `/auth/logout`.

### Check All Files Exist

```bash
ls config/initializers/workos.rb app/controllers/auth_controller.rb .env
```

### Check Gemfile Has WorkOS

```bash
grep workos Gemfile
```

## Error Recovery

### "uninitialized constant WorkOS"

**Cause**: Gem not loaded or initializer not created.
**Fix**:
1. Verify `bundle show workos` succeeds
2. Verify `config/initializers/workos.rb` exists and requires nothing extra (Rails auto-loads gems)
3. Run `bundle install` if gem is in Gemfile but not installed

### "Missing API key" or "WORKOS_API_KEY"

**Cause**: Environment variable not set or dotenv not loading.
**Fix**:
1. Verify `.env` file exists with `WORKOS_API_KEY`
2. Verify `dotenv-rails` gem is in Gemfile
3. For production, set env vars through your hosting provider instead of `.env`

### "NoMethodError" on WorkOS methods

**Cause**: SDK API may have changed — method names differ from what's in this skill.
**Fix**: Re-read the README (Step 1). Use the exact method names shown there.

### "RoutingError" for /auth/* paths

**Cause**: Routes not added or misspelled.
**Fix**:
1. Run `bundle exec rails routes | grep auth`
2. Verify routes are inside `Rails.application.routes.draw` block
3. Verify controller file is named `auth_controller.rb` (not `authentication_controller.rb`)

### Callback returns error from WorkOS

**Cause**: Redirect URI mismatch between WorkOS Dashboard and `.env`.
**Fix**: Ensure `WORKOS_REDIRECT_URI` in `.env` exactly matches the redirect URI configured in the WorkOS Dashboard.
