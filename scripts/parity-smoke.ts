/**
 * Parity smoke: compare command output between this branch (dashboard GraphQL
 * plane) and ../main (REST plane), against the same WorkOS environment.
 *
 * Buckets:
 *
 *   CONTROL  — commands that stayed REST on both branches (connection,
 *              directory, audit-log). Same code both sides → strict shape+data
 *              parity. A failure here means env/auth misalignment, so every
 *              result below is untrustworthy. Check these first.
 *   LIST     — the migrated commands' list views. Shapes intentionally differ
 *              (approved feat!), so this matches rows by id and compares EVERY
 *              field present on both sides. Known-intentional differences are
 *              declared in ACCEPTED and reported as INFO, not FAIL; anything
 *              else is a FAIL. Branch-only keys (curated additions) and
 *              main-only keys (intentionally dropped internals) are reported
 *              as INFO.
 *   GET      — detail views. Sources an id/slug from the branch list, calls
 *              `get` on both binaries, compares the same way.
 *   WRITE    — opt-in (--mutate). Cross-plane read-after-write: create an
 *              organization on one plane, read it back on the OTHER, then
 *              delete it. Running `create` on both and diffing would compare
 *              two DIFFERENT entities and prove nothing; reading across planes
 *              is the actual claim the migration makes.
 *   NEW      — branch-only commands. Exit 0 + valid JSON on the branch binary.
 *
 * Not covered: user has no create subcommand on either side (no round-trip
 * possible); session/webhook/event have no `get`; org-domain has `get` but no
 * `list`, so no id source; portal generate-link and config are mutation-only.
 *
 * Prereqs:
 *   1. From this branch: `workos auth login` (dashboard OAuth session).
 *   2. export WORKOS_API_KEY=sk_...  for main's REST plane. Its environment
 *      MUST match the dashboard session's active env, or every row diverges.
 *   3. ../main = a checkout of this repo on main.
 *
 * Usage:
 *   bun run scripts/parity-smoke.ts                    # read-only
 *   bun run scripts/parity-smoke.ts --seed             # + seed fixtures so lists are non-empty
 *   bun run scripts/parity-smoke.ts --seed --mutate    # + cross-plane write round-trip
 *
 * Env: PARITY_BRANCH_BIN, PARITY_MAIN_BIN (default: bun <dir>/src/bin.ts),
 *      PARITY_ENV_ID (pins --environment-id on branch commands).
 *
 * Exit: 0 if every executed check passed, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BRANCH_DIR = path.resolve(import.meta.dirname, '..');
const MAIN_DIR = path.resolve(BRANCH_DIR, '../main');
const ENV_ID = process.env.PARITY_ENV_ID;
const MUTATE = process.argv.includes('--mutate');
const SEED = process.argv.includes('--seed');
// Invitations are seeded separately because sending one attempts real email
// delivery. The address used is @example.com (RFC 2606 reserved, black-holed),
// and the invitation is revoked during cleanup, but it stays opt-in.
const INVITE = process.argv.includes('--invite');

if (!existsSync(path.join(MAIN_DIR, 'src/bin.ts'))) {
  console.error(`main checkout not found: ${MAIN_DIR}/src/bin.ts`);
  process.exit(2);
}
for (const dir of [BRANCH_DIR, MAIN_DIR]) {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.name !== 'workos') {
    console.error(`${dir} is not the workos CLI (package.json name="${pkg.name}")`);
    process.exit(2);
  }
}

// --- credential + cwd isolation ---------------------------------------------------
// Bun auto-loads `.env.local` from the CWD. Each worktree ships its own, with a
// DIFFERENT WORKOS_API_KEY, so running each binary from its own directory made
// the two planes authenticate against two different environments and compare
// unrelated data. Run everything from an empty scratch dir (nothing to load) and
// inject ONE key into both children.
const NEUTRAL_CWD = mkdtempSync(path.join(os.tmpdir(), 'parity-smoke-'));

function envLocalKey(dir: string): string | undefined {
  const f = path.join(dir, '.env.local');
  if (!existsSync(f)) return undefined;
  const m = readFileSync(f, 'utf8').match(/^WORKOS_API_KEY=(.*)$/m);
  return m?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
}

// Precedence: explicit env var > this branch's .env.local. Never main's, so the
// REST plane is pinned to the same environment the branch targets.
const API_KEY = process.env.WORKOS_API_KEY ?? envLocalKey(BRANCH_DIR);
const API_KEY_SOURCE = process.env.WORKOS_API_KEY ? 'env' : envLocalKey(BRANCH_DIR) ? 'branch .env.local' : 'NONE';

function binFor(dir: string): { cmd: string; args: string[] } {
  const override = dir === BRANCH_DIR ? process.env.PARITY_BRANCH_BIN : process.env.PARITY_MAIN_BIN;
  if (override) {
    const [cmd, ...args] = override.trim().split(/\s+/);
    return { cmd, args };
  }
  return { cmd: 'bun', args: [path.join(dir, 'src/bin.ts')] };
}

interface RunResult {
  rc: number;
  stdout: string;
  stderr: string;
}
function run(dir: string, cliArgs: string[]): Promise<RunResult> {
  const { cmd, args } = binFor(dir);
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (API_KEY) childEnv.WORKOS_API_KEY = API_KEY;
    const p = spawn(cmd, [...args, ...cliArgs], { cwd: NEUTRAL_CWD, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => {
      stdout += d;
    });
    p.stderr.on('data', (d) => {
      stderr += d;
    });
    p.on('error', (err) => resolve({ rc: -1, stdout, stderr: String(err) }));
    p.on('close', (rc) => resolve({ rc: rc ?? 0, stdout, stderr }));
  });
}

function parseJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

const envArgs = (): string[] => (ENV_ID ? ['--environment-id', ENV_ID] : []);
const shortErr = (s: string): string => s.split('\n').filter(Boolean).slice(0, 2).join(' | ');

// --- value normalization ---------------------------------------------------------
// Volatile or timing-dependent keys are never compared.
const VOLATILE = new Set([
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
  'lastSignedInAt',
  'last_signed_in_at',
  'emailVerifiedAt',
  'email_verified_at',
  'occurredAt',
  'occurred_at',
  'expiresAt',
  'expires_at',
  'timestamp',
  'before',
  'after',
  'listMetadata',
  'list_metadata',
  'pagination',
]);

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(normalize).sort(cmp);
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (!VOLATILE.has(k)) o[k] = normalize((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v;
}
function cmp(a: unknown, b: unknown): number {
  const ka = JSON.stringify(a);
  const kb = JSON.stringify(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
const canon = (v: unknown): string => JSON.stringify(normalize(v));

function itemsOf(out: any): any[] {
  if (out && typeof out === 'object') {
    if (Array.isArray(out.data)) return out.data;
    for (const k of Object.keys(out)) if (Array.isArray(out[k])) return out[k];
  }
  return [];
}

/** Unwrap a single-entity payload: branch `{organization:{...}}`, main raw or `{data:{...}}`. */
function entityOf(out: any): any {
  if (!out || typeof out !== 'object') return undefined;
  if (out.id) return out;
  if (out.data && typeof out.data === 'object' && !Array.isArray(out.data)) return out.data;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && v.id) return v;
  }
  return undefined;
}

