/**
 * Core codegen logic for gen-routes. Separated from the CLI entry point
 * so the transformation functions can be unit-tested independently.
 */

// ---------------------------------------------------------------------------
// OpenAPI types (minimal subset we need)
// ---------------------------------------------------------------------------

export interface OpenAPISpec {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, SchemaObject> };
}

export interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  parameters?: ParameterObject[];
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: {
    content?: Record<string, { schema?: SchemaObject }>;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: SchemaObject }>;
    }
  >;
}

export interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  schema?: SchemaObject;
}

export interface SchemaObject {
  type?: string;
  format?: string;
  enum?: string[];
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  $ref?: string;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  nullable?: boolean;
  description?: string;
  additionalProperties?: boolean | SchemaObject;
}

// ---------------------------------------------------------------------------
// Parsed intermediate representation
// ---------------------------------------------------------------------------

export interface ParsedEntity {
  /** PascalCase name, e.g. "Organization" */
  name: string;
  /** snake_case object type, e.g. "organization" */
  objectType: string;
  /** ID prefix, e.g. "org" */
  idPrefix: string;
  /** Fields beyond the base Entity (id, created_at, updated_at) */
  fields: ParsedField[];
  /** Fields to index in the store collection */
  indexFields: string[];
}

export interface ParsedField {
  name: string;
  tsType: string;
  nullable: boolean;
  description?: string;
}

export interface ParsedRoute {
  /** The resource tag, e.g. "organizations" */
  tag: string;
  /** Output filename, e.g. "organizations.ts" */
  filename: string;
  /** Function name, e.g. "organizationRoutes" */
  functionName: string;
  /** The collection accessor on WorkOSStore, e.g. "organizations" */
  storeAccessor: string;
  /** The formatter function name, e.g. "formatOrganization" */
  formatterName: string;
  /** Individual route operations */
  operations: ParsedOperation[];
}

export interface ParsedOperation {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  operationId?: string;
  summary?: string;
  /** Whether the path has an :id param */
  hasIdParam: boolean;
  /** Whether this is a list endpoint (GET without :id in the resource path) */
  isList: boolean;
  /** Query parameter names */
  queryParams: string[];
}

export interface ParsedSpec {
  entities: ParsedEntity[];
  routes: ParsedRoute[];
}

export interface GeneratedOutput {
  [filename: string]: string;
}

// ---------------------------------------------------------------------------
// Spec parsing
// ---------------------------------------------------------------------------

/** Well-known ID prefixes matching src/emulate/core/id.ts */
const KNOWN_PREFIXES: Record<string, string> = {
  organization: 'org',
  organization_domain: 'org_domain',
  organization_membership: 'om',
  user: 'user',
  session: 'session',
  email_verification: 'email_verification',
  password_reset: 'password_reset',
  magic_auth: 'magic_auth',
  authentication_factor: 'auth_factor',
  authorization_code: 'auth_code',
  identity: 'identity',
  connection: 'conn',
  connection_domain: 'conn_domain',
  profile: 'prof',
  sso_profile: 'prof',
  sso_authorization: 'sso_auth',
  directory: 'directory',
  directory_user: 'directory_user',
  directory_group: 'directory_grp',
  event: 'event',
  invitation: 'inv',
};

/** Base entity fields that are auto-managed — excluded from generated fields. */
const BASE_FIELDS = new Set(['id', 'created_at', 'updated_at']);

/**
 * Resolve a $ref to a schema name. Only handles local refs like
 * "#/components/schemas/Organization".
 */
