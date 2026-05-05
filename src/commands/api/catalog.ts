/**
 * OpenAPI catalog: parsing the embedded spec into a queryable endpoint list.
 */

import { parse as parseYaml } from 'yaml';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

export interface PathParam {
  name: string;
  description: string;
  required: boolean;
}

export interface QueryParam {
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
  pathParams: PathParam[];
  queryParams: QueryParam[];
  hasRequestBody: boolean;
}

export interface Catalog {
  endpoints: EndpointInfo[];
  tags: string[];
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export function parseSpec(yamlText: string): Catalog {
  const spec = parseYaml(yamlText);
  const endpoints: EndpointInfo[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const pathObj = pathItem as Record<string, unknown>;

    for (const method of HTTP_METHODS) {
      const operation = pathObj[method];
      if (!operation || typeof operation !== 'object') continue;

      const op = operation as Record<string, unknown>;
      const tag = ((op.tags as string[]) ?? ['other'])[0] ?? 'other';

      const allParams = [...((pathObj.parameters as unknown[]) ?? []), ...((op.parameters as unknown[]) ?? [])];

      const pathParams: PathParam[] = allParams
        .filter((p: any) => p.in === 'path')
        .map((p: any) => ({ name: p.name, description: p.description ?? '', required: p.required ?? true }));

      const queryParams: QueryParam[] = allParams
        .filter((p: any) => p.in === 'query')
        .map((p: any) => ({ name: p.name, description: p.description ?? '', required: p.required ?? false }));

      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: (op.summary as string) ?? '',
        tag,
        operationId: (op.operationId as string) ?? '',
        pathParams,
        queryParams,
        hasRequestBody: !!op.requestBody,
      });
    }
  }

  const tags = [...new Set(endpoints.map((e) => e.tag))].sort();
  return { endpoints, tags };
}

let cachedCatalog: Catalog | undefined;

export function loadCatalog(): Catalog {
  if (cachedCatalog) return cachedCatalog;

  const require = createRequire(import.meta.url);
  const specPath = require.resolve('@workos/openapi-spec/spec');
  const yamlText = readFileSync(specPath, 'utf-8');
  cachedCatalog = parseSpec(yamlText);
  return cachedCatalog;
}

export function endpointsByTag(catalog: Catalog): Map<string, EndpointInfo[]> {
  const grouped = new Map<string, EndpointInfo[]>();
  for (const ep of catalog.endpoints) {
    const list = grouped.get(ep.tag) ?? [];
    list.push(ep);
    grouped.set(ep.tag, list);
  }
  return grouped;
}
