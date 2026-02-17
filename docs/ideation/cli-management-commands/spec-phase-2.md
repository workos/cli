# Implementation Spec: CLI Management Commands - Phase 2

**Contract**: ./contract.md
**Estimated Effort**: M

## Technical Approach

Phase 2 adds organization management commands using the WorkOS REST API directly (no SDK dependency — just `fetch`, matching the existing pattern in `workos-management.ts`). API key resolution from Phase 1's `api-key.ts` provides authentication. Output uses chalk for colored text and a simple table formatter for list output.

The WorkOS Organizations API is a standard REST CRUD API at `https://api.workos.com/organizations`. We'll create a thin API client module that can be extended for future resource types (users, connections) without duplicating fetch logic.

## Feedback Strategy

**Inner-loop command**: `pnpm test -- workos-api`

**Playground**: Test suite for API client logic (mocked fetch). CLI commands validated with `pnpm build && workos organization --help`.

**Why this approach**: API client is testable with mocked responses. Command wiring is validated by running the built CLI.

## File Changes

### New Files

| File Path                           | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `src/lib/workos-api.ts`             | Generic WorkOS API client (fetch wrapper with auth + error handling) |
| `src/lib/workos-api.spec.ts`        | Unit tests for API client                                            |
| `src/commands/organization.ts`      | Organization management commands (create, update, get, list, delete) |
| `src/commands/organization.spec.ts` | Unit tests for org commands                                          |
| `src/utils/table.ts`                | Simple terminal table formatter using chalk                          |

### Modified Files

| File Path    | Changes                                                       |
| ------------ | ------------------------------------------------------------- |
| `src/bin.ts` | Register `workos organization` command group with subcommands |

## Implementation Details

### WorkOS API Client

**Pattern to follow**: `src/lib/workos-management.ts` (for fetch + error handling pattern)

**Overview**: A generic, reusable API client for WorkOS REST APIs. Handles authentication (Bearer token with API key), JSON serialization, error parsing, and pagination.

```typescript
const DEFAULT_BASE_URL = 'https://api.workos.com';

export interface WorkOSRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  apiKey: string;
  baseUrl?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | undefined>;
}

export interface WorkOSListResponse<T> {
  data: T[];
  list_metadata: {
    before: string | null;
    after: string | null;
  };
}

export class WorkOSApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly errors?: Array<{ message: string }>,
  ) {
    super(message);
    this.name = 'WorkOSApiError';
  }
}

export async function workosRequest<T>(options: WorkOSRequestOptions): Promise<T>;
```

**Key decisions**:

- Generic `workosRequest<T>()` function — reusable for any WorkOS resource
- `WorkOSApiError` captures status code and WorkOS error codes for specific error messages
- Base URL defaults to `https://api.workos.com` but can be overridden via active environment's `endpoint` field
- Pagination follows WorkOS's cursor-based pattern (`before`/`after` in `list_metadata`)

**Implementation steps**:

1. Create `workosRequest()` — builds URL with query params, sets auth header, handles response
2. Parse error responses: WorkOS returns `{ message, code, errors }` on failure
3. Create typed `WorkOSListResponse<T>` for paginated endpoints
4. Export `WorkOSApiError` for command-level error handling

**Feedback loop**:

- **Playground**: Create `workos-api.spec.ts` with mocked fetch (use `vi.stubGlobal('fetch', ...)`)
- **Experiment**: Test GET/POST/PUT/DELETE, test error response parsing (401, 404, 422), test query param encoding
- **Check command**: `pnpm test -- workos-api`

### Organization Commands

**Pattern to follow**: Go CLI's `internal/cmd/organization.go` (for command structure), `src/commands/login.ts` (for TypeScript patterns)

**Overview**: Five subcommands under `workos organization`: create, update, get, list, delete. Matches the Go CLI's argument structure exactly.

```typescript
// Types matching WorkOS API response
interface OrganizationDomain {
  id: string;
  domain: string;
  state: 'verified' | 'pending';
}

interface Organization {
  id: string;
  name: string;
  domains: OrganizationDomain[];
  created_at: string;
  updated_at: string;
}

// workos organization create <name> [domain:state ...]
export async function runOrgCreate(name: string, domainArgs: string[], apiKey: string, baseUrl?: string): Promise<void>;

// workos organization update <org_id> <name> [domain] [state]
export async function runOrgUpdate(
  orgId: string,
  name: string,
  domain?: string,
  state?: string,
  apiKey: string,
  baseUrl?: string,
): Promise<void>;

// workos organization get <org_id>
export async function runOrgGet(orgId: string, apiKey: string, baseUrl?: string): Promise<void>;

// workos organization list [--domain] [--limit] [--before] [--after] [--order]
export async function runOrgList(options: OrgListOptions, apiKey: string, baseUrl?: string): Promise<void>;

// workos organization delete <org_id>
export async function runOrgDelete(orgId: string, apiKey: string, baseUrl?: string): Promise<void>;
```

**Key decisions**:

