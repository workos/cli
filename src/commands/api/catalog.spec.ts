import { describe, it, expect } from 'vitest';
import { parseSpec, endpointsByTag, type EndpointInfo } from './catalog.js';

const SAMPLE_SPEC = `
openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths:
  /organizations:
    get:
      operationId: listOrganizations
      summary: List organizations
      tags: [Organizations]
      parameters:
        - name: limit
          in: query
          required: false
          description: Max items
    post:
      operationId: createOrganization
      summary: Create organization
      tags: [Organizations]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
  /organizations/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: Organization id
    get:
      operationId: getOrganization
      summary: Get organization
      tags: [Organizations]
    delete:
      operationId: deleteOrganization
      summary: Delete organization
      tags: [Organizations]
  /users:
    get:
      operationId: listUsers
      summary: List users
      tags: [Users]
`;

describe('parseSpec', () => {
  it('returns endpoints for each method on a path', () => {
    const catalog = parseSpec(SAMPLE_SPEC);
    const ops = catalog.endpoints.filter((e) => e.path === '/organizations').map((e) => e.method);
    expect(ops.sort()).toEqual(['GET', 'POST']);
  });

  it('captures summary, tag, and operationId', () => {
    const catalog = parseSpec(SAMPLE_SPEC);
    const get = catalog.endpoints.find((e) => e.path === '/organizations' && e.method === 'GET');
    expect(get).toMatchObject({
      summary: 'List organizations',
      tag: 'Organizations',
      operationId: 'listOrganizations',
    });
  });

  it('extracts path parameters from shared parameters block', () => {
    const catalog = parseSpec(SAMPLE_SPEC);
    const get = catalog.endpoints.find((e) => e.path === '/organizations/{id}' && e.method === 'GET');
    expect(get?.pathParams).toEqual([{ name: 'id', description: 'Organization id', required: true }]);
    expect(get?.queryParams).toEqual([]);
  });

  it('extracts query parameters from operation', () => {
    const catalog = parseSpec(SAMPLE_SPEC);
    const get = catalog.endpoints.find((e) => e.path === '/organizations' && e.method === 'GET');
    expect(get?.queryParams).toEqual([{ name: 'limit', description: 'Max items', required: false }]);
  });

  it('flags hasRequestBody when requestBody is present', () => {
    const catalog = parseSpec(SAMPLE_SPEC);
    const post = catalog.endpoints.find((e) => e.path === '/organizations' && e.method === 'POST');
    const get = catalog.endpoints.find((e) => e.path === '/organizations' && e.method === 'GET');
    expect(post?.hasRequestBody).toBe(true);
    expect(get?.hasRequestBody).toBe(false);
  });

  it('captures requestBodyRequired from the spec', () => {
    const catalog = parseSpec(SAMPLE_SPEC);
    const post = catalog.endpoints.find((e) => e.path === '/organizations' && e.method === 'POST');
    const get = catalog.endpoints.find((e) => e.path === '/organizations' && e.method === 'GET');
    expect(post?.requestBodyRequired).toBe(true);
    expect(get?.requestBodyRequired).toBe(false);
  });

  it('sets requestBodyRequired to false when requestBody exists but required is not set', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths:
  /widgets:
    patch:
      operationId: patchWidget
      summary: Patch widget
      tags: [Widgets]
      requestBody:
        content:
          application/json:
            schema:
              type: object
`;
    const catalog = parseSpec(yaml);
    expect(catalog.endpoints[0]?.hasRequestBody).toBe(true);
    expect(catalog.endpoints[0]?.requestBodyRequired).toBe(false);
  });

  it('produces a sorted unique tags list', () => {
    const catalog = parseSpec(SAMPLE_SPEC);
    expect(catalog.tags).toEqual(['Organizations', 'Users']);
  });

  it('returns an empty catalog when paths is missing', () => {
    const catalog = parseSpec('openapi: 3.0.0\ninfo:\n  title: t\n  version: 1.0.0\n');
    expect(catalog.endpoints).toEqual([]);
    expect(catalog.tags).toEqual([]);
  });

  it('resolves $ref parameters against components.parameters', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
components:
  parameters:
    SharedId:
      name: id
      in: path
      required: true
      description: Shared id parameter
    SharedLimit:
      name: limit
      in: query
      required: false
      description: Page size
paths:
  /widgets/{id}:
    parameters:
      - $ref: '#/components/parameters/SharedId'
    get:
      operationId: getWidget
      summary: Get widget
      parameters:
        - $ref: '#/components/parameters/SharedLimit'
`;
    const catalog = parseSpec(yaml);
    const ep = catalog.endpoints.find((e) => e.path === '/widgets/{id}' && e.method === 'GET');
    expect(ep?.pathParams).toEqual([{ name: 'id', description: 'Shared id parameter', required: true }]);
    expect(ep?.queryParams).toEqual([{ name: 'limit', description: 'Page size', required: false }]);
  });

  it('skips $ref parameters that cannot be resolved instead of leaking placeholders', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths:
  /widgets/{id}:
    parameters:
      - $ref: '#/components/parameters/Missing'
      - name: id
        in: path
        required: true
        description: Inline id
    get:
      operationId: getWidget
      summary: Get widget
`;
    const catalog = parseSpec(yaml);
    const ep = catalog.endpoints[0];
    // The unresolvable $ref should be silently dropped; the inline param survives.
    expect(ep?.pathParams).toEqual([{ name: 'id', description: 'Inline id', required: true }]);
  });

  it('deduplicates params by (name, in) — operation-level overrides path-level', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths:
  /widgets/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: From path-level
    get:
      operationId: getWidget
      summary: Get widget
      parameters:
        - name: id
          in: path
          required: true
          description: From operation-level (wins)
`;
    const catalog = parseSpec(yaml);
    const ep = catalog.endpoints[0];
    expect(ep?.pathParams).toEqual([{ name: 'id', description: 'From operation-level (wins)', required: true }]);
  });

  it('falls back to "other" tag when none is provided', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths:
  /noop:
    get:
      operationId: noop
      summary: No tag
`;
    const catalog = parseSpec(yaml);
    expect(catalog.endpoints[0]?.tag).toBe('other');
    expect(catalog.tags).toEqual(['other']);
  });
});

describe('endpointsByTag', () => {
  const endpoints: EndpointInfo[] = [
    {
      method: 'GET',
      path: '/users',
      summary: '',
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
      summary: '',
      tag: 'Organizations',
      operationId: 'createOrg',
      pathParams: [],
      queryParams: [],
      hasRequestBody: true,
      requestBodyRequired: true,
    },
    {
      method: 'DELETE',
      path: '/users/{id}',
      summary: '',
      tag: 'Users',
      operationId: 'deleteUser',
      pathParams: [],
      queryParams: [],
      hasRequestBody: false,
      requestBodyRequired: false,
    },
  ];

  it('groups endpoints by tag preserving insertion order', () => {
    const grouped = endpointsByTag(endpoints);
    expect([...grouped.keys()]).toEqual(['Users', 'Organizations']);
    expect(grouped.get('Users')?.map((e) => e.operationId)).toEqual(['listUsers', 'deleteUser']);
    expect(grouped.get('Organizations')?.map((e) => e.operationId)).toEqual(['createOrg']);
  });

  it('returns an empty map when no endpoints are provided', () => {
    expect(endpointsByTag([]).size).toBe(0);
  });
});
