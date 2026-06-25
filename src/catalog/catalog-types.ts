/**
 * TypeScript types for the vendored Management operation catalog.
 *
 * Mirrors the upstream data model in the `workos` monorepo
 * (`packages/api/src/mcp/catalog-types.ts`) so `scripts/vendor-catalog.ts` can
 * later diff the snapshot structurally. The catalog is generated upstream at
 * codegen time from the dashboard's checked-in GraphQL operation documents; we
 * vendor a static snapshot (`mcp-catalog.snapshot.json`) and never take a live
 * dependency on the schema here.
 *
 * The GraphQL `document` field is internal and must never be surfaced to users.
 */

export type OperationKind = 'query' | 'mutation';

export interface CatalogVariable {
  /** Variable name without the leading `$`, e.g. "input". */
  name: string;
  /** SDL-rendered type, e.g. "CreateOrganizationInput!". */
  type: string;
  /** NonNull with no default value. */
  required: boolean;
  /** SDL-printed default value, when one is declared. */
  defaultValue?: string;
}

export interface CatalogInputField {
  name: string;
  /** SDL-rendered type, e.g. "[String!]". */
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
}

export interface CatalogInputType {
  name: string;
  kind: 'INPUT_OBJECT' | 'ENUM' | 'SCALAR';
  description?: string;
  /** Present for INPUT_OBJECT types. */
  fields?: CatalogInputField[];
  /** Present for ENUM types. */
  enumValues?: string[];
}

export interface CatalogOperation {
  /** GraphQL operation name — the catalog key and the wire `operationName`. */
  name: string;
  kind: OperationKind;
  /** Root-field schema description, or a generated fallback. */
  description: string;
  /**
   * Present when a selected root field is gated behind confirmation: the
   * consequence phrase surfaced before a destructive operation runs. Sparse —
   * only a handful of operations declare it.
   */
  confirmation?: string;
  /**
   * Present (and `true`) when a selected root field is gated behind a feature
   * flag. The live MCP hides these from its index; the loader filters them out
   * by default so the CLI's candidate set matches what the live MCP exposes.
   */
  featureFlagGated?: true;
  /** Schema field names selected at the document root (de-aliased, deduped). */
  rootFields: string[];
  /** Named return types of the root fields, e.g. ["OrganizationsList"]. */
  returnTypes: string[];
  /** print()-normalized operation text, WITHOUT its fragments. Internal — never shown to users. */
  document: string;
  /** Transitive fragment dependencies, sorted by name. */
  fragmentNames: string[];
  variables: CatalogVariable[];
}

/**
 * Raw, on-disk shape of the vendored snapshot — identical to the upstream
 * `OperationCatalog`. Operations are keyed by name. The loader normalizes this
 * into a {@link ManagementCatalog} before any command code sees it.
 */
export interface RawManagementCatalog {
  /** Keyed by operation name. */
  operations: Record<string, CatalogOperation>;
  /** Fragment name -> print()-normalized fragment text. */
  fragments: Record<string, string>;
  /**
   * Every named input/enum/custom-scalar type transitively reachable from any
   * operation's variables, keyed by type name.
   */
  inputTypes: Record<string, CatalogInputType>;
}

/**
 * The loader's return shape — the seam command code depends on. `operations` is
 * a flat array (normalized from the raw Record) so callers can filter and map
 * over it without re-deriving the keying. Fragments and input types are carried
 * through unchanged.
 */
export interface ManagementCatalog {
  operations: CatalogOperation[];
  fragments: Record<string, string>;
  inputTypes: Record<string, CatalogInputType>;
}