/** Recursively find the first string value matching `<prefix>_...` — envelope-agnostic. */
function findId(out: any, prefix: string): string | undefined {
  if (typeof out === 'string') return out.startsWith(`${prefix}_`) ? out : undefined;
  if (Array.isArray(out)) {
    for (const v of out) {
      const r = findId(v, prefix);
      if (r) return r;
    }
    return undefined;
  }
  if (out && typeof out === 'object') {
    for (const k of Object.keys(out)) {
      const r = findId(out[k], prefix);
      if (r) return r;
    }
  }
  return undefined;
}

// --- accepted divergences --------------------------------------------------------
// Field-level differences that are intentional per the branch specs. Reported as
// INFO so they stay visible, never as FAIL. Anything NOT listed here that differs
// is a real regression.
// Every entry is a DELIBERATE vocabulary or structural curation, documented in
// the migration guide. Enum CASING is deliberately absent: the CLI normalizes
// all enum values to lowercase via utils/output-conventions, so a casing-only
// difference is a bug, not an accepted divergence, and must fail the run.
const ACCEPTED: Record<string, string> = {
  'role.type':
    'vocabulary: branch emits environment/organization; REST emitted EnvironmentRole/OrganizationRole. The redundant Role suffix is dropped.',
  'webhook.state':
    "vocabulary: branch emits active; REST emitted enabled. Aligned with session's active/expired/revoked.",
  'invitation.organization': 'structural: branch nests {id,name}; REST emitted a flat organizationId',
  'user.identities': 'structural: branch nests curated identities and renames status->state; REST shape differs',
  'feature-flag.enabled': 'semantic: branch derives from the active environment state; REST exposed a flat flag',
};

