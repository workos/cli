import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Catalog } from './catalog.js';
import type { ApiResponse } from './request.js';

const mockCatalog: Catalog = {
  endpoints: [
    {
      method: 'GET',
      path: '/users',
      summary: 'List users',
      tag: 'Users',
      operationId: 'listUsers',
      pathParams: [],
      queryParams: [],
      hasRequestBody: false,
      requestBodyRequired: false,
    },
    {
      method: 'POST',
      path: '/organizations',
      summary: 'Create organization',
      tag: 'Organizations',
      operationId: 'createOrganization',
      pathParams: [],
      queryParams: [],
      hasRequestBody: true,
      requestBodyRequired: true,
    },
    {
      method: 'DELETE',
      path: '/users/{id}',
      summary: 'Delete user',
      tag: 'Users',
      operationId: 'deleteUser',
      pathParams: [{ name: 'id', description: '', required: true }],
      queryParams: [],
      hasRequestBody: false,
      requestBodyRequired: false,
    },
  ],
  tags: ['Organizations', 'Users'],
};

const mockApiRequest = vi.fn<(...args: unknown[]) => Promise<ApiResponse>>();

vi.mock('./catalog.js', async () => {
  const actual = await vi.importActual<typeof import('./catalog.js')>('./catalog.js');
  return {
    ...actual,
    loadCatalog: async () => mockCatalog,
  };
});

vi.mock('./request.js', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock('../../lib/api-key.js', () => ({
  resolveApiKey: vi.fn(() => 'sk_test'),
  resolveApiBaseUrl: vi.fn(() => 'https://api.example.com'),
}));

const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);
vi.mock('../../utils/clack.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
  },
}));

vi.mock('../../utils/environment.js', () => ({
  isNonInteractiveEnvironment: vi.fn(() => false),
}));

const { setOutputMode } = await import('../../utils/output.js');
const { isNonInteractiveEnvironment } = await import('../../utils/environment.js');
const { runApiInteractive, runApiLs, runApiRequest } = await import('./index.js');

function buildResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: 200,
    headers: new Headers(),
    body: { ok: true },
    rawBody: '{"ok":true}',
    ...overrides,
  };
}

describe('runApiInteractive', () => {
  let consoleOutput: string[];
  let stderrOutput: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    stderrOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderrOutput.push(args.map(String).join(' '));
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('human');
  });

  it('prints usage instructions when stdin/stdout is non-interactive', async () => {
    setOutputMode('human');
    vi.mocked(isNonInteractiveEnvironment).mockReturnValueOnce(true);
    await runApiInteractive();
    expect(consoleOutput.join('\n')).toContain('Interactive mode requires a TTY');
  });

  it('emits a structured tty_required error in JSON mode when non-interactive', async () => {
    setOutputMode('json');
    // JSON mode short-circuits before the TTY check, so the underlying environment doesn't matter.
    await expect(runApiInteractive()).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleOutput).toEqual([]);
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string } };
        return parsed.error?.code === 'tty_required';
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
  });

  it('refuses to enter interactive mode in JSON mode even when a TTY is present', async () => {
    setOutputMode('json');
    // Default mock returns false (TTY present); JSON mode must short-circuit
    // before isNonInteractiveEnvironment() is even called.
    await expect(runApiInteractive()).rejects.toThrow(/__exit__:1/);
    expect(isNonInteractiveEnvironment).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleOutput).toEqual([]);
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string } };
        return parsed.error?.code === 'tty_required';
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
  });
});

describe('runApiLs', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('human');
  });

  it('lists endpoints grouped by tag in human mode', async () => {
    setOutputMode('human');
    await runApiLs();
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('Users');
    expect(joined).toContain('/users');
    expect(joined).toContain('Organizations');
    expect(joined).toContain('/organizations');
  });

  it('filters endpoints by substring (path/tag/summary/operationId)', async () => {
    setOutputMode('human');
    await runApiLs('organization');
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('/organizations');
    expect(joined).not.toContain('/users');
  });

  it('prints a friendly message when no endpoint matches the filter', async () => {
    setOutputMode('human');
    await runApiLs('does-not-exist');
    expect(consoleOutput.some((l) => l.includes('No endpoints matching "does-not-exist"'))).toBe(true);
  });

  it('emits structured JSON in JSON mode', async () => {
    setOutputMode('json');
    await runApiLs('users');
    expect(consoleOutput).toHaveLength(1);
    const parsed = JSON.parse(consoleOutput[0]!);
    expect(parsed.data).toEqual([
      { method: 'GET', path: '/users', summary: 'List users', tag: 'Users' },
      { method: 'DELETE', path: '/users/{id}', summary: 'Delete user', tag: 'Users' },
    ]);
  });
});