- `create` takes `[domain]:[state]` args after name, matching Go CLI exactly (default state: `verified`)
- `update` takes positional args: `<org_id> <name> [domain] [state]`, matching Go CLI's 2-4 args
- `get` outputs pretty-printed JSON (matching Go CLI's `PrintJson`)
- `list` outputs a table with columns: ID, Name, Domains (matching Go CLI's table)
- `list` shows cursor metadata below table (`Before: ..., After: ...`)
- `delete` outputs confirmation message
- All commands resolve API key via `resolveApiKey()` from Phase 1
- All commands resolve base URL via `resolveApiBaseUrl()` from Phase 1

**Implementation steps**:

1. Implement `runOrgCreate` — parse domain:state args, POST to `/organizations`
2. Implement `runOrgUpdate` — PUT to `/organizations/{id}` with name + optional domain data
3. Implement `runOrgGet` — GET `/organizations/{id}`, print JSON
4. Implement `runOrgList` — GET `/organizations` with query params, render table
5. Implement `runOrgDelete` — DELETE `/organizations/{id}`, print confirmation
6. Register in `bin.ts` as `yargs.command('organization', ...)` with subcommands

**Feedback loop**:

- **Playground**: Write unit tests with mocked API responses before implementing
- **Experiment**: Test create with 0, 1, and multiple domains. Test list with empty results, single page, pagination cursors. Test error cases (404 on get, 401 on bad key).
- **Check command**: `pnpm test -- organization`

### Table Formatter

**Overview**: A lightweight table formatter for terminal output, used by `list` commands. Uses chalk for coloring headers.

```typescript
export interface TableColumn {
  header: string;
  width?: number;
}

export function formatTable(columns: TableColumn[], rows: string[][]): string;
```

**Key decisions**:

- No external dependency — simple string padding with chalk for header coloring (yellow, matching Go CLI's lipgloss style)
- Fixed-width columns calculated from content or specified explicitly
- Separator line between header and data rows
- Returns string (caller prints it)

**Implementation steps**:

1. Calculate column widths from max content length or specified width
2. Render header row with chalk.yellow
3. Render separator line
4. Render data rows with padding
5. Return concatenated string

### bin.ts Registration

**Pattern to follow**: existing command registrations in `src/bin.ts`

**Overview**: Register the `workos organization` command group with five subcommands. All org commands require API key resolution (not OAuth auth — these use the environment's API key).

**Implementation steps**:

1. Add `organization` command with subcommands: `create`, `update`, `get`, `list`, `delete`
2. `create` takes `<name>` positional + variadic domain args
3. `update` takes `<org_id> <name>` positional + optional `[domain] [state]`
4. `get` takes `<org_id>` positional
5. `list` takes `--domain`, `--limit`, `--before`, `--after`, `--order` flags
6. `delete` takes `<org_id>` positional
7. All get shared `--api-key` and `--insecure-storage` options
8. Wrap handlers to resolve API key + base URL before calling command functions
9. No `withAuth()` wrapper — org commands use API key, not OAuth token

## API Design

### WorkOS Organizations API (consumed, not created)

| Method   | Path                 | Description         |
| -------- | -------------------- | ------------------- |
| `POST`   | `/organizations`     | Create organization |
| `GET`    | `/organizations/:id` | Get organization    |
| `PUT`    | `/organizations/:id` | Update organization |
| `GET`    | `/organizations`     | List organizations  |
| `DELETE` | `/organizations/:id` | Delete organization |

### Request/Response Examples

```typescript
// POST /organizations
// Request
{
  "name": "FooCorp",
  "domain_data": [
    { "domain": "foo-corp.com", "state": "verified" }
  ]
}

// Response (also GET /:id response)
{
  "id": "org_01EHZNVPK3SFK441A1RGBFSHRT",
  "name": "FooCorp",
  "domains": [
    {
      "id": "org_domain_01EHZNVPK3SFK441A1RGBFSHRT",
      "domain": "foo-corp.com",
      "state": "verified"
    }
  ],
  "created_at": "2021-06-25T19:07:33.155Z",
  "updated_at": "2021-06-25T19:07:33.155Z"
}

// GET /organizations?domains=foo-corp.com&limit=10&order=desc
// Response
{
  "data": [/* Organization[] */],
  "list_metadata": {
    "before": "org_01EHZNVPK3SFK441A1RGBFSHRT",
    "after": "org_01EHZNVPK3SFK441A1RGBFSHRU"
  }
}
```

## Testing Requirements

### Unit Tests

| Test File                           | Coverage                                                     |
| ----------------------------------- | ------------------------------------------------------------ |
| `src/lib/workos-api.spec.ts`        | Request building, auth headers, error parsing, pagination    |
| `src/commands/organization.spec.ts` | All 5 commands, domain parsing, table output, error handling |

**Key test cases**:

- API client sets correct Authorization header
- API client builds query params correctly for list operations
- API client parses WorkOS error responses (message, code, errors array)
- API client handles network errors gracefully
- `org create` parses `domain:state` correctly (default state: verified)
- `org create` handles multiple domains
- `org list` renders table with correct columns
- `org list` shows pagination cursors
- `org list` handles empty results
- `org get` prints formatted JSON
- `org delete` prints confirmation
- All commands fail with clear message when no API key available

## Error Handling

| Error Scenario              | Handling Strategy                                                           |
| --------------------------- | --------------------------------------------------------------------------- |
| No API key available        | Error: "No API key configured. Run `workos env add` or set WORKOS_API_KEY." |
| 401 Unauthorized            | Error: "Invalid API key. Check your environment configuration."             |
| 404 Not Found               | Error: "Organization not found: {org_id}"                                   |
| 422 Validation Error        | Error: display WorkOS validation error message directly                     |
| Network error               | Error: "Failed to connect to WorkOS API. Check your internet connection."   |
| Invalid domain:state format | Error: "Invalid domain format. Use domain:state (e.g., foo.com:verified)"   |

## Validation Commands

```bash
# Type checking
pnpm typecheck

# Unit tests
pnpm test

# Build
pnpm build

# Manual smoke test (requires valid API key)
node dist/bin.js organization --help
node dist/bin.js organization list --api-key sk_test_xxx
```

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
