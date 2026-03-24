import { describe, it, expect } from 'vitest';
import {
  type OpenAPISpec,
  type ParsedEntity,
  type ParsedRoute,
  parseSpec,
  generateEntities,
  generateStore,
  generateHelpers,
  generateRoutes,
  schemaToTsType,
  toSnakeCase,
  toPascalCase,
  toCamelCase,
  pluralize,
  singularize,
  openApiPathToHono,
} from './gen-routes-lib.js';

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

describe('toSnakeCase', () => {
  it('converts PascalCase', () => {
    expect(toSnakeCase('Organization')).toBe('organization');
    expect(toSnakeCase('OrganizationDomain')).toBe('organization_domain');
    expect(toSnakeCase('SSOProfile')).toBe('sso_profile');
  });

  it('handles already snake_case', () => {
    expect(toSnakeCase('organization')).toBe('organization');
  });
});

describe('toPascalCase', () => {
  it('converts snake_case', () => {
    expect(toPascalCase('organization')).toBe('Organization');
    expect(toPascalCase('organization_domain')).toBe('OrganizationDomain');
  });

  it('converts hyphenated', () => {
    expect(toPascalCase('magic-auth')).toBe('MagicAuth');
  });
});

describe('toCamelCase', () => {
  it('converts snake_case', () => {
    expect(toCamelCase('organization')).toBe('organization');
    expect(toCamelCase('organization_domain')).toBe('organizationDomain');
  });
});

describe('pluralize', () => {
  it('adds -s to regular words', () => {
    expect(pluralize('organization')).toBe('organizations');
    expect(pluralize('user')).toBe('users');
  });

  it('adds -ies for consonant+y', () => {
    expect(pluralize('identity')).toBe('identities');
  });

  it('adds -es for words ending in s/x/z', () => {
    expect(pluralize('address')).toBe('addresses');
  });
});

describe('singularize', () => {
  it('removes trailing -s', () => {
    expect(singularize('organizations')).toBe('organization');
    expect(singularize('users')).toBe('user');
  });

  it('handles -ies', () => {
    expect(singularize('identities')).toBe('identity');
  });

  it('handles -ses', () => {
    expect(singularize('addresses')).toBe('address');
  });
});

describe('openApiPathToHono', () => {
  it('converts path params', () => {
    expect(openApiPathToHono('/organizations/{id}')).toBe('/organizations/:id');
    expect(openApiPathToHono('/users/{user_id}/sessions')).toBe('/users/:user_id/sessions');
  });

  it('handles multiple params', () => {
    expect(openApiPathToHono('/orgs/{org_id}/members/{id}')).toBe('/orgs/:org_id/members/:id');
  });

  it('passes through paths without params', () => {
    expect(openApiPathToHono('/organizations')).toBe('/organizations');
  });
});

// ---------------------------------------------------------------------------
// schemaToTsType
// ---------------------------------------------------------------------------

describe('schemaToTsType', () => {
  const emptySpec: OpenAPISpec = {};

  it('converts string type', () => {
    expect(schemaToTsType({ type: 'string' }, emptySpec)).toBe('string');
  });

  it('converts integer type', () => {
    expect(schemaToTsType({ type: 'integer' }, emptySpec)).toBe('number');
  });

  it('converts boolean type', () => {
    expect(schemaToTsType({ type: 'boolean' }, emptySpec)).toBe('boolean');
  });

  it('converts enum to union type', () => {
    expect(schemaToTsType({ type: 'string', enum: ['active', 'inactive'] }, emptySpec)).toBe("'active' | 'inactive'");
  });

  it('converts array type', () => {
    expect(schemaToTsType({ type: 'array', items: { type: 'string' } }, emptySpec)).toBe('string[]');
  });

  it('converts object with additionalProperties', () => {
    expect(schemaToTsType({ type: 'object', additionalProperties: { type: 'string' } }, emptySpec)).toBe(
      'Record<string, string>',
    );
  });

  it('handles unknown type', () => {
    expect(schemaToTsType({}, emptySpec)).toBe('unknown');
  });

  it('resolves $ref', () => {
    const spec: OpenAPISpec = {
      components: {
        schemas: {
          Status: { type: 'string', enum: ['active', 'pending'] },
        },
      },
    };
    expect(schemaToTsType({ $ref: '#/components/schemas/Status' }, spec)).toBe("'active' | 'pending'");
  });
});

