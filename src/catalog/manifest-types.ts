/**
 * Types for the command justification manifest — the two-axis rubric that makes
 * "justify every command" enforceable.
 *
 * Every catalog-driven command the CLI ships must have a complete
 * {@link CommandJustification} record. `validateManifest` (justification.ts)
 * rejects any record missing a field, an empty `useCase`/`audiences`, an
 * out-of-enum `load`/`ciPolicy`, or a `mapsTo` that is not a real catalog
 * operation. The CI gate (`pnpm justification:check`) fails the build on any
 * such error.
 *
 * The manifest records the clean WorkOS command noun (`command`) and the
 * internal catalog operation it resolves to (`mapsTo`). The `command` string is
 * always the user-facing noun — it must never contain GraphQL or `userland*`
 * naming. The curation layer (curation.ts) produces these clean names.
 */

/** Who a command earns its place for. At least one is required. */
export type Audience = 'human' | 'agent' | 'ci';

/**
 * Cost class of the underlying operation. `cheap` = a single bounded
 * read/write; `expensive` = potentially large or slow; `bulk` = fans out over a
 * collection. The load-capping engine that acts on this lands in a later phase;
 * the manifest records it now so the data is present.
 */
export type Load = 'cheap' | 'expensive' | 'bulk';

/**
 * How the command behaves in CI / non-interactive contexts. `allow` = runs
 * freely; `require-flag` = needs an explicit confirmation flag (e.g. `--yes`);
 * `block-noninteractive` = refused outright outside an interactive terminal.
 */
export type CiPolicy = 'allow' | 'require-flag' | 'block-noninteractive';

/**
 * The two-axis justification record. A command cannot ship without a complete
 * one — see {@link validateManifest} for the enforced field list.
 */
export interface CommandJustification {
  /** Clean user-facing WorkOS noun, e.g. "team invite". Never GraphQL/userland. */
  command: string;
  /** Catalog operation name this command resolves to, e.g. "inviteUserToTeam". */
  mapsTo: string;
  /** Who this command is for. Non-empty. */
  audiences: Audience[];
  /** Why this operation earns a first-class command. Non-empty. */
  useCase: string;
  /** Cost class of the underlying operation. */
  load: Load;
  /** Whether the operation mutates state. */
  mutation: boolean;
  /**
   * Whether the operation is destructive enough to require confirmation.
   * Curation-set with a heuristic default (remove/delete/deactivate, or
   * production-environment writes) — NOT inherited from `catalog.confirmation`,
   * which is set on only a handful of the 357 operations and is too sparse to
   * rely on.
   */
  destructive: boolean;
  /** CI / non-interactive behavior. */
  ciPolicy: CiPolicy;
}
