/**
 * The API-key precedence through the REAL command line: bin.ts parses
 * `--api-key` with yargs, the resource-group middleware hands it to the auth
 * selector, and the request goes out with that key. api-key-auth.spec.ts
 * covers the selector in-process; this drives the actual CLI as a subprocess
 * (bin.ts runs at import and has no seams) against a local HTTP stub of the
 * WorkOS API, with a throwaway HOME and file-only credential storage so the
 * host keychain and ~/.workos are never touched.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../bin.ts', import.meta.url));
const forceInsecureStorageImport = fileURLToPath(new URL('../test/force-insecure-storage.ts', import.meta.url));

const ORG = {
  object: 'organization',
  id: 'org_1',
  name: 'FooCorp',
  domains: [],
  metadata: {},
  external_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

let server: Server;
let baseUrl: string;
/** Requests the stub saw. Unclaimed profiles also trigger an unrelated claim-status check, so assertions filter. */
const seen: Array<{ method: string; url: string; auth: string }> = [];
/** Authorization headers sent to the organizations API (the resource command's own requests). */
const orgAuth = () => seen.filter((request) => request.url.startsWith('/organizations')).map((request) => request.auth);
let home: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: String(req.method), url: String(req.url), auth: String(req.headers.authorization ?? '') });
    if (req.method === 'GET' && req.url === '/organizations/org_1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ORG));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen.length = 0;
  home = mkdtempSync(join(tmpdir(), 'wos-cli-api-key-it-'));
  // An unclaimed active profile with its own key: the lowest-precedence key.
  mkdirSync(join(home, '.workos'), { recursive: true });
  writeFileSync(
    join(home, '.workos', 'config.json'),
    JSON.stringify({
      activeEnvironment: 'unclaimed',
      environments: {
        unclaimed: {
          name: 'unclaimed',
          type: 'unclaimed',
          apiKey: 'sk_test_unclaimed',
          clientId: 'client_test',
          claimToken: 'claim_test',
        },
      },
    }),
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'bun',
      ['--preload', forceInsecureStorageImport, binPath, ...args, '--json', '--insecure-storage'],
      {
        // An empty cwd: nothing for Bun to auto-load from a .env file.
        cwd: home,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          USERPROFILE: home,
          TMPDIR: home,
          WORKOS_MODE: 'agent',
          WORKOS_TELEMETRY: 'false',
          WORKOS_API_URL: baseUrl,
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('--api-key through the real command line', () => {
  it('sends the --api-key flag over WORKOS_API_KEY and the unclaimed profile with an API key', async () => {
    const result = await runCli(['organization', 'get', 'org_1', '--api-key', 'sk_test_flag'], {
      WORKOS_API_KEY: 'sk_test_env',
    });

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ organization: { id: 'org_1', name: 'FooCorp' } });
    expect(orgAuth()).toEqual(['Bearer sk_test_flag']);
  }, 30_000);

  it('falls back to WORKOS_API_KEY, then the unclaimed profile’s key, with an API key from each', async () => {
    const fromEnv = await runCli(['organization', 'get', 'org_1'], { WORKOS_API_KEY: 'sk_test_env' });
    expect(fromEnv.code, fromEnv.stderr).toBe(0);

    const fromProfile = await runCli(['org', 'get', 'org_1']);
    expect(fromProfile.code, fromProfile.stderr).toBe(0);

    expect(orgAuth()).toEqual(['Bearer sk_test_env', 'Bearer sk_test_unclaimed']);
  }, 30_000);

  it('refuses --environment-id with an API key passed as a flag, before any request', async () => {
    const result = await runCli([
      'organization',
      'get',
      'org_1',
      '--api-key',
      'sk_test_flag',
      '--environment-id',
      'env_x',
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr.trim().split('\n').pop()!)).toMatchObject({ error: { code: 'invalid_argument' } });
    expect(orgAuth()).toEqual([]);
  }, 30_000);
});
