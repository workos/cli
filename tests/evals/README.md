# Installer Evaluations

Automated evaluation framework for testing WorkOS AuthKit installer skills against realistic project scenarios.

## Quick Start

```bash
# Run all evaluations
pnpm eval

# Run specific framework
pnpm eval --framework=nextjs

# Run specific scenario
pnpm eval --framework=react --state=example-auth0
```

## Test Matrix

The framework tests 10 scenarios (5 frameworks × 2 project states):

| State           | Description                                          |
| --------------- | ---------------------------------------------------- |
| `example`       | Project with routes, components, custom config       |
| `example-auth0` | Project with Auth0 authentication already integrated |

| Framework        | Skill                         | Key Checks                                     |
| ---------------- | ----------------------------- | ---------------------------------------------- |
| `nextjs`         | workos-authkit-nextjs         | middleware.ts, callback route, AuthKitProvider |
| `react`          | workos-authkit-react          | AuthKitProvider, callback component, useAuth   |
| `react-router`   | workos-authkit-react-router   | Auth loader, protected routes                  |
| `tanstack-start` | workos-authkit-tanstack-start | Server functions, callback route               |
| `vanilla-js`     | workos-authkit-vanilla-js     | Auth script, callback page                     |

## CLI Options

```
--framework=<name>  Filter by framework
--state=<state>     Filter by project state
--verbose, -v       Show agent tool calls and detailed output
--debug             Extra verbose, preserve temp dirs on failure
--keep-on-fail      Don't cleanup temp directory when scenario fails
--retry=<n>         Number of retry attempts (default: 2)
--no-retry          Disable retries
--json              Output results as JSON
--help, -h          Show help
```

## Debugging Failures

### 1. Inspect the failure details

```bash
pnpm eval --framework=react --state=example-auth0 --verbose
```

### 2. Preserve the temp directory

```bash
pnpm eval --framework=react --state=example-auth0 --keep-on-fail
# Output will show: "Temp directory preserved: /tmp/eval-react-xxxxx"
```

### 3. Manually inspect the project state

```bash
cd /tmp/eval-react-xxxxx
ls -la
cat middleware.ts
```

### 4. Compare with previous runs

```bash
# List recent runs
pnpm eval:history

# Compare two runs
pnpm eval:compare 2024-01-15T10-30-00 2024-01-16T14-45-00
```

## Adding a New Fixture

1. Create directory: `tests/fixtures/{framework}/{state}/`

2. Add minimal project files:
   - `package.json` with dependencies
   - `tsconfig.json` (if TypeScript)
   - Framework config file
   - Basic app structure

3. Verify fixture works standalone:

   ```bash
   cd tests/fixtures/{framework}/{state}
   pnpm install
   pnpm build
   ```

4. Add scenario to `tests/evals/runner.ts` SCENARIOS array

## Adding/Modifying Graders

Graders live in `tests/evals/graders/{framework}.grader.ts`.

Each grader implements:

```typescript
interface Grader {
  grade(): Promise<GradeResult>;
}
```

Use the helper classes:

- `FileGrader` - Check file existence and content patterns
- `BuildGrader` - Run build commands and check exit codes

Example:

```typescript
const checks: GradeCheck[] = [];

// File must exist
checks.push(await this.fileGrader.checkFileExists('middleware.ts'));

// File must contain patterns
checks.push(
  ...(await this.fileGrader.checkFileContains('middleware.ts', ['@workos-inc/authkit', 'authkitMiddleware'])),
);

// Build must succeed
checks.push(await this.buildGrader.checkBuild());

return { passed: checks.every((c) => c.passed), checks };
```

## Results Storage

Results are saved to `tests/eval-results/`:

- Each run creates `{timestamp}.json`
- `latest.json` symlinks to most recent
- Use `pnpm eval:history` to list runs
- Use `pnpm eval:compare` to diff runs

## Troubleshooting

### "pnpm install failed"

The fixture's dependencies may have version conflicts. Check:

```bash
cd tests/fixtures/{framework}/{state}
pnpm install
```

### "Build failed" but files look correct

The agent may have created correct files but with syntax errors. Use `--keep-on-fail` to inspect:

```bash
pnpm eval --framework=nextjs --keep-on-fail
# Then run build manually in temp dir to see full error
```

### Flaky passes/failures

LLM responses vary. Use `--retry=3` for more attempts:

```bash
pnpm eval --retry=3
```

If a scenario is consistently flaky, check if the skill instructions are ambiguous.
