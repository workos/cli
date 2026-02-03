# Installer Evaluations

Automated evaluation framework for testing WorkOS AuthKit installer skills.

## Quick Start

```bash
# Run all evaluations
pnpm eval

# Run specific framework
pnpm eval --framework=nextjs

# Run with quality grading
pnpm eval --quality
```

## Success Criteria

The eval framework validates against these thresholds:

| Metric                  | Threshold |
| ----------------------- | --------- |
| First-attempt pass rate | ≥90%      |
| With-retry pass rate    | ≥95%      |

Use `--no-fail` to run without exit code validation.

## Test Matrix

**Scenarios: 24 total (5 frameworks × 4-5 states)**

| State                    | Description                       |
| ------------------------ | --------------------------------- |
| `example`                | Clean project, no existing auth   |
| `example-auth0`          | Project with Auth0 to migrate     |
| `partial-install`        | Half-completed AuthKit attempt    |
| `typescript-strict`      | Strict TypeScript configuration   |
| `conflicting-middleware` | Existing middleware to merge      |

| Framework        | Skill                         | Key Checks                                      |
| ---------------- | ----------------------------- | ----------------------------------------------- |
| `nextjs`         | workos-authkit-nextjs         | middleware.ts, callback route, AuthKitProvider  |
| `react`          | workos-authkit-react          | AuthKitProvider, callback component, useAuth    |
| `react-router`   | workos-authkit-react-router   | Auth loader, protected routes                   |
| `tanstack-start` | workos-authkit-tanstack-start | Server functions, callback route                |
| `vanilla-js`     | workos-authkit-vanilla-js     | Auth script, callback page                      |

## CLI Options

```
--framework=<name>  Filter by framework (nextjs, react, react-router, tanstack-start, vanilla-js)
--state=<state>     Filter by project state
--quality, -q       Enable LLM-based quality grading
--verbose, -v       Show agent output and tool calls
--debug             Extra verbose, preserve temp dirs on failure
--keep-on-fail      Don't cleanup temp directory when scenario fails
--retry=<n>         Retry attempts (default: 2)
--no-retry          Disable retries
--no-fail           Don't exit 1 on threshold failure
--sequential        Run scenarios sequentially (disable parallelism)
--no-dashboard      Disable live dashboard, use sequential logging
--json              Output as JSON
--help, -h          Show help
```

## Quality Grading

When enabled with `--quality`, passing scenarios are graded on:

| Dimension      | Description                         |
| -------------- | ----------------------------------- |
| Code Style     | Adherence to project conventions    |
| Minimalism     | Changes are focused, no extras      |
| Error Handling | Proper error handling and messages  |
| Idiomatic      | Follows framework best practices    |

Each dimension scored 1-5. See `quality-rubrics.ts` for detailed rubrics.

## Latency Metrics

Every run tracks:

- **TTFT**: Time to first token
- **Agent Thinking**: Time spent deliberating
- **Tool Execution**: Time in tool calls
- **Tokens/sec**: Output throughput

## Comparing Runs

```bash
# List recent runs
pnpm eval:history

# Show more runs
pnpm eval:history --limit=20

# Compare two runs
pnpm eval:diff 2024-01-15T10-30-00 2024-01-16T14-45-00

# Use 'latest' as alias for most recent run
pnpm eval:diff latest 2024-01-15T10-30-00
```

The diff command shows:

- Pass rate changes (first-attempt and with-retry)
- Skill version changes (with correlation analysis)
- Scenario regressions/improvements
- Latency changes (p50, p95)
- Quality score changes

### Correlation Analysis

When skill files change AND scenarios regress, the diff command highlights likely causes:

```
Likely Causes:
  ⚠ nextjs skill changed (03133745 → a1b2c3d4) and 2 scenario(s) regressed
```

## Results Storage

Results saved to `tests/eval-results/`:

- `{timestamp}.json` - Full results with metadata
- `latest.json` - Symlink to most recent

Each result file includes:

- Summary (pass rates, scenario counts)
- Per-scenario results with checks
- Latency metrics (TTFT, tool breakdown)
- Quality grades (if enabled)
- Metadata (skill versions, CLI version, model version)

Prune old results:

```bash
# Keep only 10 most recent (default)
pnpm eval:prune

# Keep specific number
pnpm eval:prune --keep=5
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

## Troubleshooting

### "Build failed" but files look correct

Use `--keep-on-fail` to preserve temp directory and inspect:

```bash
pnpm eval --framework=nextjs --keep-on-fail
cd /tmp/eval-nextjs-xxxxx && pnpm build
```

### Flaky passes/failures

Increase retries: `pnpm eval --retry=3`

If consistently flaky, check if skill instructions are ambiguous.

### Pass rate regression

1. Run `pnpm eval:diff latest <previous-run>`
2. Check "Likely Causes" section
3. Review skill file changes listed
4. If no skill changes, check for external factors (API changes, dependency updates)

### "pnpm install failed"

The fixture's dependencies may have version conflicts. Check:

```bash
cd tests/fixtures/{framework}/{state}
pnpm install
```

### High latency

Check the tool breakdown in the summary output to identify bottlenecks:

```
Tool Time Breakdown (total across all scenarios):
  Bash: 206.5s (27 calls)
  Read: 54.3s (14 calls)
  ...
```