function resolveRefName(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

function resolveSchema(schema: SchemaObject, spec: OpenAPISpec): SchemaObject {
  if (schema.$ref) {
    const name = resolveRefName(schema.$ref);
    const resolved = spec.components?.schemas?.[name];
    return resolved ? resolveSchema(resolved, spec) : schema;
  }
  if (schema.allOf) {
    const merged: SchemaObject = { type: 'object', properties: {}, required: [] };
    for (const sub of schema.allOf) {
      const resolved = resolveSchema(sub, spec);
      if (resolved.properties) {
        Object.assign(merged.properties!, resolved.properties);
      }
      if (resolved.required) {
        merged.required!.push(...resolved.required);
      }
    }
    return merged;
  }
  return schema;
}

/** Convert an OpenAPI type + format to a TypeScript type string. */
export function schemaToTsType(schema: SchemaObject, spec: OpenAPISpec): string {
  if (schema.$ref) {
    const name = resolveRefName(schema.$ref);
    const resolved = spec.components?.schemas?.[name];
    if (resolved) return schemaToTsType(resolved, spec);
    return 'unknown';
  }

  if (schema.allOf) {
    const resolved = resolveSchema(schema, spec);
    return schemaToTsType(resolved, spec);
  }

  if (schema.oneOf || schema.anyOf) {
    const variants = (schema.oneOf ?? schema.anyOf)!;
    const types = variants.map((v) => schemaToTsType(v, spec));
    return types.join(' | ');
  }

  if (schema.enum) {
    return schema.enum.map((v) => `'${v}'`).join(' | ');
  }

  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      if (schema.items) {
        return `${schemaToTsType(schema.items, spec)}[]`;
      }
      return 'unknown[]';
    case 'object':
      if (schema.additionalProperties) {
        if (typeof schema.additionalProperties === 'boolean') {
          return 'Record<string, unknown>';
        }
        const valType = schemaToTsType(schema.additionalProperties, spec);
        return `Record<string, ${valType}>`;
      }
      if (schema.properties) {
        const entries = Object.entries(schema.properties).map(([k, v]) => {
          const t = schemaToTsType(v, spec);
          return `${k}: ${t}`;
        });
        return `{ ${entries.join('; ')} }`;
      }
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

/** Convert a schema name to snake_case. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/** Convert a snake_case string to PascalCase. */
export function toPascalCase(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/** Convert a snake_case string to camelCase. */
export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Pluralize a simple English word (naive). */
export function pluralize(word: string): string {
  if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z')) return word + 'es';
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

/** Singularize a simple English word (naive). */
export function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Heuristic: guess which fields should be indexed for a collection.
 * Looks at field names that end with _id or are common lookup fields.
 */
function guessIndexFields(fields: ParsedField[]): string[] {
  const indexes: string[] = [];
  for (const f of fields) {
    if (f.name === 'object') continue;
    if (f.name.endsWith('_id') && f.name !== 'external_id' && f.name !== 'stripe_customer_id' && f.name !== 'idp_id') {
      indexes.push(f.name);
    }
    if (f.name === 'email' || f.name === 'code' || f.name === 'domain') {
      indexes.push(f.name);
    }
  }
  // Also add external_id if present — the hand-written code indexes it for some collections
  if (fields.some((f) => f.name === 'external_id')) {
    indexes.push('external_id');
  }
  return indexes;
}

function extractEntityFromSchema(schemaName: string, schema: SchemaObject, spec: OpenAPISpec): ParsedEntity | null {
  const resolved = resolveSchema(schema, spec);
  if (resolved.type !== 'object' || !resolved.properties) return null;

  const objectType = toSnakeCase(schemaName);
  const required = new Set(resolved.required ?? []);

  const fields: ParsedField[] = [];
  for (const [propName, propSchema] of Object.entries(resolved.properties)) {
    if (BASE_FIELDS.has(propName)) continue;

    const resolvedProp = propSchema.$ref ? resolveSchema(propSchema, spec) : propSchema;
    const tsType = schemaToTsType(resolvedProp, spec);
    const nullable = resolvedProp.nullable === true || !required.has(propName);

    fields.push({
      name: propName,
      tsType,
      nullable,
      description: resolvedProp.description,
    });
  }

  if (fields.length === 0) return null;

  const idPrefix = KNOWN_PREFIXES[objectType] ?? objectType.replace(/_/g, '_').slice(0, 10);
  const indexFields = guessIndexFields(fields);

  return {
    name: schemaName,
    objectType,
    idPrefix,
    fields,
    indexFields,
  };
}

/** Convert OpenAPI path "/organizations/{id}" to Hono path "/organizations/:id". */
export function openApiPathToHono(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

function extractRoutes(spec: OpenAPISpec): Map<string, ParsedOperation[]> {
  const tagOps = new Map<string, ParsedOperation[]>();

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const methods: Array<'get' | 'post' | 'put' | 'patch' | 'delete'> = ['get', 'post', 'put', 'patch', 'delete'];

    for (const method of methods) {
      const op = item[method];
      if (!op) continue;

      const tag = op.tags?.[0] ?? inferTagFromPath(path);
      const honoPath = openApiPathToHono(path);
      const hasIdParam = /\/:id\b/.test(honoPath) || /\/:[\w]+_id\b/.test(honoPath);
      const isList = method === 'get' && !hasIdParam;

      const queryParams: string[] = [];
      const allParams = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      for (const p of allParams) {
        if (p.in === 'query') {
          queryParams.push(p.name);
        }
      }

      if (!tagOps.has(tag)) tagOps.set(tag, []);
      tagOps.get(tag)!.push({
        method,
        path: honoPath,
        operationId: op.operationId,
        summary: op.summary,
        hasIdParam,
        isList,
        queryParams,
      });
    }
  }

  return tagOps;
}

function inferTagFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  // Skip path params and use first real segment
  for (const seg of segments) {
    if (!seg.startsWith('{')) return seg;
  }
  return 'default';
}

export function parseSpec(spec: OpenAPISpec): ParsedSpec {
  const entities: ParsedEntity[] = [];

  // Extract entities from schemas
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      const entity = extractEntityFromSchema(name, schema, spec);
      if (entity) {
        entities.push(entity);
      }
    }
  }

  // Extract routes from paths
  const tagOps = extractRoutes(spec);
  const routes: ParsedRoute[] = [];

  for (const [tag, operations] of tagOps) {
    const singular = singularize(tag);
    const pascalSingular = toPascalCase(singular);
    const camelPlural = toCamelCase(tag);

    routes.push({
      tag,
      filename: `${tag.replace(/_/g, '-')}.ts`,
      functionName: `${toCamelCase(singular)}Routes`,
      storeAccessor: camelPlural,
      formatterName: `format${pascalSingular}`,
      operations,
    });
  }

  return { entities, routes };
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

export function generateEntities(entities: ParsedEntity[]): string {
  const lines: string[] = [];
  lines.push("import type { Entity } from '../../core/index.js';");
  lines.push('');

  for (const entity of entities) {
    lines.push(`export interface WorkOS${entity.name} extends Entity {`);

    // Always include `object` field with literal type
    const hasObjectField = entity.fields.some((f) => f.name === 'object');
    if (hasObjectField) {
      lines.push(`  object: '${entity.objectType}';`);
    }

    for (const field of entity.fields) {
      if (field.name === 'object') continue; // Already handled above with literal type

      let tsType = field.tsType;
      if (field.nullable && !tsType.includes('null')) {
        tsType = `${tsType} | null`;
      }
      lines.push(`  ${field.name}: ${tsType};`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

export function generateStore(entities: ParsedEntity[]): string {
  const lines: string[] = [];

  lines.push("import { type Store, type Collection } from '../../core/index.js';");

  // Import entity types
  const typeNames = entities.map((e) => `WorkOS${e.name}`);
  if (typeNames.length > 0) {
    lines.push('import type {');
    for (const t of typeNames) {
      lines.push(`  ${t},`);
    }
    lines.push("} from './entities.js';");
  }

  lines.push('');

  // Store interface
  lines.push('export interface WorkOSGeneratedStore {');
  for (const entity of entities) {
    const accessor = toCamelCase(pluralize(entity.objectType));
    lines.push(`  ${accessor}: Collection<WorkOS${entity.name}>;`);
  }
  lines.push('}');
  lines.push('');

  // getWorkOSGeneratedStore function
  lines.push('export function getWorkOSGeneratedStore(store: Store): WorkOSGeneratedStore {');
  lines.push('  return {');
  for (const entity of entities) {
    const accessor = toCamelCase(pluralize(entity.objectType));
    const namespace = `workos.${pluralize(entity.objectType)}`;
    const indexList = entity.indexFields.map((f) => `'${f}'`).join(', ');
    lines.push(
      `    ${accessor}: store.collection<WorkOS${entity.name}>('${namespace}', '${entity.idPrefix}', [${indexList}]),`,
    );
  }
  lines.push('  };');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

export function generateHelpers(entities: ParsedEntity[]): string {
  const lines: string[] = [];

  // Imports
  const typeNames = entities.map((e) => `WorkOS${e.name}`);
  lines.push('import type {');
  for (const t of typeNames) {
    lines.push(`  ${t},`);
  }
  lines.push("} from './entities.js';");
  lines.push('');

  // Generate a format function for each entity
  for (const entity of entities) {
    const typeName = `WorkOS${entity.name}`;
    const paramName = toCamelCase(entity.objectType);
    const fnName = `format${entity.name}`;

    lines.push(`export function ${fnName}(${paramName}: ${typeName}): Record<string, unknown> {`);
    lines.push('  return {');

    // object field
    if (entity.fields.some((f) => f.name === 'object')) {
      lines.push(`    object: '${entity.objectType}',`);
    }
    lines.push(`    id: ${paramName}.id,`);

    for (const field of entity.fields) {
      if (field.name === 'object') continue;
      lines.push(`    ${field.name}: ${paramName}.${field.name},`);
    }

    lines.push(`    created_at: ${paramName}.created_at,`);
    lines.push(`    updated_at: ${paramName}.updated_at,`);
    lines.push('  };');
    lines.push('}');
    lines.push('');
  }

  // parseListParams helper
  lines.push('export function parseListParams(url: URL) {');
  lines.push("  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '10'), 100));");
  lines.push("  const order = (url.searchParams.get('order') as 'asc' | 'desc') ?? 'desc';");
  lines.push("  const before = url.searchParams.get('before') ?? undefined;");
  lines.push("  const after = url.searchParams.get('after') ?? undefined;");
  lines.push('  return { limit, order, before, after };');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

export function generateRoutes(route: ParsedRoute): string {
  const lines: string[] = [];

  lines.push("import { type RouteContext, notFound, validationError, parseJsonBody } from '../../../core/index.js';");
  lines.push("import { getWorkOSGeneratedStore } from '../store.js';");
  lines.push(`import { ${route.formatterName}, parseListParams } from '../helpers.js';`);
  lines.push('');

  lines.push(`export function ${route.functionName}(ctx: RouteContext): void {`);
  lines.push('  const { app, store } = ctx;');
  lines.push('  const ws = getWorkOSGeneratedStore(store);');
  lines.push('');

  for (const op of route.operations) {
    lines.push(`  // ${op.summary ?? op.operationId ?? `${op.method.toUpperCase()} ${op.path}`}`);

    if (op.method === 'post') {
      lines.push(`  app.post('${op.path}', async (c) => {`);
      lines.push('    const body = await parseJsonBody(c);');
      lines.push('');
      lines.push(`    const item = ws.${route.storeAccessor}.insert({`);
      lines.push('      ...body,');
      lines.push('    });');
      lines.push('');
      lines.push(`    return c.json(${route.formatterName}(item), 201);`);
      lines.push('  });');
    } else if (op.method === 'get' && op.isList) {
      lines.push(`  app.get('${op.path}', (c) => {`);
      lines.push('    const url = new URL(c.req.url);');
      lines.push('    const params = parseListParams(url);');
      lines.push('');
      lines.push(`    const result = ws.${route.storeAccessor}.list({`);
      lines.push('      ...params,');
      lines.push('    });');
      lines.push('');
      lines.push('    return c.json({');
      lines.push("      object: 'list',");
      lines.push(`      data: result.data.map(${route.formatterName}),`);
      lines.push('      list_metadata: result.list_metadata,');
      lines.push('    });');
      lines.push('  });');
    } else if (op.method === 'get' && op.hasIdParam) {
      lines.push(`  app.get('${op.path}', (c) => {`);
      lines.push(`    const item = ws.${route.storeAccessor}.get(c.req.param('id'));`);
      lines.push(`    if (!item) throw notFound('${toPascalCase(singularize(route.tag))}');`);
      lines.push(`    return c.json(${route.formatterName}(item));`);
      lines.push('  });');
    } else if (op.method === 'put' && op.hasIdParam) {
      lines.push(`  app.put('${op.path}', async (c) => {`);
      lines.push(`    const item = ws.${route.storeAccessor}.get(c.req.param('id'));`);
      lines.push(`    if (!item) throw notFound('${toPascalCase(singularize(route.tag))}');`);
      lines.push('');
      lines.push('    const body = await parseJsonBody(c);');
      lines.push(`    const updated = ws.${route.storeAccessor}.update(item.id, body);`);
      lines.push(`    return c.json(${route.formatterName}(updated!));`);
      lines.push('  });');
    } else if (op.method === 'patch' && op.hasIdParam) {
      lines.push(`  app.patch('${op.path}', async (c) => {`);
      lines.push(`    const item = ws.${route.storeAccessor}.get(c.req.param('id'));`);
      lines.push(`    if (!item) throw notFound('${toPascalCase(singularize(route.tag))}');`);
      lines.push('');
      lines.push('    const body = await parseJsonBody(c);');
      lines.push(`    const updated = ws.${route.storeAccessor}.update(item.id, body);`);
      lines.push(`    return c.json(${route.formatterName}(updated!));`);
      lines.push('  });');
    } else if (op.method === 'delete' && op.hasIdParam) {
      lines.push(`  app.delete('${op.path}', (c) => {`);
      lines.push(`    const item = ws.${route.storeAccessor}.get(c.req.param('id'));`);
      lines.push(`    if (!item) throw notFound('${toPascalCase(singularize(route.tag))}');`);
      lines.push(`    ws.${route.storeAccessor}.delete(item.id);`);
      lines.push('    return c.body(null, 204);');
      lines.push('  });');
    } else {
      // Fallback: generate a TODO stub
      lines.push(`  // TODO: implement ${op.method.toUpperCase()} ${op.path}`);
    }

    lines.push('');
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
