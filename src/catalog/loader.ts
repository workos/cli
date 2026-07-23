import snapshot from './mcp-catalog.snapshot.json' with { type: 'json' };
import type { CatalogOperation, ManagementCatalog, RawManagementCatalog } from './catalog-types.js';

/**
 * Loads the Management operation catalog behind a single seam.
 *
 * Command code (Phase 3+) imports {@link loadManagementCatalog} and depends only
 * on its {@link ManagementCatalog} return type — never on the snapshot file or a
 * fetch client. Swapping the source later (Phase 6 adds a `LiveCatalogSource`
 * backed by `GET /mcp/catalog`) is a one-file change here.
 */
export interface CatalogSource {
  load(): RawManagementCatalog;
}

export interface LoadCatalogOptions {
  /**
   * Include feature-flag-gated operations in the result. Off by default so the
   * CLI's candidate set matches what the live MCP exposes (the live MCP hides
   * flag-gated operations from its index). Tooling that needs the raw set can
   * opt in.
   */
  includeFeatureFlagged?: boolean;
}

/**
 * Default source: the vendored static snapshot. Imported as JSON so the bundler
 * inlines it (the import is statically resolved at build time). Refresh it with
 * `pnpm catalog:vendor`.
 */
export const snapshotSource: CatalogSource = {
  load(): RawManagementCatalog {
    return snapshot as RawManagementCatalog;
  },
};

/**
 * Returns the catalog as a normalized {@link ManagementCatalog}: operations are
 * flattened from the raw name-keyed Record into an array, and feature-flag-gated
 * operations are filtered out unless {@link LoadCatalogOptions.includeFeatureFlagged}
 * is set. Fragments and input types are carried through unchanged.
 */
export function loadManagementCatalog(
  source: CatalogSource = snapshotSource,
  options: LoadCatalogOptions = {},
): ManagementCatalog {
  const raw = source.load();
  const all: CatalogOperation[] = Object.values(raw.operations);
  const operations = options.includeFeatureFlagged ? all : all.filter((op) => !op.featureFlagGated);
  return { operations, fragments: raw.fragments, inputTypes: raw.inputTypes };
}
