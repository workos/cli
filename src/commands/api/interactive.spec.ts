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
    },
  ],
  tags: ['Organizations', 'Users'],
};

const mockApiRequest = vi.fn<(...args: unknown[]) => Promise<ApiResponse>>();

vi.mock('./catalog.js', async () => {
  const actual = await vi.importActual<typeof import('./catalog.js')>('./catalog.js');
  return {
    ...actual,
    loadCatalog: () => mockCatalog,
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
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCancel.mockImplementation((value: unknown) => value === cancelSymbol);
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 0}`);
    }) as never);
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
    // ep has a query param, decline adding it
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

  it('collects a JSON request body when the user provides one', async () => {
    mockSelect.mockResolvedValueOnce('Organizations').mockResolvedValueOnce(mockCatalog.endpoints[2]);
    mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    mockText.mockResolvedValueOnce('{"name":"Acme"}');
    mockApiRequest.mockResolvedValueOnce(buildResponse({ status: 201 }));

    await apiInteractive();

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/organizations', body: '{"name":"Acme"}' }),
    );
  });

  it('exits with code 0 when the user cancels at the category prompt', async () => {
    mockSelect.mockResolvedValueOnce(cancelSymbol);

    await expect(apiInteractive()).rejects.toThrow(/__exit__:0/);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('exits with code 0 when the user declines the final confirmation', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[0]);
    mockConfirm.mockResolvedValueOnce(false);

    await expect(apiInteractive()).rejects.toThrow(/__exit__:0/);
    expect(exitSpy).toHaveBeenCalledWith(0);
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

  it('exits with code 1 when the response status is >= 400', async () => {
    mockSelect.mockResolvedValueOnce('Users').mockResolvedValueOnce(mockCatalog.endpoints[0]);
    mockConfirm.mockResolvedValueOnce(true);
    mockApiRequest.mockResolvedValueOnce(buildResponse({ status: 500, body: { error: 'boom' } }));

    await expect(apiInteractive()).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
