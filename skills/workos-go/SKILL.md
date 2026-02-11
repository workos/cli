---
name: workos-go
description: Integrate WorkOS AuthKit with Go applications. Supports Gin and stdlib net/http.
---

# WorkOS AuthKit for Go

## Step 1: Fetch SDK Documentation (BLOCKING)

**STOP. Do not proceed until complete.**

WebFetch: `https://github.com/workos/workos-go/blob/main/README.md`

The README is the source of truth for SDK API usage. If this skill conflicts with README, follow README.

## Step 2: Pre-Flight Validation

### Project Structure

- Confirm `go.mod` exists in the project root
- Confirm Go module is initialized (module path declared in `go.mod`)

### Environment Variables

Check `.env` for:

- `WORKOS_API_KEY` - starts with `sk_`
- `WORKOS_CLIENT_ID` - starts with `client_`
- `WORKOS_REDIRECT_URI` - valid callback URL (e.g., `http://localhost:8080/auth/callback`)

### Framework Detection

Read `go.mod` to detect web framework:

```
go.mod contains github.com/gin-gonic/gin?
  |
  +-- Yes --> Use Gin router patterns
  |
  +-- No  --> Use stdlib net/http patterns
```

## Step 3: Install SDK

Run:

```bash
go get github.com/workos/workos-go/v4
```

**Verify:** Check that `go.mod` now contains `github.com/workos/workos-go/v4`. Both `go.mod` and `go.sum` will be modified — this is expected.

## Step 4: Configure Authentication

### 4a: Create Auth Handler File

Create an auth handler file. Respect existing project structure:

- If `internal/` directory exists, create `internal/auth/handlers.go`
- If `handlers/` directory exists, create `handlers/auth.go`
- Otherwise, create `auth/handlers.go`

The file must:

- Declare a package matching the directory name
- Import `github.com/workos/workos-go/v4` packages as needed
- Read env vars with `os.Getenv("WORKOS_API_KEY")`, `os.Getenv("WORKOS_CLIENT_ID")`, `os.Getenv("WORKOS_REDIRECT_URI")`

### 4b: Implement Handlers

Implement these three handlers following the redirect-based auth flow from the README:

**Login handler** (`/auth/login`):

- Get the authorization URL from WorkOS using `usermanagement.GetAuthorizationURL()`
- Set `Provider` to the string `"authkit"` (it's a plain string, not a constant)
- Include `ClientID` and `RedirectURI` from env vars
- Redirect the user to the returned URL

**Callback handler** (`/auth/callback`):

- Extract the `code` query parameter from the redirect
- Call `usermanagement.AuthenticateWithCode()` with the code and `ClientID`
- Store user info in session/cookie (or return as JSON for API-first apps)
- Redirect to homepage or return user data

**Logout handler** (`/auth/logout`):

- Clear session data
- Redirect to homepage

**CRITICAL:** Use idiomatic Go error handling throughout:

```go
result, err := someFunction()
if err != nil {
    http.Error(w, "Error message", http.StatusInternalServerError)
    return
}
```

### 4c: Wire Handlers into Router

#### If using Gin:

```go
r := gin.Default()
r.GET("/auth/login", handleLogin)
r.GET("/auth/callback", handleCallback)
r.GET("/auth/logout", handleLogout)
```

#### If using stdlib net/http:

```go
http.HandleFunc("/auth/login", handleLogin)
http.HandleFunc("/auth/callback", handleCallback)
http.HandleFunc("/auth/logout", handleLogout)
```

Wire these routes into the existing router setup in `main.go` or wherever routes are defined. Do NOT replace existing routes — add alongside them.

### 4d: Initialize WorkOS Client

In the appropriate init location (package-level `init()` or `main()`), initialize the WorkOS client:

```go
import "github.com/workos/workos-go/v4/pkg/usermanagement"

func init() {
    usermanagement.SetAPIKey(os.Getenv("WORKOS_API_KEY"))
}
```

Follow the README for the exact initialization pattern — it may differ from above.

## Step 5: Environment Setup

The `.env` file should already contain the required variables (written by the installer). Verify it contains:

```
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
WORKOS_REDIRECT_URI=http://localhost:8080/auth/callback
```

**Note for production:** Go does not have a built-in .env convention. In production, set real OS environment variables. The `.env` file is for development only. If using a `.env` loader like `github.com/joho/godotenv`, the agent may install it and add `godotenv.Load()` to `main()`.

## Step 6: Verification

Run these commands. **Do not mark complete until all pass:**

```bash
# 1. Go module is tidy
go mod tidy

# 2. Build succeeds
go build ./...

# 3. Vet passes (catches common mistakes)
go vet ./...
```

If build fails:

- Check import paths match the SDK version in `go.mod`
- Ensure all new files have correct package declarations
- Run `go mod tidy` to resolve dependency issues

## Error Recovery

### "cannot find module providing package github.com/workos/workos-go/v4/..."

- Run `go mod tidy` to sync dependencies
- Check that `go get` completed successfully
- Verify the import path matches exactly (v4 suffix required)

### "undefined: usermanagement.SetAPIKey" or similar

- SDK API may have changed — refer to the fetched README
- Check the correct subpackage import path

### Build fails with type errors

- Ensure handler function signatures match the framework (Gin uses `*gin.Context`, stdlib uses `http.ResponseWriter, *http.Request`)
- Check that error return values are handled

### "package X is not in std"

- Run `go mod tidy` after adding new imports
- Ensure `go get` was run before writing import statements