// ---------------------------------------------------------------------------
// parseSpec
// ---------------------------------------------------------------------------

describe('parseSpec', () => {
  function makeSpec(overrides: Partial<OpenAPISpec> = {}): OpenAPISpec {
    return {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      ...overrides,
    };
  }

  it('returns empty entities and routes for empty spec', () => {
    const result = parseSpec(makeSpec());
    expect(result.entities).toEqual([]);
    expect(result.routes).toEqual([]);
  });

  it('extracts an entity from a schema', () => {
    const spec = makeSpec({
      components: {
        schemas: {
          Organization: {
            type: 'object',
            required: ['name'],
            properties: {
              id: { type: 'string' },
              object: { type: 'string', enum: ['organization'] },
              name: { type: 'string' },
              external_id: { type: 'string', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    });

    const result = parseSpec(spec);
    expect(result.entities).toHaveLength(1);

    const org = result.entities[0];
    expect(org.name).toBe('Organization');
    expect(org.objectType).toBe('organization');
    expect(org.idPrefix).toBe('org');
    // id, created_at, updated_at should be excluded from fields
    expect(org.fields.find((f) => f.name === 'id')).toBeUndefined();
    expect(org.fields.find((f) => f.name === 'created_at')).toBeUndefined();
    expect(org.fields.find((f) => f.name === 'updated_at')).toBeUndefined();
    // object and name should be present
    expect(org.fields.find((f) => f.name === 'object')).toBeDefined();
    expect(org.fields.find((f) => f.name === 'name')).toBeDefined();
    expect(org.fields.find((f) => f.name === 'external_id')).toBeDefined();
  });

  it('indexes external_id and fields ending with _id', () => {
    const spec = makeSpec({
      components: {
        schemas: {
          Membership: {
            type: 'object',
            required: ['organization_id', 'user_id'],
            properties: {
              object: { type: 'string' },
              organization_id: { type: 'string' },
              user_id: { type: 'string' },
              external_id: { type: 'string', nullable: true },
            },
          },
        },
      },
    });

    const result = parseSpec(spec);
    const membership = result.entities[0];
    expect(membership.indexFields).toContain('organization_id');
    expect(membership.indexFields).toContain('user_id');
    expect(membership.indexFields).toContain('external_id');
  });

  it('extracts routes from paths', () => {
    const spec = makeSpec({
      paths: {
        '/organizations': {
          get: {
            tags: ['organizations'],
            operationId: 'listOrganizations',
            summary: 'List organizations',
          },
          post: {
            tags: ['organizations'],
            operationId: 'createOrganization',
            summary: 'Create organization',
          },
        },
        '/organizations/{id}': {
          get: {
            tags: ['organizations'],
            operationId: 'getOrganization',
            summary: 'Get organization',
          },
          put: {
            tags: ['organizations'],
            operationId: 'updateOrganization',
            summary: 'Update organization',
          },
          delete: {
            tags: ['organizations'],
            operationId: 'deleteOrganization',
            summary: 'Delete organization',
          },
        },
      },
    });

    const result = parseSpec(spec);
    expect(result.routes).toHaveLength(1);

    const route = result.routes[0];
    expect(route.tag).toBe('organizations');
    expect(route.filename).toBe('organizations.ts');
    expect(route.functionName).toBe('organizationRoutes');
    expect(route.storeAccessor).toBe('organizations');
    expect(route.formatterName).toBe('formatOrganization');
    expect(route.operations).toHaveLength(5);

    const listOp = route.operations.find((o) => o.operationId === 'listOrganizations')!;
    expect(listOp.method).toBe('get');
    expect(listOp.isList).toBe(true);
    expect(listOp.hasIdParam).toBe(false);

    const getOp = route.operations.find((o) => o.operationId === 'getOrganization')!;
    expect(getOp.method).toBe('get');
    expect(getOp.isList).toBe(false);
    expect(getOp.hasIdParam).toBe(true);
    expect(getOp.path).toBe('/organizations/:id');
  });

  it('infers tag from path when no tags provided', () => {
    const spec = makeSpec({
      paths: {
        '/connections': {
          get: { operationId: 'listConnections' },
        },
      },
    });

    const result = parseSpec(spec);
    expect(result.routes[0].tag).toBe('connections');
  });
});

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

const sampleEntity: ParsedEntity = {
  name: 'Organization',
  objectType: 'organization',
  idPrefix: 'org',
  fields: [
    { name: 'object', tsType: "'organization'", nullable: false },
    { name: 'name', tsType: 'string', nullable: false },
    { name: 'external_id', tsType: 'string', nullable: true },
    { name: 'metadata', tsType: 'Record<string, string>', nullable: false },
  ],
  indexFields: ['name', 'external_id'],
};

describe('generateEntities', () => {
  it('generates entity interface', () => {
    const output = generateEntities([sampleEntity]);
    expect(output).toContain("import type { Entity } from '../../core/index.js';");
    expect(output).toContain('export interface WorkOSOrganization extends Entity {');
    expect(output).toContain("  object: 'organization';");
    expect(output).toContain('  name: string;');
    expect(output).toContain('  external_id: string | null;');
    expect(output).toContain('  metadata: Record<string, string>;');
  });

  it('does not duplicate null in already-nullable types', () => {
    const entity: ParsedEntity = {
      name: 'Test',
      objectType: 'test',
      idPrefix: 'test',
      fields: [{ name: 'value', tsType: 'string | null', nullable: true }],
      indexFields: [],
    };
    const output = generateEntities([entity]);
    // Should not produce "string | null | null"
    expect(output).toContain('  value: string | null;');
    expect(output).not.toContain('null | null');
  });
});

describe('generateStore', () => {
  it('generates store interface and factory', () => {
    const output = generateStore([sampleEntity]);
    expect(output).toContain('export interface WorkOSGeneratedStore {');
    expect(output).toContain('  organizations: Collection<WorkOSOrganization>;');
    expect(output).toContain('export function getWorkOSGeneratedStore(store: Store): WorkOSGeneratedStore {');
    expect(output).toContain(
      "store.collection<WorkOSOrganization>('workos.organizations', 'org', ['name', 'external_id'])",
    );
  });
});

describe('generateHelpers', () => {
  it('generates format functions', () => {
    const output = generateHelpers([sampleEntity]);
    expect(output).toContain(
      'export function formatOrganization(organization: WorkOSOrganization): Record<string, unknown> {',
    );
    expect(output).toContain("    object: 'organization',");
    expect(output).toContain('    id: organization.id,');
    expect(output).toContain('    name: organization.name,');
    expect(output).toContain('    created_at: organization.created_at,');
    expect(output).toContain('    updated_at: organization.updated_at,');
  });

  it('generates parseListParams', () => {
    const output = generateHelpers([sampleEntity]);
    expect(output).toContain('export function parseListParams(url: URL)');
  });
});

describe('generateRoutes', () => {
  const sampleRoute: ParsedRoute = {
    tag: 'organizations',
    filename: 'organizations.ts',
    functionName: 'organizationRoutes',
    storeAccessor: 'organizations',
    formatterName: 'formatOrganization',
    operations: [
      { method: 'post', path: '/organizations', hasIdParam: false, isList: false, queryParams: [] },
      {
        method: 'get',
        path: '/organizations',
        operationId: 'listOrganizations',
        summary: 'List organizations',
        hasIdParam: false,
        isList: true,
        queryParams: ['limit', 'order'],
      },
      {
        method: 'get',
        path: '/organizations/:id',
        operationId: 'getOrganization',
        summary: 'Get organization',
        hasIdParam: true,
        isList: false,
        queryParams: [],
      },
      {
        method: 'put',
        path: '/organizations/:id',
        operationId: 'updateOrganization',
        hasIdParam: true,
        isList: false,
        queryParams: [],
      },
      {
        method: 'delete',
        path: '/organizations/:id',
        operationId: 'deleteOrganization',
        hasIdParam: true,
        isList: false,
        queryParams: [],
      },
    ],
  };

  it('generates route function with correct structure', () => {
    const output = generateRoutes(sampleRoute);
    expect(output).toContain('export function organizationRoutes(ctx: RouteContext): void {');
    expect(output).toContain('const ws = getWorkOSGeneratedStore(store);');
  });

  it('generates POST handler', () => {
    const output = generateRoutes(sampleRoute);
    expect(output).toContain("app.post('/organizations', async (c) => {");
    expect(output).toContain('const body = await parseJsonBody(c);');
    expect(output).toContain('ws.organizations.insert({');
    expect(output).toContain('return c.json(formatOrganization(item), 201);');
  });

  it('generates list GET handler', () => {
    const output = generateRoutes(sampleRoute);
    expect(output).toContain("app.get('/organizations', (c) => {");
    expect(output).toContain('const params = parseListParams(url);');
    expect(output).toContain("object: 'list',");
    expect(output).toContain('data: result.data.map(formatOrganization),');
  });

  it('generates single GET handler', () => {
    const output = generateRoutes(sampleRoute);
    expect(output).toContain("app.get('/organizations/:id', (c) => {");
    expect(output).toContain("ws.organizations.get(c.req.param('id'))");
    expect(output).toContain("if (!item) throw notFound('Organization');");
  });

  it('generates PUT handler', () => {
    const output = generateRoutes(sampleRoute);
    expect(output).toContain("app.put('/organizations/:id', async (c) => {");
    expect(output).toContain('ws.organizations.update(item.id, body)');
  });

  it('generates DELETE handler', () => {
    const output = generateRoutes(sampleRoute);
    expect(output).toContain("app.delete('/organizations/:id', (c) => {");
    expect(output).toContain('ws.organizations.delete(item.id);');
    expect(output).toContain('return c.body(null, 204);');
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('produces identical output when run twice', () => {
    const spec: OpenAPISpec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      components: {
        schemas: {
          Widget: {
            type: 'object',
            required: ['name'],
            properties: {
              object: { type: 'string' },
              name: { type: 'string' },
              color: { type: 'string', nullable: true },
            },
          },
        },
      },
      paths: {
        '/widgets': {
          get: { tags: ['widgets'], operationId: 'listWidgets' },
          post: { tags: ['widgets'], operationId: 'createWidget' },
        },
        '/widgets/{id}': {
          get: { tags: ['widgets'], operationId: 'getWidget' },
          delete: { tags: ['widgets'], operationId: 'deleteWidget' },
        },
      },
    };

    const run1 = parseSpec(spec);
    const run2 = parseSpec(spec);

    expect(generateEntities(run1.entities)).toBe(generateEntities(run2.entities));
    expect(generateStore(run1.entities)).toBe(generateStore(run2.entities));
    expect(generateHelpers(run1.entities)).toBe(generateHelpers(run2.entities));

    for (let i = 0; i < run1.routes.length; i++) {
      expect(generateRoutes(run1.routes[i])).toBe(generateRoutes(run2.routes[i]));
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end: full spec parsing + generation
// ---------------------------------------------------------------------------

describe('end-to-end generation', () => {
  const spec: OpenAPISpec = {
    openapi: '3.0.0',
    info: { title: 'WorkOS', version: '1.0.0' },
    components: {
      schemas: {
        Organization: {
          type: 'object',
          required: ['name', 'object'],
          properties: {
            id: { type: 'string' },
            object: { type: 'string', enum: ['organization'] },
            name: { type: 'string' },
            external_id: { type: 'string', nullable: true },
            metadata: { type: 'object', additionalProperties: { type: 'string' } },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          required: ['email', 'object'],
          properties: {
            id: { type: 'string' },
            object: { type: 'string', enum: ['user'] },
            email: { type: 'string' },
            first_name: { type: 'string', nullable: true },
            last_name: { type: 'string', nullable: true },
            email_verified: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    paths: {
      '/organizations': {
        get: {
          tags: ['organizations'],
          operationId: 'listOrganizations',
          summary: 'List organizations',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'name', in: 'query', schema: { type: 'string' } },
          ],
        },
        post: {
          tags: ['organizations'],
          operationId: 'createOrganization',
          summary: 'Create organization',
        },
      },
      '/organizations/{id}': {
        get: {
          tags: ['organizations'],
          operationId: 'getOrganization',
          summary: 'Get an organization',
        },
        put: {
          tags: ['organizations'],
          operationId: 'updateOrganization',
          summary: 'Update an organization',
        },
        delete: {
          tags: ['organizations'],
          operationId: 'deleteOrganization',
          summary: 'Delete an organization',
        },
      },
      '/user_management/users': {
        get: {
          tags: ['user_management_users'],
          operationId: 'listUsers',
          summary: 'List users',
        },
        post: {
          tags: ['user_management_users'],
          operationId: 'createUser',
          summary: 'Create user',
        },
      },
      '/user_management/users/{id}': {
        get: {
          tags: ['user_management_users'],
          operationId: 'getUser',
          summary: 'Get user',
        },
      },
    },
  };

  it('parses entities from schemas', () => {
    const parsed = parseSpec(spec);
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.entities.map((e) => e.name).sort()).toEqual(['Organization', 'User']);
  });

  it('parses routes from paths', () => {
    const parsed = parseSpec(spec);
    expect(parsed.routes).toHaveLength(2);
    const tags = parsed.routes.map((r) => r.tag).sort();
    expect(tags).toEqual(['organizations', 'user_management_users']);
  });

  it('generates valid entity code', () => {
    const parsed = parseSpec(spec);
    const entitiesCode = generateEntities(parsed.entities);
    // Should produce valid-looking TypeScript
    expect(entitiesCode).toContain('export interface WorkOSOrganization extends Entity');
    expect(entitiesCode).toContain('export interface WorkOSUser extends Entity');
  });

  it('generates store with all entities', () => {
    const parsed = parseSpec(spec);
    const storeCode = generateStore(parsed.entities);
    expect(storeCode).toContain('organizations: Collection<WorkOSOrganization>');
    expect(storeCode).toContain('users: Collection<WorkOSUser>');
  });

  it('generates helpers with format functions', () => {
    const parsed = parseSpec(spec);
    const helpersCode = generateHelpers(parsed.entities);
    expect(helpersCode).toContain('export function formatOrganization');
    expect(helpersCode).toContain('export function formatUser');
  });

  it('generates route stubs', () => {
    const parsed = parseSpec(spec);
    const orgRoute = parsed.routes.find((r) => r.tag === 'organizations')!;
    const routeCode = generateRoutes(orgRoute);
    expect(routeCode).toContain("app.post('/organizations'");
    expect(routeCode).toContain("app.get('/organizations'");
    expect(routeCode).toContain("app.get('/organizations/:id'");
    expect(routeCode).toContain("app.put('/organizations/:id'");
    expect(routeCode).toContain("app.delete('/organizations/:id'");
  });

  it('handles query parameters in list endpoints', () => {
    const parsed = parseSpec(spec);
    const orgRoute = parsed.routes.find((r) => r.tag === 'organizations')!;
    const listOp = orgRoute.operations.find((o) => o.isList)!;
    expect(listOp.queryParams).toContain('limit');
    expect(listOp.queryParams).toContain('name');
  });
});