describe('runApiRequest', () => {
  let consoleOutput: string[];
  let stderrOutput: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    stderrOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderrOutput.push(args.map(String).join(' '));
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 0}`);
    }) as never);
    mockConfirm.mockResolvedValue(true);
    mockIsCancel.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('human');
  });

  it('prints a human-readable dry-run preview without executing the request', async () => {
    setOutputMode('human');
    await runApiRequest('/users', { dryRun: true });
    expect(mockApiRequest).not.toHaveBeenCalled();
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('[dry-run]');
    expect(joined).toContain('GET https://api.example.com/users');
  });

  it('emits structured JSON for a dry-run in JSON mode', async () => {
    setOutputMode('json');
    await runApiRequest('/users', { dryRun: true });
    expect(mockApiRequest).not.toHaveBeenCalled();
    const parsed = JSON.parse(consoleOutput[0]!);
    expect(parsed).toEqual({
      dryRun: true,
      method: 'GET',
      url: 'https://api.example.com/users',
    });
  });

  it('parses --data into the JSON dry-run payload', async () => {
    setOutputMode('json');
    await runApiRequest('/organizations', { dryRun: true, data: '{"name":"Acme"}' });
    const parsed = JSON.parse(consoleOutput[0]!);
    expect(parsed).toEqual({
      dryRun: true,
      method: 'POST',
      url: 'https://api.example.com/organizations',
      body: { name: 'Acme' },
    });
  });

  it('exits with a structured error in JSON dry-run mode when --data is not valid JSON', async () => {
    setOutputMode('json');
    await expect(runApiRequest('/organizations', { dryRun: true, data: 'not json' })).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed?.error?.code === 'invalid_json_body';
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
  });

  it('falls back to a raw human-mode preview when --data is not valid JSON', async () => {
    setOutputMode('human');
    await runApiRequest('/organizations', { dryRun: true, data: 'not json' });
    expect(mockApiRequest).not.toHaveBeenCalled();
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('[dry-run]');
    expect(joined).toContain('not json');
  });

  it('infers POST when a body is provided without an explicit method', async () => {
    mockApiRequest.mockResolvedValue(buildResponse());
    await runApiRequest('/organizations', { data: '{"name":"Acme"}', yes: true });
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/organizations', body: '{"name":"Acme"}' }),
    );
  });

  it('skips confirmation when --yes is set for mutating methods', async () => {
    mockApiRequest.mockResolvedValue(buildResponse());
    await runApiRequest('/organizations', { method: 'DELETE', yes: true });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenCalled();
  });

  it('prompts for confirmation on mutating methods in TTY environments', async () => {
    mockApiRequest.mockResolvedValue(buildResponse());
    mockConfirm.mockResolvedValueOnce(true);
    await runApiRequest('/organizations', { method: 'POST', data: '{}' });
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenCalled();
  });

  it('aborts when the user declines the confirmation prompt', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    await expect(runApiRequest('/organizations', { method: 'POST', data: '{}' })).rejects.toThrow(/__exit__:0/);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('exits with code 1 when the response status is >= 400', async () => {
    mockApiRequest.mockResolvedValue(buildResponse({ status: 404, body: { error: 'not_found' } }));
    await expect(runApiRequest('/users', { yes: true })).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('passes --include through to printResponse', async () => {
    setOutputMode('human');
    const headers = new Headers({ 'x-request-id': 'abc' });
    mockApiRequest.mockResolvedValue(buildResponse({ status: 201, headers }));
    await runApiRequest('/users', { include: true, yes: true });
    const joined = consoleOutput.join('\n');
    expect(joined).toContain('HTTP 201');
    expect(joined).toContain('x-request-id: abc');
  });

  it('forwards --api-key to apiRequest', async () => {
    mockApiRequest.mockResolvedValue(buildResponse());
    await runApiRequest('/users', { apiKey: 'sk_override', yes: true });
    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk_override' }));
  });

  it('exits with a structured error when --file points at a missing path', async () => {
    setOutputMode('json');
    await expect(
      runApiRequest('/organizations', { file: '/tmp/__nonexistent_workos_api_body__.json', yes: true }),
    ).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string; message?: string } };
        return parsed.error?.code === 'file_read_error';
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('treats an empty --data string as a body so method inference does not flip to GET', async () => {
    mockApiRequest.mockResolvedValue(buildResponse());
    await runApiRequest('/organizations', { data: '', yes: true });
    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', body: '' }));
  });

  it('refuses mutating requests without --yes in non-interactive human mode', async () => {
    setOutputMode('human');
    vi.mocked(isNonInteractiveEnvironment).mockReturnValueOnce(true);
    await expect(runApiRequest('/organizations', { method: 'POST', data: '{}' })).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(stderrOutput.some((l) => l.includes('Refusing to POST'))).toBe(true);
  });

  it('exits with confirmation_required in JSON mode when a mutating request lacks --yes', async () => {
    setOutputMode('json');
    await expect(runApiRequest('/organizations', { method: 'POST', data: '{}' })).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string } };
        return parsed.error?.code === 'confirmation_required';
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
  });

  it('exits with empty_stdin_body when --file - is used and stdin is empty', async () => {
    setOutputMode('json');
    // Replace process.stdin with an async iterator that yields no chunks (EOF immediately).
    const emptyStdin = (async function* () {})();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: emptyStdin, configurable: true });
    try {
      await expect(runApiRequest('/orgs', { file: '-', yes: true })).rejects.toThrow(/__exit__:1/);
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockApiRequest).not.toHaveBeenCalled();
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string } };
        return parsed.error?.code === 'empty_stdin_body';
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
  });
});