/**
 * Branch key -> main key, for fields the curated shapes RENAMED. Without this a
 * renamed field is "branch-only" on one side and "dropped" on the other, so it
 * is never compared and the row passes vacuously.
 */
const ALIAS: Record<string, Record<string, string>> = {
  webhook: { url: 'endpoint_url', state: 'status' },
  invitation: { email: 'email' },
};

interface FieldDiff {
  key: string;
  branch: unknown;
  main: unknown;
}
interface RowCompare {
  diffs: FieldDiff[];
  accepted: FieldDiff[];
  branchOnly: string[];
  mainOnly: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reduce both sides to the structure they SHARE, recursively. The curated
 * shapes drop internal fields at every depth (an organization domain keeps
 * {id,domain,state} and drops object/organizationId/verificationStrategy), so a
 * wholesale compare of a nested object reports intentional curation as a diff.
 * Projecting to shared keys first means only genuine value divergences survive.
 * A type mismatch (array vs object) is preserved so it still reports.
 */
function projectShared(b: any, m: any): [any, any] {
  if (Array.isArray(b) && Array.isArray(m)) {
    if (b.length !== m.length) return [b, m];
    // Pair elements by id when both sides carry one; otherwise pair by sorted order.
    const byId = b.every((x) => isPlainObject(x) && x.id) && m.every((x) => isPlainObject(x) && x.id);
    const bs = byId ? [...b].sort((x, y) => cmp(x.id, y.id)) : [...b].sort(cmp);
    const ms = byId ? [...m].sort((x, y) => cmp(x.id, y.id)) : [...m].sort(cmp);
    const pb: any[] = [];
    const pm: any[] = [];
    for (let i = 0; i < bs.length; i++) {
      const [x, y] = projectShared(bs[i], ms[i]);
      pb.push(x);
      pm.push(y);
    }
    return [pb, pm];
  }
  if (isPlainObject(b) && isPlainObject(m)) {
    const pb: Record<string, unknown> = {};
    const pm: Record<string, unknown> = {};
    for (const k of Object.keys(b)) {
      if (VOLATILE.has(k) || !(k in m)) continue;
      const [x, y] = projectShared(b[k], m[k]);
      pb[k] = x;
      pm[k] = y;
    }
    return [pb, pm];
  }
  return [b, m];
}

function compareEntity(cmd: string, b: any, m: any): RowCompare {
  const diffs: FieldDiff[] = [];
  const accepted: FieldDiff[] = [];
  const branchOnly: string[] = [];
  const mainOnly: string[] = [];
  const aliased = new Set<string>();
  for (const k of Object.keys(b)) {
    if (VOLATILE.has(k)) continue;
    const mk = k in m ? k : ALIAS[cmd]?.[k];
    if (!mk || !(mk in m)) {
      branchOnly.push(k);
      continue;
    }
    aliased.add(mk);
    const [pb, pm] = projectShared(b[k], m[mk]);
    if (canon(pb) !== canon(pm)) {
      const label = mk === k ? k : `${k}↔${mk}`;
      const d = { key: label, branch: b[k], main: m[mk] };
      (ACCEPTED[`${cmd}.${k}`] ? accepted : diffs).push(d);
    }
  }
  for (const k of Object.keys(m)) {
    if (VOLATILE.has(k)) continue;
    if (!(k in b) && !aliased.has(k)) mainOnly.push(k);
  }
  return { diffs, accepted, branchOnly, mainOnly };
}

// --- registry --------------------------------------------------------------------
const CONTROL = [
  { label: 'connection list', args: ['connection', 'list', '--json'] },
  { label: 'directory list', args: ['directory', 'list', '--json'] },
  { label: 'audit-log list-actions', args: ['audit-log', 'list-actions', '--json'] },
];

interface ListCheck {
  cmd: string;
  label: string;
  args: string[];
  /** id/slug key used to match rows across sides and to feed the GET check. */
  idKey: string;
  /** `get` subcommand, if the command has one. */
  get?: { sub: string; argFrom: string };
  /**
   * Set when the two planes page in different sort orders, so a bounded `--limit`
   * window legitimately returns different rows. Exact-set matching would be
   * comparing the newest N against the oldest N. Instead: require a non-empty
   * overlap and compare every field on the rows that DO appear on both.
   */
  orderDiverges?: { note: string };
}

const LISTS: ListCheck[] = [
  {
    cmd: 'organization',
    label: 'organization',
    args: ['organization', 'list', '--json'],
    idKey: 'id',
    get: { sub: 'get', argFrom: 'id' },
  },
  { cmd: 'user', label: 'user', args: ['user', 'list', '--json'], idKey: 'id', get: { sub: 'get', argFrom: 'id' } },
  { cmd: 'role', label: 'role', args: ['role', 'list', '--json'], idKey: 'slug', get: { sub: 'get', argFrom: 'slug' } },
  {
    cmd: 'permission',
    label: 'permission',
    args: ['permission', 'list', '--json'],
    idKey: 'slug',
    get: { sub: 'get', argFrom: 'slug' },
  },
  {
    cmd: 'invitation',
    label: 'invitation',
    args: ['invitation', 'list', '--json'],
    idKey: 'id',
    get: { sub: 'get', argFrom: 'id' },
  },
  {
    cmd: 'feature-flag',
    label: 'feature-flag',
    args: ['feature-flag', 'list', '--json'],
    idKey: 'slug',
    get: { sub: 'get', argFrom: 'slug' },
  },
  { cmd: 'webhook', label: 'webhook', args: ['webhook', 'list', '--json'], idKey: 'id' },
  // organization.created and user.created both fire during --seed/--mutate, so
  // this has real rows to compare rather than empty-vs-empty.
  {
    cmd: 'event',
    label: 'event',
    args: ['event', 'list', '--events', 'organization.created,user.created', '--limit', '100', '--json'],
    idKey: 'id',
    orderDiverges: {
      note: 'GraphQL returns events newest-first; REST returned oldest-first. A bounded --limit window therefore covers opposite ends of the feed.',
    },
  },
];

const NEW_ONLY = [
  { label: 'whoami', args: ['whoami', '--json'] },
  { label: 'project list', args: ['project', 'list', '--json'] },
  { label: 'team members', args: ['team', 'members', '--json'] },
  { label: 'authkit redirect-uris list', args: ['authkit', 'redirect-uris', 'list', '--json', ...envArgs()] },
  { label: 'branding get', args: ['branding', 'get', '--json', ...envArgs()] },
];

// --- reporting -------------------------------------------------------------------
type Status = 'PASS' | 'FAIL' | 'AUTH' | 'SKIP' | 'INFO';
interface Row {
  kind: string;
  label: string;
  status: Status;
  detail: string;
}
const rows: Row[] = [];
const notes: string[] = [];
const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};
const push = (kind: string, label: string, status: Status, detail: string) =>
  rows.push({ kind, label, status, detail });

