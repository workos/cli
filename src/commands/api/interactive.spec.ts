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
      method: 'GET',
      path: '/users/{id}',
      summary: 'Get user',
      tag: 'Users',
      operationId: 'getUser',
      pathParams: [{ name: 'id', description: 'User ID', required: true }],
      queryParams: [{ name: 'expand', description: 'Expand fields', required: false }],
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
      method: 'GET',
      path: '/users/{id}/links/{id}',
      summary: 'Repeated path param (defensive)',
      tag: 'Users',
      operationId: 'getUserLink',
      pathParams: [{ name: 'id', description: 'Identifier reused twice', required: true }],
      queryParams: [],
      hasRequestBody: false,
      requestBodyRequired: false,
    },
    {
      method: 'PATCH',
      path: '/users/{id}',
      summary: 'Update user',
      tag: 'Users',
      operationId: 'updateUser',
      pathParams: [{ name: 'id', description: 'User ID', required: true }],
      queryParams: [],
      hasRequestBody: true,
      requestBodyRequired: false,
    },
    {
      method: 'GET',
      path: '/authorize',
      summary: 'Authorize',
      tag: 'Auth',
      operationId: 'authorize',
      pathParams: [],
      queryParams: [
        { name: 'response_type', description: 'Response type', required: true },
        { name: 'state', description: 'Optional state', required: false },
      ],
      hasRequestBody: false,
      requestBodyRequired: false,
    },
  ],
  tags: ['Auth', 'Organizations', 'Users'],
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

const mockSelect = vi.fn();
const mockText = vi.fn();
const mockConfirm = vi.fn();
const cancelSymbol = Symbol('cancel');
const mockIsCancel = vi.fn((value: unknown) => value === cancelSymbol);

vi.mock('../../utils/clack.js', () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    text: (...args: unknown[]) => mockText(...args),
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (value: unknown) => mockIsCancel(value),
  },
}));

const { apiInteractive } = await import('./interactive.js');
const { CliExit } = await import('../../utils/cli-exit.js');

async function expectExit(promise: Promise<unknown>, code: number): Promise<void> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(code);
      return;
    }
    throw err;
  }
  throw new Error(`Expected promise to reject with CliExit(${code}) but it resolved`);
}

function buildResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: 200,
    headers: new Headers(),
    body: { ok: true },
    rawBody: '{"ok":true}',
    ...overrides,
  };
}

describe('apiInteractive', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCancel.mockImplementation((value: unknown) => value === cancelSymbol);
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drives the happy path: select tag → endpoint → confirm → execute', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[0]);
    mockConfirm.mockResolvedValueOnce(true);
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/users',
        apiKey: 'sk_test',
        baseUrl: 'https://api.example.com',
      }),
    );
  });

  it('substitutes path params and prompts for them', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[1]);
    mockText.mockResolvedValueOnce('user_42');
    // ep has only optional query params, decline adding them
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/users/user_42' }));
  });

  it('appends URL-encoded query params when the user opts in', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[1]);
    mockText
      .mockResolvedValueOnce('user 42') // path param
      .mockResolvedValueOnce('first name'); // query param value
    mockConfirm
      .mockResolvedValueOnce(true) // wantsQuery
      .mockResolvedValueOnce(true); // execute
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    // Both path and query values are URL-encoded so fetch() doesn't throw "Invalid URL"
    // on values containing spaces or other URL-unsafe characters.
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/users/user%2042?expand=first%20name' }),
    );
  });

  it('URL-encodes path param values containing reserved characters', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[1]);
    // Value with characters that would break URL parsing if substituted verbatim.
    mockText.mockResolvedValueOnce('a/b?c#d');
    // No query params, then execute.
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/users/a%2Fb%3Fc%23d' }));
  });

  it('collects a required JSON request body without asking to confirm', async () => {
    mockSelect.mockResolvedValueOnce('Organizations').mockResolvedValueOnce(mockCatalog.endpoints[2]);
    // No confirm for body (requestBodyRequired=true); only confirm for execute
    mockConfirm.mockResolvedValueOnce(true);
    mockText.mockResolvedValueOnce('{"name":"Acme"}');
    mockApiRequest.mockResolvedValueOnce(buildResponse({ status: 201 }));

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/organizations', body: '{"name":"Acme"}' }),
    );
  });

  it('prompts to confirm an optional request body and skips it when declined', async () => {
    const patchUser = mockCatalog.endpoints[4]; // PATCH /users/{id}, requestBodyRequired: false
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(patchUser);
    mockText.mockResolvedValueOnce('user_42'); // path param
    mockConfirm
      .mockResolvedValueOnce(false) // decline optional body
      .mockResolvedValueOnce(true); // execute
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ body: undefined }));
  });

  it('exits with code 2 when the user cancels at the category prompt', async () => {
    mockSelect.mockResolvedValueOnce(cancelSymbol);

    await expectExit(apiInteractive(), 2);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('exits with code 2 when the user declines the final confirmation', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[0]);
    mockConfirm.mockResolvedValueOnce(false);

    await expectExit(apiInteractive(), 2);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('replaces every occurrence of a repeated path placeholder', async () => {
    const repeated = mockCatalog.endpoints[3];
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(repeated);
    mockText.mockResolvedValueOnce('user_42');
    mockConfirm.mockResolvedValueOnce(true);
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/users/user_42/links/user_42' }));
  });

  it('always collects required query params without gating behind a confirm', async () => {
    const authEp = mockCatalog.endpoints[5]; // GET /authorize with required response_type + optional state
    mockSelect.mockResolvedValueOnce('Auth').mockResolvedValueOnce(authEp);
    mockText.mockResolvedValueOnce('code'); // required: response_type
    mockConfirm
      .mockResolvedValueOnce(false) // decline optional query params
      .mockResolvedValueOnce(true); // execute
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/authorize?response_type=code' }));
  });

  it('collects both required and optional query params when user opts in', async () => {
    const authEp = mockCatalog.endpoints[5];
    mockSelect.mockResolvedValueOnce('Auth').mockResolvedValueOnce(authEp);
    mockText
      .mockResolvedValueOnce('code') // required: response_type
      .mockResolvedValueOnce('abc123'); // optional: state
    mockConfirm
      .mockResolvedValueOnce(true) // accept optional query params
      .mockResolvedValueOnce(true); // execute
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/authorize?response_type=code&state=abc123' }),
    );
  });

  it('uses the provided apiKey override instead of resolveApiKey()', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[0]);
    mockConfirm.mockResolvedValueOnce(true);
    mockApiRequest.mockResolvedValueOnce(buildResponse());

    await apiInteractive({ apiKey: 'sk_override' });

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk_override' }));
  });

  it('exits with code 1 when the response status is >= 400', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[0]);
    mockConfirm.mockResolvedValueOnce(true);
    mockApiRequest.mockResolvedValueOnce(buildResponse({ status: 500, body: { error: 'boom' } }));

    await expectExit(apiInteractive(), 1);
  });
});
