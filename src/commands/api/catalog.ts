import { parse as parseYaml } from 'yaml';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

export interface Param {
  name: string;
  description: string;
  required: boolean;
}

export interface EndpointInfo {
  method: string;
  path: string;
  summary: string;
  tag: string;
  operationId: string;
  pathParams: Param[];
  queryParams: Param[];
  hasRequestBody: boolean;
  requestBodyRequired: boolean;
}

export interface Catalog {
  endpoints: EndpointInfo[];
  tags: string[];
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface RawParam {
  name?: string;
  in?: string;
  description?: string;
  required?: boolean;
  $ref?: string;
}

/**
 * Resolve an OpenAPI 3.x parameter object that may itself be a $ref pointing
 * into components.parameters. Returns undefined if the ref can't be resolved
 * (so the parameter is skipped instead of producing a {param} placeholder
 * that leaks into request URLs).
 */
function resolveParam(param: RawParam, componentParams: Record<string, RawParam>): RawParam | undefined {
  if (!param || typeof param !== 'object') return undefined;
  if (typeof param.$ref === 'string') {
    const match = /^#\/components\/parameters\/(.+)$/.exec(param.$ref);
    if (!match) return undefined;
    const target = componentParams[match[1]!];
    if (!target) return undefined;
    // Recurse so a chain of $refs still resolves to a concrete definition.
    return resolveParam(target, componentParams);
  }
  return param;
}

export function parseSpec(yamlText: string): Catalog {
  const spec = parseYaml(yamlText) as {
    paths?: Record<string, unknown>;
    components?: { parameters?: Record<string, RawParam> };
  };
  const endpoints: EndpointInfo[] = [];
  const componentParams = spec.components?.parameters ?? {};

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const pathObj = pathItem as Record<string, unknown>;

    for (const method of HTTP_METHODS) {
      const operation = pathObj[method];
      if (!operation || typeof operation !== 'object') continue;

      const op = operation as Record<string, unknown>;
      const tag = ((op.tags as string[]) ?? ['other'])[0] ?? 'other';

      // Resolve $ref and merge path-level + operation-level params.
      // Operation-level params override path-level ones with the same (name, in)
      // pair, per the OpenAPI 3.x spec.
      const rawPathLevel = (pathObj.parameters as RawParam[] | undefined) ?? [];
      const rawOpLevel = (op.parameters as RawParam[] | undefined) ?? [];
      const merged = new Map<string, RawParam>();
      for (const raw of [...rawPathLevel, ...rawOpLevel]) {
        const resolved = resolveParam(raw, componentParams);
        if (!resolved || !resolved.name || !resolved.in) continue;
        merged.set(`${resolved.in}:${resolved.name}`, resolved);
      }
      const allParams = [...merged.values()];

      const pathParams: Param[] = allParams
        .filter((p) => p.in === 'path')
        .map((p) => ({ name: p.name!, description: p.description ?? '', required: p.required ?? true }));

      const queryParams: Param[] = allParams
        .filter((p) => p.in === 'query')
        .map((p) => ({ name: p.name!, description: p.description ?? '', required: p.required ?? false }));

      const reqBody = op.requestBody as Record<string, unknown> | undefined;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: (op.summary as string) ?? '',
        tag,
        operationId: (op.operationId as string) ?? '',
        pathParams,
        queryParams,
        hasRequestBody: !!reqBody,
        requestBodyRequired: !!reqBody?.required,
      });
    }
  }

  const tags = [...new Set(endpoints.map((e) => e.tag))].sort();
  return { endpoints, tags };
}

let cachedCatalog: Promise<Catalog> | undefined;

export function loadCatalog(): Promise<Catalog> {
  // Cache the in-flight Promise (not just the resolved value) so concurrent
  // callers reuse the same readFile/parse pass — see request.ts callers.
  if (cachedCatalog) return cachedCatalog;

  cachedCatalog = (async () => {
    const require = createRequire(import.meta.url);
    const specPath = require.resolve('@workos/openapi-spec/spec');
    const yamlText = await readFile(specPath, 'utf-8');
    return parseSpec(yamlText);
  })();

  return cachedCatalog;
}

export function endpointsByTag(endpoints: EndpointInfo[]): Map<string, EndpointInfo[]> {
  const grouped = new Map<string, EndpointInfo[]>();
  for (const ep of endpoints) {
    const list = grouped.get(ep.tag) ?? [];
    list.push(ep);
    grouped.set(ep.tag, list);
  }
  return grouped;
}
