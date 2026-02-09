---
name: workos-kotlin
description: Integrate WorkOS AuthKit with Kotlin/Spring Boot. Backend authentication with Gradle.
---

# WorkOS AuthKit for Kotlin (Spring Boot)

## Step 1: Fetch SDK Documentation (BLOCKING)

**STOP. Do not proceed until complete.**

WebFetch: `https://raw.githubusercontent.com/workos/workos-kotlin/main/README.md`

The README is the source of truth. If this skill conflicts with README, follow README.

## Step 2: Pre-Flight Validation

### Project Structure

- Confirm `build.gradle.kts` exists (Kotlin DSL) or `build.gradle` (Groovy DSL)
- Confirm Spring Boot plugin is present (`org.springframework.boot`)
- Detect Gradle wrapper: check if `./gradlew` exists

### Gradle Wrapper

```bash
# If gradlew exists, ensure it's executable
if [ -f ./gradlew ]; then chmod +x ./gradlew; fi
```

Use `./gradlew` if wrapper exists, otherwise fall back to `gradle`.

### Environment Variables

Check `application.properties` or `application.yml` for:

- `workos.api-key` or `WORKOS_API_KEY`
- `workos.client-id` or `WORKOS_CLIENT_ID`

## Step 3: Install SDK

Add the WorkOS Kotlin SDK dependency to `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.workos:workos-kotlin:{version}")
    // ... existing dependencies
}
```

Check the README for the latest version number.

**Verify:** Run `./gradlew dependencies` or `gradle dependencies` to confirm the dependency resolves.

## Step 4: Configure Authentication

### 4a: Application Properties

Add WorkOS configuration to `src/main/resources/application.properties`:

```properties
workos.api-key=${WORKOS_API_KEY}
workos.client-id=${WORKOS_CLIENT_ID}
workos.redirect-uri=http://localhost:8080/auth/callback
```

Or if the project uses `application.yml`, add the equivalent YAML.

### 4b: Create WorkOS Configuration Bean

Create a configuration class that initializes the WorkOS client:

```kotlin
@Configuration
class WorkOSConfig {
    @Value("\${workos.api-key}")
    lateinit var apiKey: String

    @Bean
    fun workos(): WorkOS = WorkOS(apiKey)
}
```

Adapt based on the SDK README — the exact client initialization may vary.

### 4c: Create Auth Controller

Create a Spring `@RestController` with these endpoints:

1. **GET /auth/login** — Redirect user to WorkOS AuthKit hosted login
   - Use `workos.sso.getAuthorizationUrl()` or equivalent from README
   - Include `clientId`, `redirectUri`, and `provider: "authkit"` parameters

2. **GET /auth/callback** — Exchange authorization code for user profile
   - Extract `code` query parameter
   - Call `workos.sso.getProfileAndToken(code)` or equivalent
   - Store user session (use Spring's `HttpSession`)
   - Redirect to home page

3. **GET /auth/logout** — Clear session and redirect
   - Invalidate `HttpSession`
   - Redirect to home page or WorkOS logout URL

**Follow the README for exact API method names and parameters.**

## Step 5: Session Management

Use Spring's built-in `HttpSession` for session management:

- Store user profile in session after callback
- Check session in protected routes
- Clear session on logout

If Spring Security is already configured, integrate with the existing security filter chain rather than replacing it.

## Step 6: Verification

Run the build to verify everything compiles:

```bash
./gradlew build
```

**If build fails:**
- Check dependency resolution: `./gradlew dependencies | grep workos`
- Check for missing imports in the auth controller
- Verify application.properties syntax
- Gradle builds can be slow (30-60s) — be patient

### Checklist

- [ ] WorkOS SDK dependency in build.gradle.kts
- [ ] Application properties configured
- [ ] Auth controller with login, callback, logout endpoints
- [ ] Build succeeds (`./gradlew build`)

## Error Recovery

### Dependency resolution failure

- Check Maven Central is accessible
- Verify the artifact coordinates match README exactly
- Ensure `mavenCentral()` is in the `repositories` block of build.gradle.kts

### "Could not resolve com.workos:workos-kotlin"

- The package may use a different group ID — check README
- Ensure repositories block includes `mavenCentral()`

### Build fails with missing Spring Boot annotations

- Verify `org.springframework.boot` plugin is applied
- Check Spring Boot starter dependencies are present

### Gradle wrapper permission denied

- Run `chmod +x ./gradlew` before building
