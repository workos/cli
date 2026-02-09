---
name: workos-python
description: Integrate WorkOS AuthKit with Python/Django. Server-side authentication with Django views and URL routing.
---

# WorkOS AuthKit for Python (Django)

## Step 1: Fetch SDK Documentation (BLOCKING)

**STOP. Do not proceed until complete.**

WebFetch: `https://raw.githubusercontent.com/workos/workos-python/main/README.md`

The README is the source of truth for SDK API usage. If this skill conflicts with README, follow README.

## Step 2: Pre-Flight Validation

### Project Structure

- Confirm `manage.py` exists (Django project root)
- Identify the Django settings module: look for `settings.py` or a `settings/` directory with `base.py`
- Identify the root `urls.py` (project-level URL configuration)
- If settings are split (`settings/base.py`, `settings/dev.py`, etc.), modify `base.py`

### Environment Variables

Check `.env` for:

- `WORKOS_API_KEY` - starts with `sk_`
- `WORKOS_CLIENT_ID` - starts with `client_`

Python/Django does NOT use `WORKOS_COOKIE_PASSWORD` or `WORKOS_REDIRECT_URI` as env vars. The redirect URI is passed directly in code.

### Package Manager Detection

```
uv.lock exists?                          → uv add
pyproject.toml has [tool.poetry]?        → poetry add
Pipfile exists?                          → pipenv install
requirements.txt exists?                 → pip install (+ append to requirements.txt)
else                                     → pip install
```

## Step 3: Install SDK

Install using the detected package manager:

```bash
# uv
uv add workos python-dotenv

# poetry
poetry add workos python-dotenv

# pipenv
pipenv install workos python-dotenv

# pip
pip install workos python-dotenv
```

If using `requirements.txt`, also append `workos` and `python-dotenv` to it (if not already listed).

**Verify installation:**

```bash
python -c "import workos; print('workos OK')"
python -c "import dotenv; print('dotenv OK')"
```

## Step 4: Configure Django Settings

Edit the project's `settings.py` (or `settings/base.py` if split):

1. Add imports at the top of the file (after existing imports):

```python
import os
from dotenv import load_dotenv

load_dotenv()
```

2. Add WorkOS configuration (at the bottom of settings, before any local settings import):

```python
# WorkOS AuthKit Configuration
WORKOS_API_KEY = os.environ.get('WORKOS_API_KEY', '')
WORKOS_CLIENT_ID = os.environ.get('WORKOS_CLIENT_ID', '')
```

3. Ensure session support is configured:
   - `'django.contrib.sessions'` must be in `INSTALLED_APPS`
   - `'django.contrib.sessions.middleware.SessionMiddleware'` must be in `MIDDLEWARE`
   - These are included by default in Django projects — verify they haven't been removed

**Do NOT remove or reorder existing settings.** Only add new entries.

## Step 5: Create Auth Views

Create an auth views file. Prefer adding to an existing app's `views.py`, or create a new `auth_views.py` in the main project directory.

Follow the exact patterns from the WorkOS Python SDK README for:

### Login View
- Import and initialize the WorkOS client
- Call the SDK's method to generate an authorization URL
- Pass `redirect_uri` pointing to your callback view (e.g., `http://localhost:8000/auth/callback`)
- Pass `client_id` from settings
- Redirect the user to the returned authorization URL

### Callback View
- Receive the `code` query parameter from the request
- Use the SDK to exchange the code for a user profile
- Store the user information in `request.session`
- Redirect to the home page

### Logout View
- Clear the Django session with `request.session.flush()`
- Redirect to the home page

**CRITICAL:** Use the SDK methods from the README. Do NOT manually construct OAuth URLs.

## Step 6: Configure URL Routing

Add URL patterns to the project's `urls.py`:

```python
from django.urls import path
from . import auth_views  # adjust import path as needed

urlpatterns = [
    # ... existing patterns ...
    path('auth/login/', auth_views.login_view, name='workos_login'),
    path('auth/callback/', auth_views.callback_view, name='workos_callback'),
    path('auth/logout/', auth_views.logout_view, name='workos_logout'),
]
```

Adjust the import path based on where you placed the auth views in Step 5.

## Step 7: UI Integration

Update the home page template (or create `templates/home.html`) to show authentication state:

```html
{% if request.session.user %}
  <p>Welcome, {{ request.session.user.email }}!</p>
  <a href="{% url 'workos_logout' %}">Log out</a>
{% else %}
  <a href="{% url 'workos_login' %}">Log in</a>
{% endif %}
```

If no home view exists, create a simple one that renders this template.

Ensure `TEMPLATES` in settings has `APP_DIRS: True` or the template directory is configured.

## Step 8: Verification Checklist (ALL MUST PASS)

Run these commands to confirm integration. **Do not mark complete until all pass:**

```bash
# 1. WorkOS SDK is importable
python -c "import workos; print('OK')"

# 2. python-dotenv is importable
python -c "import dotenv; print('OK')"

# 3. .env has credentials
python -c "
from dotenv import load_dotenv; import os; load_dotenv()
assert os.environ.get('WORKOS_API_KEY','').startswith('sk_'), 'WORKOS_API_KEY missing or invalid'
assert os.environ.get('WORKOS_CLIENT_ID','').startswith('client_'), 'WORKOS_CLIENT_ID missing or invalid'
print('Credentials OK')
"

# 4. Django check passes
python manage.py check
```

## Error Recovery

### "ModuleNotFoundError: No module named 'workos'"

- Verify the install command completed successfully
- If using a virtual environment, ensure it's activated
- Re-run the install command

### "ModuleNotFoundError: No module named 'dotenv'"

- Install: use detected package manager to install `python-dotenv`
- Import as `from dotenv import load_dotenv` (NOT `import dotenv`)

### Django check fails

- Run `python manage.py check` to see specific errors
- Common: missing migrations (`python manage.py migrate`), invalid URL patterns, missing template directories

### Callback returns error

- Verify redirect URI in code matches `http://localhost:8000/auth/callback/`
- Verify `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` are set in `.env`
- Check the authorization code is being exchanged correctly per SDK README

### Session not persisting

- Ensure `django.contrib.sessions` is in `INSTALLED_APPS`
- Ensure `SessionMiddleware` is in `MIDDLEWARE`
- Run `python manage.py migrate` if sessions table is missing

### "CSRF verification failed"

- Auth views that receive external redirects (callback) should be decorated with `@csrf_exempt`
- Or use `GET` method for callback (WorkOS redirects via GET)

### Virtual environment issues

- Check for `.venv/`, `venv/`, or poetry/pipenv managed environments
- If no venv detected, install globally but warn the user
