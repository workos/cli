import { parse as parseYaml } from 'yaml';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { EMBEDDED_OPENAPI_SPEC } from './embedded-spec.js';

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

const DEFAULT_SPEC_URL = 'https://cdn.jsdelivr.net/npm/@workos/openapi-spec@latest/open-api-spec.yaml';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Injectable spec sources for {@link loadCatalogFrom}, so the fallback logic can
 * be unit-tested without touching the network or filesystem.
 */
export interface CatalogSource {
  /** Cached spec text plus its age, or null when no cache exists. */
  readCache(): Promise<{ text: string; ageMs: number } | null>;
  /** Max cache age (ms) before a refetch is attempted. */
  ttlMs: number;
  /** Fetch the latest spec text. Throws on network failure or non-2xx. */
  fetchLatest(): Promise<string>;
  /** Persist freshly fetched spec text for next time. */
  writeCache(text: string): Promise<void>;
  /** Build-time spec, baked in as the always-available last resort. */
  embedded: string;
}

/**
 * Parse spec text into a Catalog, returning null when it's missing or yields no
 * usable endpoints — so a corrupt cache or garbage HTTP response is treated as
 * "no spec" rather than silently shadowing a working one.
 */
function toCatalog(text: string | null | undefined): Catalog | null {
  if (!text) return null;
  try {
    const catalog = parseSpec(text);
    return catalog.endpoints.length > 0 ? catalog : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the API catalog from the first usable source, in order:
 *   fresh cache -> freshly fetched (then cached) -> stale cache -> embedded.
 */
export async function loadCatalogFrom(source: CatalogSource): Promise<Catalog> {
  const cache = await source.readCache();

  if (cache && cache.ageMs <= source.ttlMs) {
    const fresh = toCatalog(cache.text);
    if (fresh) return fresh;
  }

  try {
    const text = await source.fetchLatest();
    const fetched = toCatalog(text);
    if (fetched) {
      await source.writeCache(text);
      return fetched;
    }
  } catch {
    // network/HTTP failure — fall through to cache, then embedded
  }

  if (cache) {
    const cached = toCatalog(cache.text);
    if (cached) return cached;
  }

  const embedded = toCatalog(source.embedded);
  if (embedded) return embedded;

  throw new Error('Unable to load the WorkOS API catalog from any source (fetch, cache, or embedded).');
}

/** Default on-disk cache location: ~/.workos/cache/openapi-spec.yaml */
function specCachePath(): string {
  return join(homedir(), '.workos', 'cache', 'openapi-spec.yaml');
}

/** Production source: jsDelivr (override via WORKOS_OPENAPI_SPEC_URL) + ~/.workos cache + embedded fallback. */
function defaultSource(): CatalogSource {
  const url = process.env.WORKOS_OPENAPI_SPEC_URL ?? DEFAULT_SPEC_URL;
  const cachePath = specCachePath();
  return {
    ttlMs: DEFAULT_TTL_MS,
    embedded: EMBEDDED_OPENAPI_SPEC,
    async readCache() {
      try {
        const [text, info] = await Promise.all([readFile(cachePath, 'utf-8'), stat(cachePath)]);
        return { text, ageMs: Date.now() - info.mtimeMs };
      } catch {
        return null;
      }
    },
    async fetchLatest() {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Spec fetch failed: ${res.status} ${res.statusText}`);
      return res.text();
    },
    async writeCache(text: string) {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, text, 'utf-8');
    },
  };
}

let cachedCatalog: Promise<Catalog> | undefined;

export function loadCatalog(): Promise<Catalog> {
  // Cache the in-flight Promise (not just the resolved value) so concurrent
  // callers reuse the same fetch/parse pass — see request.ts callers.
  if (cachedCatalog) return cachedCatalog;
  cachedCatalog = loadCatalogFrom(defaultSource());
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
