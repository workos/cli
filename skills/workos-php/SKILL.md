---
name: workos-php
description: Integrate WorkOS AuthKit with generic PHP applications. Uses the workos-php SDK directly with standalone auth endpoint files.
---

# WorkOS AuthKit for PHP

## Step 1: Fetch SDK Documentation (BLOCKING)

**STOP. Do not proceed until complete.**

WebFetch: `https://github.com/workos/workos-php/blob/main/README.md`

The README is the source of truth. If this skill conflicts with README, follow README.

## Step 2: Pre-Flight Validation

### Project Structure

- Confirm `composer.json` exists at project root
- If `composer.json` doesn't exist, create a minimal one with `composer init --no-interaction`

### Environment Variables

Check for `.env` file with:

- `WORKOS_API_KEY` - starts with `sk_`
- `WORKOS_CLIENT_ID` - starts with `client_`
- `WORKOS_REDIRECT_URI` - valid callback URL (e.g., `http://localhost:8000/callback.php`)

If `.env` doesn't exist, create it with the required variables.

## Step 3: Install SDK

```bash
composer require workos/workos-php
```

**Verify:** Check `composer.json` contains `workos/workos-php` in require section.

Also install a dotenv library if not present:

```bash
composer require vlucas/phpdotenv
```

## Step 4: Create Bootstrap File

Create a bootstrap or config file (e.g., `config.php` or `bootstrap.php`) that:

1. Requires Composer autoloader: `require_once __DIR__ . '/vendor/autoload.php';`
2. Loads `.env` using phpdotenv
3. Initializes the WorkOS SDK client with API key

Use SDK initialization from README. Do NOT hardcode credentials.

## Step 5: Create Auth Endpoint Files

### `login.php`

- Initialize WorkOS client (include bootstrap)
- Generate authorization URL using SDK
- Redirect user to WorkOS AuthKit

### `callback.php`

- Initialize WorkOS client (include bootstrap)
- Exchange authorization code from `$_GET['code']` for user profile using SDK
- Start session, store user data
- Redirect to home/dashboard

### `logout.php`

- Destroy session
- Redirect to home page

Use SDK methods from README for all WorkOS API calls. Do NOT construct OAuth URLs manually.

## Step 6: Create Home Page

Create or update `index.php` to show:

- Sign in link (`login.php`) when no session
- User info and sign out link (`logout.php`) when session exists

## Verification Checklist (ALL MUST PASS)

```bash
# 1. SDK installed
composer show workos/workos-php

# 2. Auth files exist
ls login.php callback.php logout.php

# 3. No syntax errors
php -l login.php
php -l callback.php
php -l logout.php
php -l index.php

# 4. Autoloader exists
ls vendor/autoload.php
```

## Error Recovery

### "Class WorkOS\WorkOS not found"

- Verify `composer require` completed successfully
- Check `vendor/autoload.php` is required in bootstrap
- Run `composer dump-autoload`

### Session issues

- Ensure `session_start()` is called before any session access
- Check PHP session configuration (`session.save_path`)

### Redirect URI mismatch

- Compare callback file path to `WORKOS_REDIRECT_URI` in `.env`
- URLs must match exactly (including trailing slash)

### Environment variables not loading

- Verify `.env` file exists in project root
- Verify phpdotenv is installed and loaded in bootstrap
- Check file permissions on `.env`