// --- checks ----------------------------------------------------------------------
async function checkControl(c: { label: string; args: string[] }): Promise<void> {
  const [b, m] = await Promise.all([run(BRANCH_DIR, c.args), run(MAIN_DIR, c.args)]);
  if (b.rc === 4 || m.rc === 4) return push('CONTROL', c.label, 'AUTH', `branch rc=${b.rc}, main rc=${m.rc}`);
  if (b.rc !== 0 || m.rc !== 0) {
    return push(
      'CONTROL',
      c.label,
      'FAIL',
      `exit branch=${b.rc} main=${m.rc} ${shortErr(b.stderr)}${shortErr(m.stderr)}`,
    );
  }
  const jb = parseJson(b.stdout);
  const jm = parseJson(m.stdout);
  if (jb === undefined || jm === undefined) return push('CONTROL', c.label, 'FAIL', 'invalid JSON on one side');
  push(
    'CONTROL',
    c.label,
    canon(jb) === canon(jm) ? 'PASS' : 'FAIL',
    canon(jb) === canon(jm) ? 'shape+data equal' : 'normalized output differs',
  );
}

/** Returns the branch list items so the GET phase can source identifiers. */
async function checkList(c: ListCheck): Promise<any[] | undefined> {
  const args = [...c.args, ...envArgs()];
  const mainArgs = c.args; // main takes no --environment-id
  const [b, m] = await Promise.all([run(BRANCH_DIR, args), run(MAIN_DIR, mainArgs)]);
  if (b.rc === 4 || m.rc === 4) {
    push('LIST', c.label, 'AUTH', `branch rc=${b.rc}, main rc=${m.rc}`);
    return undefined;
  }
  if (b.rc !== 0 || m.rc !== 0) {
    push('LIST', c.label, 'FAIL', `exit branch=${b.rc} main=${m.rc} ${shortErr(b.stderr)}${shortErr(m.stderr)}`);
    return undefined;
  }
  const jb = parseJson(b.stdout);
  const jm = parseJson(m.stdout);
  if (jb === undefined || jm === undefined) {
    push('LIST', c.label, 'FAIL', 'invalid JSON on one side');
    return undefined;
  }

  const bi = itemsOf(jb);
  const mi = itemsOf(jm);
  if (bi.length === 0 && mi.length === 0) {
    push('LIST', c.label, 'SKIP', 'both sides empty — proves the call works, proves nothing about data');
    return bi;
  }
  const bIds = new Set(bi.map((i) => i?.[c.idKey]));
  const mIds = new Set(mi.map((i) => i?.[c.idKey]));
  const onlyB = [...bIds].filter((x) => !mIds.has(x));
  const onlyM = [...mIds].filter((x) => !bIds.has(x));
  if (c.orderDiverges) {
    const shared = [...bIds].filter((x) => mIds.has(x));
    notes.push(`${C.cyan}INFO${C.reset} ${c.cmd} ordering: ${c.orderDiverges.note}`);
    if (shared.length === 0) {
      push(
        'LIST',
        c.label,
        'SKIP',
        `no overlap between the two windows (branch ${bi.length}, main ${mi.length}); widen --limit to compare rows`,
      );
      return bi;
    }
    // Fall through and compare only the shared rows.
  } else if (onlyB.length || onlyM.length) {
    push(
      'LIST',
      c.label,
      'FAIL',
      `entity sets differ (branch ${bi.length}, main ${mi.length}; only-branch=${JSON.stringify(onlyB).slice(0, 60)} only-main=${JSON.stringify(onlyM).slice(0, 60)})`,
    );
    return bi;
  }
  // Same entity set: compare every shared field, row by row.
  let unexpected = 0;
  let acceptedN = 0;
  const seenBranchOnly = new Set<string>();
  const seenMainOnly = new Set<string>();
  let comparedRows = 0;
  for (const bRow of bi) {
    const mRow = mi.find((x) => x?.[c.idKey] === bRow?.[c.idKey]);
    if (!mRow) continue;
    comparedRows++;
    const r = compareEntity(c.cmd, bRow, mRow);
    unexpected += r.diffs.length;
    acceptedN += r.accepted.length;
    r.branchOnly.forEach((k) => seenBranchOnly.add(k));
    r.mainOnly.forEach((k) => seenMainOnly.add(k));
    for (const d of r.diffs) {
      notes.push(
        `${C.red}FAIL${C.reset} ${c.cmd}.${d.key}: branch=${JSON.stringify(d.branch)} main=${JSON.stringify(d.main)}`,
      );
    }
    for (const d of r.accepted) {
      notes.push(
        `${C.cyan}INFO${C.reset} ${c.cmd}.${d.key} (accepted): branch=${JSON.stringify(d.branch)} main=${JSON.stringify(d.main)}`,
      );
    }
  }
  const extras = [
    seenBranchOnly.size ? `branch-only keys: ${[...seenBranchOnly].join(',')}` : '',
    seenMainOnly.size ? `dropped: ${[...seenMainOnly].join(',')}` : '',
    acceptedN ? `${acceptedN} accepted diff(s)` : '',
  ]
    .filter(Boolean)
    .join('; ');
  const scope = c.orderDiverges
    ? `${comparedRows} overlapping row(s) compared (windows differ by sort order)`
    : `${comparedRows} row(s) matched, every shared field compared`;
  push(
    'LIST',
    c.label,
    unexpected === 0 ? 'PASS' : 'FAIL',
    `${scope}${extras ? ` — ${extras}` : ''}${unexpected ? ` — ${unexpected} UNEXPECTED diff(s)` : ''}`,
  );
  return bi;
}

