import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const script = resolve('scripts/smoke-auth-preflight.sh');
const key = 'fake-localhost-only-secret';
const body = 'private-response-body';
const header = 'private-response-header';
const servers: Server[] = [];
const dirs: string[] = [];

async function fixture(status: number, disconnect = false) {
  const requests: { method?: string; url?: string; authorization?: string }[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    if (disconnect) {
      req.socket.destroy();
      return;
    }
    res.writeHead(status, { Location: '/redirect-target', 'X-Private': header });
    res.end(`${body} ${key}`);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

async function run(url: string, credential = key, githubFiles = true) {
  const dir = await mkdtemp(join(tmpdir(), 'smoke-preflight-'));
  dirs.push(dir);
  const output = join(dir, 'output');
  const summary = join(dir, 'summary');
  // A user curlrc must not enable redirects, retries, or verbose secret logging.
  await writeFile(join(dir, '.curlrc'), 'location\nverbose\nretry = 2\n');
  await writeFile(output, '');
  await writeFile(summary, '');
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(
      'sh',
      [script],
      {
        timeout: 5000,
        // Do not inherit credentials, proxy configuration or curl settings.
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          CURL_HOME: dir,
          NO_PROXY: '*',
          WORKOS_SMOKE_API_KEY: credential,
          WORKOS_SMOKE_API_URL: `${url}/`,
          ...(githubFiles ? { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary } : {}),
        },
      },
      (error, stdout, stderr) => {
        done({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
      },
    );
  });
  const outputs = await readFile(output, 'utf8');
  const notes = await readFile(summary, 'utf8');
  const logs = result.stdout + result.stderr + outputs + notes;
  for (const sensitive of [key, body, header, 'Authorization:', 'X-Private:']) {
    expect(logs).not.toContain(sensitive);
  }
  expect(result.stderr).toBe('');
  return { ...result, outputs, notes };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done, reject) => {
          server.close((error) => (error ? reject(error) : done()));
        }),
    ),
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('smoke authentication preflight (localhost only)', () => {
  it('enables live smoke only for HTTP 200 with a single authenticated GET', async () => {
    const local = await fixture(200);
    const result = await run(local.url);
    expect(result.code).toBe(0);
    expect(result.outputs).toBe('usable=true\n');
    expect(result.notes).toContain('not a live smoke pass');
    expect(local.requests).toEqual([
      {
        method: 'GET',
        url: '/connections?limit=1',
        authorization: `Bearer ${key}`,
      },
    ]);
  });

  it('transparently skips rejected credentials with a GitHub warning and summary', async () => {
    const local = await fixture(401);
    const result = await run(local.url);
    expect(result.code).toBe(0);
    expect(result.outputs).toBe('usable=false\n');
    expect(result.stdout).toContain('::warning::');
    expect(result.notes).toContain('HTTP 401');
    expect(result.notes).toContain('NOT RUN');
    expect(result.notes).toContain('Investigate the CI credential/API');
    expect(local.requests).toHaveLength(1);
  });

  it('skips missing credentials without a request', async () => {
    const local = await fixture(200);
    const result = await run(local.url, '');
    expect(result.code).toBe(0);
    expect(result.outputs).toBe('usable=false\n');
    expect(result.notes).toContain('NOT RUN');
    expect(result.notes).toContain('Credential/API configuration needs investigation');
    expect(local.requests).toHaveLength(0);
  });

  it.each([204, 301, 302, 307, 308, 403, 429, 500, 503])(
    'fails closed for HTTP %s, without following or retrying',
    async (status) => {
      const local = await fixture(status);
      const result = await run(local.url);
      expect(result.code).toBe(1);
      expect(result.outputs).toBe('usable=false\n');
      expect(result.stdout).toContain('::error::');
      expect(result.notes).toContain('NOT RUN');
      expect(local.requests).toHaveLength(1);
      expect(local.requests[0].url).toBe('/connections?limit=1');
    },
  );

  it('fails red on transport failure', async () => {
    const local = await fixture(200, true);
    const result = await run(local.url);
    expect(result.code).toBe(1);
    expect(result.outputs).toBe('usable=false\n');
    expect(result.notes).toContain('transport failure');
    expect(local.requests).toHaveLength(1);
  });

  it('also works without GitHub output files', async () => {
    const local = await fixture(200);
    const result = await run(local.url, key, false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('eligible');
  });

  it('gates the existing live CLI smoke without suppressing its failures', async () => {
    const workflow = parse(await readFile('.github/workflows/test.yml', 'utf8'));
    const steps = workflow.jobs.test.steps;
    const preflight = steps.findIndex((step: { id?: string }) => step.id === 'smoke-auth-preflight');
    const live = steps.findIndex((step: { id?: string }) => step.id === 'authenticated-smoke');
    expect(preflight).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(preflight);
    expect(steps[preflight].run).toBe('sh scripts/smoke-auth-preflight.sh');
    expect(steps[live].if).toBe("steps.smoke-auth-preflight.outputs.usable == 'true'");
    expect(steps[live]['continue-on-error']).toBeUndefined();
    expect(steps[preflight]['continue-on-error']).toBeUndefined();
    expect(steps[live].env.WORKOS_API_KEY).toBe(steps[preflight].env.WORKOS_SMOKE_API_KEY);
    expect(steps[live].env.WORKOS_SMOKE_API_URL).toBe(steps[preflight].env.WORKOS_SMOKE_API_URL);
    expect(steps[live].run.trim().endsWith('sh scripts/command-smoke.sh ./dist/workos')).toBe(true);
    // Execute the workflow wrapper with a failing local CLI-smoke stand-in.
    // No CLI, credentials, or network are used; its actual exit must survive.
    const exitCode = await new Promise<number>((done) => {
      execFile(
        'sh',
        ['-e', '-c', `sh() { return 17; };\n${steps[live].run}`],
        { env: { PATH: process.env.PATH, WORKOS_SMOKE_API_URL: 'http://127.0.0.1:1' } },
        (error) => done(error && typeof error.code === 'number' ? error.code : 0),
      );
    });
    expect(exitCode).toBe(17);
    expect(steps.some((step: { name?: string }) => step.name === 'Diagnose smoke authentication without the CLI')).toBe(
      false,
    );
  });
});
