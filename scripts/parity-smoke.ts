/**
 * Parity smoke: compare read-only command output between this branch
 * (ideation/graphql-resource-migration, dashboard GraphQL plane) and ../main
 * (REST plane), against the same WorkOS environment.
 *
 * What it checks, per the agreed direction (clean break, data-parity):
 *
 *   CONTROL  — commands that stayed REST on both branches (connection, directory,
 *              audit-log). Same code on both sides → strict shape+data parity
 *              after normalizing volatile fields. Acts as a harness/env sanity
 *              check: if these fail, the migrated results below are unreliable.
 *   MIGRATED — the 12 commands moved to dashboard GraphQL (organization, user,
 *              role, permission, invitation, feature-flag, webhook, event, …).
 *              Shapes intentionally differ (feat!), so we compare DATA only:
 *              the sorted set of {id, primary-scalar, key-attribute} records
 *              extracted identically from both sides. Catches dropped/added/
 *              renamed entities and wrong primary attributes. Does NOT deep-
 *              compare every field (see "Not covered" below).
 *   NEW      — branch-only commands (whoami, project, team, authkit, branding).
 *              Assert exit 0 + valid JSON on the branch binary only.
 *
 * Not covered (read-only smoke, by design):
 *   - `get` variants needing an ID (organization/user/role/… get) — would require
 *     sourcing IDs from list output across two different shapes. Add later.
 *   - membership list (--org), session list <userId>, api-key list (--org) —
 *     need an entity ID; same follow-up.
 *   - org-domain (no list subcommand), portal generate-link (mutates), config
 *     (mutations only). Not safely read-only.
 *   - Per-field deep parity on migrated commands (e.g. usersCount). Smoke-level
 *     only; promote to field maps if a field-level audit is needed.
 *
 * Prereqs:
 *   1. From this branch: `workos auth login` — establishes the dashboard OAuth
 *      session the branch binary uses for GraphQL + new commands.
 *   2. `export WORKOS_API_KEY=sk_...` — used by main's REST resource commands
 *      AND by both binaries' REST leftovers (connection/directory/audit-log).
 *      This key's environment MUST match the dashboard session's active env.
 *   3. `../main` must be a checkout of this repo on `main` (worktree or clone).
 *
 * Usage:
 *   bun run scripts/parity-smoke.ts
 *
 * Optional env:
 *   PARITY_BRANCH_BIN  override the branch binary (default: bun <repo>/src/bin.ts)
 *   PARITY_MAIN_BIN    override the main binary   (default: bun ../main/src/bin.ts)
 *                      For release-grade parity, build both and set these to
 *                      `node /abs/path/dist/bin.js`.
 *   PARITY_ENV_ID      pin --environment-id on migrated + new commands (ensures
 *                      the branch's GraphQL target matches the API key's env).
 *
 * Exit code: 0 if every executed check passed, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BRANCH_DIR = path.resolve(import.meta.dirname, '..');
const MAIN_DIR = path.resolve(BRANCH_DIR, '../main');
const ENV_ID = process.env.PARITY_ENV_ID;

// --- early sanity: ../main must be the workos CLI --------------------------------
if (!existsSync(path.join(MAIN_DIR, 'src/bin.ts'))) {
  console.error(`PARITY_MAIN_BIN target not found: ${MAIN_DIR}/src/bin.ts`);
  console.error('Set PARITY_MAIN_BIN, or place a main checkout at ../main.');
  process.exit(2);
}
for (const dir of [BRANCH_DIR, MAIN_DIR]) {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.name !== 'workos') {
    console.error(`${dir} is not the workos CLI (package.json name="${pkg.name}").`);
    process.exit(2);
  }
}

// --- binary invocation -----------------------------------------------------------
function binFor(dir: string): { cmd: string; args: string[] } {
  const override = dir === BRANCH_DIR ? process.env.PARITY_BRANCH_BIN : process.env.PARITY_MAIN_BIN;
  if (override) {
    const [cmd, ...args] = override.trim().split(/\s+/);
    return { cmd, args };
  }
  return { cmd: 'bun', args: [path.join(dir, 'src/bin.ts')] };
}

interface RunResult { rc: number; stdout: string; stderr: string; }
function run(dir: string, cliArgs: string[]): Promise<RunResult> {
  const { cmd, args } = binFor(dir);
  return new Promise((resolve) => {
    const p = spawn(cmd, [...args, ...cliArgs], { cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (err) => resolve({ rc: -1, stdout, stderr: String(err) }));
    p.on('close', (rc) => resolve({ rc: rc ?? 0, stdout, stderr }));
  });
}

function parseJson(stdout: string): unknown | undefined {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function envArgs(): string[] {
  return ENV_ID ? ['--environment-id', ENV_ID] : [];
}

// --- normalization ---------------------------------------------------------------
// Volatile keys stripped from both sides before comparison. Snake + camel forms.
const VOLATILE = /^(created_at|createdAt|updated_at|updatedAt|last_signed_in_at|lastSignedInAt|email_verified_at|emailVerifiedAt|before|after|listMetadata|list_metadata|pagination|occurred_at|occurredAt|timestamp|expiresAt|expires_at)$/;

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    return v.map(normalize).sort(cmp);
  }
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (!VOLATILE.test(k)) o[k] = normalize((v as Record<string, unknown>)[k]);
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

function canon(v: unknown): string {
  return JSON.stringify(normalize(v));
}

// Find the list array in a command's JSON: main emits { data, listMetadata },
// branch emits { <plural>, pagination }. Either way, the first array field wins.
function itemsOf(out: unknown): unknown[] {
  if (out && typeof out === 'object') {
    const o = out as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as unknown[];
    for (const k of Object.keys(o)) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

// --- command registry ------------------------------------------------------------
interface Comparable {
  id: (i: Record<string, unknown>) => unknown;
  primary: (i: Record<string, unknown>) => unknown;
  extra?: (i: Record<string, unknown>) => unknown;
}

const pick = (i: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (i[k] !== undefined && i[k] !== null) return i[k];
  return null;
};

const CONTROL: { label: string; args: string[] }[] = [
  { label: 'connection list', args: ['connection', 'list', '--json'] },
  { label: 'directory list', args: ['directory', 'list', '--json'] },
  { label: 'audit-log list-actions', args: ['audit-log', 'list-actions', '--json'] },
];

const MIGRATED: { label: string; args: string[]; map: Comparable }[] = [
  {
    label: 'organization list',
    args: ['organization', 'list', '--json', ...envArgs()],
    map: {
      id: (i) => i.id,
      primary: (i) => i.name,
      extra: (i) => {
        const d = (i.domains as Array<Record<string, unknown>> | undefined) ?? [];
        return d.map((x) => `${x.domain}:${x.state}`).sort();
      },
    },
  },
  { label: 'user list', args: ['user', 'list', '--json', ...envArgs()], map: { id: (i) => i.id, primary: (i) => i.email } },
  { label: 'role list', args: ['role', 'list', '--json', ...envArgs()], map: { id: (i) => i.id, primary: (i) => `${i.slug}:${i.name}` } },
  { label: 'permission list', args: ['permission', 'list', '--json', ...envArgs()], map: { id: (i) => i.id, primary: (i) => `${i.slug}:${i.name}` } },
  { label: 'invitation list', args: ['invitation', 'list', '--json', ...envArgs()], map: { id: (i) => i.id, primary: (i) => `${i.email ?? i.inviteeEmail}:${i.state}` } },
  { label: 'feature-flag list', args: ['feature-flag', 'list', '--json', ...envArgs()], map: { id: (i) => i.id, primary: (i) => `${i.slug}:${i.name}` } },
  { label: 'webhook list', args: ['webhook', 'list', '--json', ...envArgs()], map: { id: (i) => i.id, primary: (i) => pick(i, 'url', 'endpointUrl', 'endpoint_url') } },
  { label: 'event list', args: ['event', 'list', '--events', 'user.created', '--json', ...envArgs()], map: { id: (i) => i.id, primary: (i) => pick(i, 'event', 'name') } },
];

const NEW_ONLY: { label: string; args: string[] }[] = [
  { label: 'whoami', args: ['whoami', '--json'] },
  { label: 'project list', args: ['project', 'list', '--json'] },
  { label: 'team members', args: ['team', 'members', '--json'] },
  { label: 'authkit redirect-uris list', args: ['authkit', 'redirect-uris', 'list', '--json', ...envArgs()] },
  { label: 'branding get', args: ['branding', 'get', '--json', ...envArgs()] },
];

// --- result recording ------------------------------------------------------------
interface Row {
  label: string;
  kind: 'CONTROL' | 'MIGRATED' | 'NEW';
  status: 'PASS' | 'FAIL' | 'AUTH' | 'SKIP';
  detail: string;
}
const rows: Row[] = [];
const C = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' };

function authOrRc(r: RunResult): 'AUTH' | null {
  // gh-style: 4 = auth required. Surface it distinctly from a data divergence.
  if (r.rc === 4) return 'AUTH';
  return null;
}

function shortErr(stderr: string): string {
  return stderr.split('\n').filter(Boolean).slice(0, 2).join(' | ');
}

// --- checks ----------------------------------------------------------------------
async function checkControl(c: { label: string; args: string[] }): Promise<void> {
  const [mb, mm] = await Promise.all([run(BRANCH_DIR, c.args), run(MAIN_DIR, c.args)]);
  const ab = authOrRc(mb);
  const am = authOrRc(mm);
  if (ab || am) {
    rows.push({ label: c.label, kind: 'CONTROL', status: 'AUTH', detail: `auth required (branch rc=${mb.rc}, main rc=${mm.rc})` });
    return;
  }
  if (mb.rc !== 0 || mm.rc !== 0) {
    rows.push({ label: c.label, kind: 'CONTROL', status: 'FAIL', detail: `non-zero exit (branch ${mb.rc}, main ${mm.rc}) ${shortErr(mb.stderr)} / ${shortErr(mm.stderr)}` });
    return;
  }
  const jb = parseJson(mb.stdout);
  const jm = parseJson(mm.stdout);
  if (jb === undefined || jm === undefined) {
    rows.push({ label: c.label, kind: 'CONTROL', status: 'FAIL', detail: 'stdout not valid JSON on one or both sides' });
    return;
  }
  if (canon(jb) === canon(jm)) {
    rows.push({ label: c.label, kind: 'CONTROL', status: 'PASS', detail: 'shape+data equal' });
  } else {
    rows.push({ label: c.label, kind: 'CONTROL', status: 'FAIL', detail: `normalized output differs (branch ${canon(jb).length}b, main ${canon(jm).length}b)` });
  }
}

function recordOf(map: Comparable, item: unknown): Record<string, unknown> {
  const i = item as Record<string, unknown>;
  const rec: Record<string, unknown> = { id: map.id(i), primary: map.primary(i) };
  if (map.extra) rec.extra = map.extra(i);
  return rec;
}

async function checkMigrated(c: { label: string; args: string[]; map: Comparable }): Promise<void> {
  const [mb, mm] = await Promise.all([run(BRANCH_DIR, c.args), run(MAIN_DIR, c.args)]);
  const ab = authOrRc(mb);
  const am = authOrRc(mm);
  if (ab || am) {
    rows.push({ label: c.label, kind: 'MIGRATED', status: 'AUTH', detail: `auth required (branch rc=${mb.rc}, main rc=${mm.rc}); check workos auth login + WORKOS_API_KEY` });
    return;
  }
  if (mb.rc !== 0 || mm.rc !== 0) {
    rows.push({ label: c.label, kind: 'MIGRATED', status: 'FAIL', detail: `non-zero exit (branch ${mb.rc}, main ${mm.rc}) ${shortErr(mb.stderr)} / ${shortErr(mm.stderr)}` });
    return;
  }
  const jb = parseJson(mb.stdout);
  const jm = parseJson(mm.stdout);
  if (jb === undefined || jm === undefined) {
    rows.push({ label: c.label, kind: 'MIGRATED', status: 'FAIL', detail: 'stdout not valid JSON on one or both sides' });
    return;
  }
  const rb = itemsOf(jb).map((i) => recordOf(c.map, i)).sort(cmp);
  const rm = itemsOf(jm).map((i) => recordOf(c.map, i)).sort(cmp);
  if (canon(rb) === canon(rm)) {
    rows.push({ label: c.label, kind: 'MIGRATED', status: 'PASS', detail: `data parity (${rb.length} records)` });
  } else {
    const onlyBranch = rb.filter((r) => !rm.some((m) => canon(m) === canon(r)));
    const onlyMain = rm.filter((r) => !rb.some((b) => canon(b) === canon(r)));
    rows.push({
      label: c.label,
      kind: 'MIGRATED',
      status: 'FAIL',
      detail: `data differs (branch ${rb.length}, main ${rm.length}; only-branch=${onlyBranch.length} only-main=${onlyMain.length})`,
    });
  }
}

async function checkNew(c: { label: string; args: string[] }): Promise<void> {
  const r = await run(BRANCH_DIR, c.args);
  if (authOrRc(r)) {
    rows.push({ label: c.label, kind: 'NEW', status: 'AUTH', detail: 'auth required (run workos auth login)' });
    return;
  }
  if (r.rc !== 0) {
    rows.push({ label: c.label, kind: 'NEW', status: 'FAIL', detail: `exit ${r.rc} ${shortErr(r.stderr)}` });
    return;
  }
  if (parseJson(r.stdout) === undefined) {
    rows.push({ label: c.label, kind: 'NEW', status: 'FAIL', detail: 'stdout not valid JSON' });
    return;
  }
  rows.push({ label: c.label, kind: 'NEW', status: 'PASS', detail: 'valid JSON' });
}

// --- run -------------------------------------------------------------------------
console.log(`parity-smoke: branch=${BRANCH_DIR}  main=${MAIN_DIR}${ENV_ID ? `  env=${ENV_ID}` : ''}`);
console.log(`  branch bin: ${binFor(BRANCH_DIR).cmd} ${binFor(BRANCH_DIR).args.join(' ')}`);
console.log(`  main   bin: ${binFor(MAIN_DIR).cmd} ${binFor(MAIN_DIR).args.join(' ')}\n`);

await Promise.all([
  ...CONTROL.map((c) => checkControl(c)),
  ...MIGRATED.map((c) => checkMigrated(c)),
  ...NEW_ONLY.map((c) => checkNew(c)),
]);

// --- report ----------------------------------------------------------------------
const w = Math.max(...rows.map((r) => r.label.length), 24);
const kindW = 8;
for (const r of rows) {
  const color = r.status === 'PASS' ? C.green : r.status === 'AUTH' ? C.yellow : r.status === 'FAIL' ? C.red : C.dim;
  console.log(`  ${color}${r.status.padEnd(4)}${C.reset}  ${r.kind.padEnd(kindW)}  ${r.label.padEnd(w)}  ${C.dim}${r.detail}${C.reset}`);
}

const npass = rows.filter((r) => r.status === 'PASS').length;
const nauth = rows.filter((r) => r.status === 'AUTH').length;
const nfail = rows.filter((r) => r.status === 'FAIL').length;
console.log(`\n${nfail === 0 ? C.green : C.red}${npass} pass, ${nfail} fail, ${nauth} auth-blocked${C.reset}`);
process.exit(nfail === 0 ? 0 : 1);