async function checkGet(c: ListCheck, branchItems: any[] | undefined): Promise<void> {
  if (!c.get) return push('GET', c.label, 'SKIP', 'no get subcommand on either side');
  if (!branchItems || branchItems.length === 0)
    return push('GET', c.label, 'SKIP', 'no row available to source an identifier');
  const ident = branchItems[0]?.[c.get.argFrom];
  if (!ident) return push('GET', c.label, 'SKIP', `list row has no ${c.get.argFrom}`);

  const [b, m] = await Promise.all([
    run(BRANCH_DIR, [c.cmd, c.get.sub, String(ident), '--json', ...envArgs()]),
    run(MAIN_DIR, [c.cmd, c.get.sub, String(ident), '--json']),
  ]);
  if (b.rc === 4 || m.rc === 4) return push('GET', c.label, 'AUTH', `branch rc=${b.rc}, main rc=${m.rc}`);
  if (b.rc !== 0 || m.rc !== 0) {
    return push('GET', c.label, 'FAIL', `exit branch=${b.rc} main=${m.rc} ${shortErr(b.stderr)}${shortErr(m.stderr)}`);
  }
  const be = entityOf(parseJson(b.stdout));
  const me = entityOf(parseJson(m.stdout));
  if (!be || !me) return push('GET', c.label, 'FAIL', 'could not unwrap entity from one side');
  const r = compareEntity(c.cmd, be, me);
  for (const d of r.diffs) {
    notes.push(
      `${C.red}FAIL${C.reset} ${c.cmd} get .${d.key}: branch=${JSON.stringify(d.branch)} main=${JSON.stringify(d.main)}`,
    );
  }
  push(
    'GET',
    c.label,
    r.diffs.length === 0 ? 'PASS' : 'FAIL',
    `${c.get.argFrom}=${String(ident).slice(0, 28)} — every shared field compared${r.accepted.length ? `; ${r.accepted.length} accepted` : ''}${r.diffs.length ? `; ${r.diffs.length} UNEXPECTED` : ''}`,
  );
}

