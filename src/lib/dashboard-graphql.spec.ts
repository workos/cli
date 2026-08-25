import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dashboardGraphqlUpload, DashboardGraphqlError } from './dashboard-graphql.js';

/**
 * Covers the multipart (`Upload`) transport. The plain JSON path is exercised
 * end-to-end by the command specs; what needs direct coverage here is the
 * multipart envelope, because its failure mode is silent: a `map` path that
 * matches nothing leaves the `null` placeholder in the variables, and for
 * `updateAppBranding` a null image field means "clear this asset".
 */

const QUERY = 'mutation updateAppBranding($input: UpdateAppBrandingInput!) { updateAppBranding(input: $input) { id } }';

function pngBytes(size = 8): Uint8Array {
  return new Uint8Array(size).fill(1);
}

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('dashboardGraphqlUpload', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The FormData handed to fetch on the most recent call. */
  function sentForm(): FormData {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    return init.body as FormData;
  }

  function sentHeaders(): Record<string, string> {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    return init.headers as Record<string, string>;
  }

  const uploadOneLogo = () =>
    dashboardGraphqlUpload(QUERY, {
      token: 'tok_123',
      environmentId: 'env_1',
      variables: { input: { id: 'br_1', lightLogoFile: null } },
      files: [
        {
          variablePath: 'variables.input.lightLogoFile',
          filename: 'logo.png',
          contentType: 'image/png',
          bytes: pngBytes(),
        },
      ],
    });

  it('builds a spec-compliant multipart envelope (operations + map + indexed parts)', async () => {
    await uploadOneLogo();

    const form = sentForm();
    expect(JSON.parse(form.get('operations') as string)).toEqual({
      query: QUERY,
      variables: { input: { id: 'br_1', lightLogoFile: null } },
    });
    // The map binds part "0" to the variable slot holding null.
    expect(JSON.parse(form.get('map') as string)).toEqual({ '0': ['variables.input.lightLogoFile'] });

    const part = form.get('0') as File;
    expect(part).toBeInstanceOf(Blob);
    expect(part.name).toBe('logo.png');
    expect(part.type).toBe('image/png');
    expect(part.size).toBe(8);
  });

  it('sends the CSRF header Apollo requires for a CORS-simple multipart body', async () => {
    await uploadOneLogo();
    // Value is irrelevant (the server skips validation for bearer requests);
    // presence is what forces the preflight Apollo demands.
    expect(sentHeaders()['X-CSRF-Token']).toBeTruthy();
  });

  it('lets fetch set Content-Type so the multipart boundary matches the body', async () => {
    await uploadOneLogo();
    expect(sentHeaders()['Content-Type']).toBeUndefined();
  });

  it('still sends the bearer token and environment header', async () => {
    await uploadOneLogo();
    expect(sentHeaders().Authorization).toBe('Bearer tok_123');
    expect(sentHeaders()['x-url-environment-id']).toBe('env_1');
  });

  it('indexes multiple files independently', async () => {
    await dashboardGraphqlUpload(QUERY, {
      token: 'tok_123',
      variables: { input: { id: 'br_1', lightLogoFile: null, darkFaviconFile: null } },
      files: [
        {
          variablePath: 'variables.input.lightLogoFile',
          filename: 'a.png',
          contentType: 'image/png',
          bytes: pngBytes(),
        },
        {
          variablePath: 'variables.input.darkFaviconFile',
          filename: 'b.ico',
          contentType: 'image/x-icon',
          bytes: pngBytes(4),
        },
      ],
    });

    const form = sentForm();
    expect(JSON.parse(form.get('map') as string)).toEqual({
      '0': ['variables.input.lightLogoFile'],
      '1': ['variables.input.darkFaviconFile'],
    });
    expect((form.get('0') as File).name).toBe('a.png');
    expect((form.get('1') as File).name).toBe('b.ico');
  });

  describe('placeholder guard', () => {
    // Each of these would otherwise produce a request that silently drops the
    // file and clears the branding asset instead of setting it.
    it('rejects a path whose slot is not null', async () => {
      await expect(
        dashboardGraphqlUpload(QUERY, {
          token: 'tok_123',
          variables: { input: { id: 'br_1', lightLogoFile: 'oops' } },
          files: [
            {
              variablePath: 'variables.input.lightLogoFile',
              filename: 'a.png',
              contentType: 'image/png',
              bytes: pngBytes(),
            },
          ],
        }),
      ).rejects.toThrow(/must be null/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a path that does not exist in the variables', async () => {
      await expect(
        dashboardGraphqlUpload(QUERY, {
          token: 'tok_123',
          variables: { input: { id: 'br_1' } },
          files: [
            {
              variablePath: 'variables.input.lightLogoFyle',
              filename: 'a.png',
              contentType: 'image/png',
              bytes: pngBytes(),
            },
          ],
        }),
      ).rejects.toThrow(/does not exist/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a path not rooted at "variables"', async () => {
      await expect(
        dashboardGraphqlUpload(QUERY, {
          token: 'tok_123',
          variables: { input: { lightLogoFile: null } },
          files: [
            { variablePath: 'input.lightLogoFile', filename: 'a.png', contentType: 'image/png', bytes: pngBytes() },
          ],
        }),
      ).rejects.toThrow(/rooted at "variables"/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an upload with no files', async () => {
      await expect(
        dashboardGraphqlUpload(QUERY, { token: 'tok_123', variables: { input: {} }, files: [] }),
      ).rejects.toThrow(/at least one file/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('error classification', () => {
    it('maps 403 to forbidden, like the JSON path', async () => {
      fetchMock.mockResolvedValue(new Response('nope', { status: 403 }));
      await expect(uploadOneLogo()).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    });

    it('maps a GraphQL errors[] payload to graphql_error', async () => {
      // A fresh Response per call: a body stream can only be consumed once.
      fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ errors: [{ message: 'File too large' }] }), { status: 200 }),
      );
      await expect(uploadOneLogo()).rejects.toBeInstanceOf(DashboardGraphqlError);
      await expect(uploadOneLogo()).rejects.toMatchObject({ code: 'graphql_error' });
    });

    it('maps a transport failure to network_error', async () => {
      fetchMock.mockRejectedValue(new Error('socket hang up'));
      await expect(uploadOneLogo()).rejects.toMatchObject({ code: 'network_error' });
    });
  });
});