/**
 * Cross-plane read-after-write. Create on one plane, read on the other, delete.
 * Grammar differs by side: branch `delete --yes`, main `delete` (no flag).
 */
async function checkWriteRoundTrip(from: 'branch' | 'main'): Promise<void> {
  const label = from === 'branch' ? 'create@graphql → read@rest' : 'create@rest → read@graphql';
  const name = `parity-smoke-${Date.now()}`;
  const creator = from === 'branch' ? BRANCH_DIR : MAIN_DIR;
  const reader = from === 'branch' ? MAIN_DIR : BRANCH_DIR;

  const createArgs =
    from === 'branch'
      ? ['organization', 'create', name, '--json', ...envArgs()]
      : ['organization', 'create', name, '--json'];
  const c = await run(creator, createArgs);
  if (c.rc !== 0) return push('WRITE', label, 'FAIL', `create failed rc=${c.rc} ${shortErr(c.stderr)}`);
  const orgId = findId(parseJson(c.stdout), 'org');
  if (!orgId) return push('WRITE', label, 'FAIL', 'could not extract org id from create output');

  try {
    const readArgs =
      reader === BRANCH_DIR
        ? ['organization', 'get', orgId, '--json', ...envArgs()]
        : ['organization', 'get', orgId, '--json'];
    const r = await run(reader, readArgs);
    if (r.rc !== 0)
      return push('WRITE', label, 'FAIL', `read-back failed rc=${r.rc} ${shortErr(r.stderr)} (org ${orgId})`);
    const ent = entityOf(parseJson(r.stdout));
    if (!ent) return push('WRITE', label, 'FAIL', `read-back returned no entity (org ${orgId})`);
    if (ent.id !== orgId) return push('WRITE', label, 'FAIL', `read-back id mismatch: ${ent.id} != ${orgId}`);
    if (ent.name !== name) return push('WRITE', label, 'FAIL', `read-back name mismatch: ${ent.name} != ${name}`);
    push('WRITE', label, 'PASS', `${orgId} written on one plane, read identically on the other`);
  } finally {
    // Branch requires --yes; main takes no confirmation flag.
    const delArgs =
      creator === BRANCH_DIR
        ? ['organization', 'delete', orgId, '--yes', '--json', ...envArgs()]
        : ['organization', 'delete', orgId, '--json'];
    const d = await run(creator, delArgs);
    if (d.rc !== 0)
      notes.push(`${C.yellow}WARN${C.reset} cleanup failed for ${orgId} (rc=${d.rc}) — delete it by hand`);
    // Deletes do not land on both planes simultaneously. Without a settle, the
    // next run's list phase can see the row on one plane and not the other and
    // report a spurious entity-set divergence.
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * Create disposable fixtures so the list/get checks run against real rows
 * instead of comparing empty-vs-empty. Seeds via the BRANCH (GraphQL) binary,
 * which doubles as a write-path exercise: both planes then read what GraphQL
 * wrote. Returns a cleanup thunk.
 *
 * `feature-flag` is the one command that cannot be seeded at all: there is no
 * create subcommand on either side AND no POST /feature-flags REST endpoint, so
 * a flag can only come into existence through the dashboard UI.
 *
 * `user` has no CLI create either, but POST /user_management/users exists, so it
 * is seeded through `workos api`. Events need no seeding of their own: creating
 * an organization and a user emits organization.created and user.created.
 */
async function seed(): Promise<() => Promise<void>> {
  const ts = Date.now();
  const cleanups: Array<() => Promise<void>> = [];

  const pslug = `parity-seed-${ts}`;
  const p = await run(BRANCH_DIR, [
    'permission',
    'create',
    '--slug',
    pslug,
    '--name',
    `Parity Seed ${ts}`,
    '--yes',
    '--json',
    ...envArgs(),
  ]);
  if (p.rc === 0) {
    notes.push(`${C.dim}seeded permission ${pslug}${C.reset}`);
    cleanups.push(async () => {
      await run(BRANCH_DIR, ['permission', 'delete', pslug, '--yes', '--json', ...envArgs()]);
    });
  } else {
    notes.push(`${C.yellow}WARN${C.reset} seed permission failed: ${shortErr(p.stderr)}`);
  }

  const w = await run(BRANCH_DIR, [
    'webhook',
    'create',
    '--url',
    `https://example.com/parity-${ts}`,
    '--events',
    'dsync.user.created',
    '--json',
    ...envArgs(),
  ]);
  const wid = findId(parseJson(w.stdout), 'we');
  if (w.rc === 0 && wid) {
    notes.push(`${C.dim}seeded webhook ${wid}${C.reset}`);
    cleanups.push(async () => {
      await run(BRANCH_DIR, ['webhook', 'delete', wid, '--yes', '--json', ...envArgs()]);
    });
  } else {
    notes.push(`${C.yellow}WARN${C.reset} seed webhook failed: ${shortErr(w.stderr)}`);
  }

  // No CLI `user create` on either plane, so seed over raw REST. This also
  // emits a user.created event for the event check.
  const email = `parity-seed-${ts}@example.com`;
  const u = await run(BRANCH_DIR, [
    'api',
    '/user_management/users',
    '--method',
    'POST',
    '--data',
    JSON.stringify({ email, password: `Parity-Seed-${ts}!aB9`, email_verified: true }),
    '--yes',
  ]);
  const uid = findId(parseJson(u.stdout), 'user');
  if (u.rc === 0 && uid) {
    notes.push(`${C.dim}seeded user ${uid}${C.reset}`);
    cleanups.push(async () => {
      await run(BRANCH_DIR, ['api', `/user_management/users/${uid}`, '--method', 'DELETE', '--yes']);
    });
  } else {
    notes.push(`${C.yellow}WARN${C.reset} seed user failed: ${shortErr(u.stderr)}`);
  }

  if (INVITE) {
    const inviteEmail = `parity-invite-${ts}@example.com`;
    const inv = await run(BRANCH_DIR, [
      'api',
      '/user_management/invitations',
      '--method',
      'POST',
      '--data',
      JSON.stringify({ email: inviteEmail }),
      '--yes',
    ]);
    const invId = findId(parseJson(inv.stdout), 'invitation');
    if (inv.rc === 0 && invId) {
      notes.push(`${C.dim}seeded invitation ${invId}${C.reset}`);
      cleanups.push(async () => {
        await run(BRANCH_DIR, ['api', `/user_management/invitations/${invId}/revoke`, '--method', 'POST', '--yes']);
        // Sending an invitation also creates a pending USER record, and revoking
        // the invitation does not remove it. Without this the run leaks one user
        // per invocation, which then pollutes the next run's user comparison.
        const found = await run(BRANCH_DIR, ['api', `/user_management/users?email=${encodeURIComponent(inviteEmail)}`]);
        const orphan = findId(parseJson(found.stdout), 'user');
        if (orphan) await run(BRANCH_DIR, ['api', `/user_management/users/${orphan}`, '--method', 'DELETE', '--yes']);
      });
    } else {
      notes.push(`${C.yellow}WARN${C.reset} seed invitation failed: ${shortErr(inv.stderr)}`);
    }
  } else {
    notes.push(`${C.dim}invitation not seeded (pass --invite; it attempts real email delivery)${C.reset}`);
  }

  await new Promise((r) => setTimeout(r, 2500));
  return async () => {
    for (const c of cleanups) await c();
    await new Promise((r) => setTimeout(r, 1500));
  };
}

async function checkNew(c: { label: string; args: string[] }): Promise<void> {
  const r = await run(BRANCH_DIR, c.args);
  if (r.rc === 4) return push('NEW', c.label, 'AUTH', 'auth required');
  if (r.rc !== 0) return push('NEW', c.label, 'FAIL', `exit ${r.rc} ${shortErr(r.stderr)}`);
  if (parseJson(r.stdout) === undefined) return push('NEW', c.label, 'FAIL', 'invalid JSON');
  push('NEW', c.label, 'PASS', 'valid JSON');
}

// --- run -------------------------------------------------------------------------
console.log(`parity-smoke  branch=${BRANCH_DIR}`);
console.log(
  `              main=${MAIN_DIR}${ENV_ID ? `  env=${ENV_ID}` : ''}${MUTATE ? '  [--mutate]' : ''}${SEED ? '  [--seed]' : ''}`,
);
console.log(`              cwd=${NEUTRAL_CWD} (isolated so no worktree .env.local loads)`);
console.log(`              api key source: ${API_KEY_SOURCE}\n`);
if (API_KEY_SOURCE === 'NONE') {
  console.log(
    `${C.yellow}no WORKOS_API_KEY resolved; REST-plane commands will fail or fall back to stored config${C.reset}\n`,
  );
}

await Promise.all(CONTROL.map(checkControl));

// Preflight: prove both planes are looking at the SAME environment before any
// comparison is believed. Disjoint non-empty organization sets mean different
// environments, and every downstream row would be a meaningless comparison.
{
  const [b, m] = await Promise.all([
    run(BRANCH_DIR, ['organization', 'list', '--json', ...envArgs()]),
    run(MAIN_DIR, ['organization', 'list', '--json']),
  ]);
  const bi = itemsOf(parseJson(b.stdout));
  const mi = itemsOf(parseJson(m.stdout));
  const bIds = new Set(bi.map((i: any) => i?.id));
  const overlap = mi.filter((i: any) => bIds.has(i?.id)).length;
  if (bi.length === 0 || mi.length === 0) {
    push(
      'PREFLIGHT',
      'same-environment',
      'SKIP',
      `cannot confirm alignment: branch has ${bi.length} org(s), main has ${mi.length}. Empty comparisons below prove nothing.`,
    );
  } else if (overlap === 0) {
    push(
      'PREFLIGHT',
      'same-environment',
      'FAIL',
      `branch and main see DISJOINT organizations (${bi.length} vs ${mi.length}, 0 shared). Different environments — every result below is meaningless. Align WORKOS_API_KEY with the session's active env.`,
    );
    console.log(`${C.red}aborting: planes are on different environments${C.reset}`);
    for (const r of rows) console.log(`  ${r.status} ${r.kind} ${r.label} ${r.detail}`);
    process.exit(1);
  } else {
    push('PREFLIGHT', 'same-environment', 'PASS', `${overlap} organization(s) visible on both planes`);
  }
}

const unseed = SEED ? await seed() : undefined;
const listItems = new Map<string, any[] | undefined>();
await Promise.all(
  LISTS.map(async (c) => {
    listItems.set(c.cmd, await checkList(c));
  }),
);
await Promise.all(LISTS.map((c) => checkGet(c, listItems.get(c.cmd))));
await Promise.all(NEW_ONLY.map(checkNew));
if (MUTATE) {
  await checkWriteRoundTrip('branch');
  await checkWriteRoundTrip('main');
} else {
  push('WRITE', 'cross-plane round-trip', 'SKIP', 're-run with --mutate to exercise the write path');
}
if (unseed) await unseed();

// --- report ----------------------------------------------------------------------
const w = Math.max(...rows.map((r) => r.label.length), 20);
const order = ['PREFLIGHT', 'CONTROL', 'LIST', 'GET', 'WRITE', 'NEW'];
for (const kind of order) {
  const group = rows.filter((r) => r.kind === kind);
  if (!group.length) continue;
  console.log(`${C.dim}${kind}${C.reset}`);
  for (const r of group) {
    const color =
      r.status === 'PASS'
        ? C.green
        : r.status === 'FAIL'
          ? C.red
          : r.status === 'AUTH'
            ? C.yellow
            : r.status === 'INFO'
              ? C.cyan
              : C.dim;
    console.log(`  ${color}${r.status.padEnd(4)}${C.reset}  ${r.label.padEnd(w)}  ${C.dim}${r.detail}${C.reset}`);
  }
}
if (notes.length) {
  console.log(`\n${C.dim}field-level detail${C.reset}`);
  for (const n of notes) console.log(`  ${n}`);
}

const n = (s: Status) => rows.filter((r) => r.status === s).length;
const nfail = n('FAIL');
console.log(
  `\n${nfail === 0 ? C.green : C.red}${n('PASS')} pass, ${nfail} fail, ${n('AUTH')} auth, ${n('SKIP')} skip${C.reset}`,
);
process.exit(nfail === 0 ? 0 : 1);
