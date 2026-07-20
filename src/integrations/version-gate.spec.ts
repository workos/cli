import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallerOptions } from '../utils/types.js';
import { InstallDeclinedError } from '../lib/installer-errors.js';

vi.mock('../utils/clack.js', () => ({
  default: {
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    outro: vi.fn(),
  },
}));

vi.mock('../lib/agent-runner.js', () => ({
  runAgentInstaller: vi.fn(async () => 'agent summary'),
}));

const { run: runNextjs } = await import('./nextjs/index.js');
const { run: runReactRouter } = await import('./react-router/index.js');

// A declined install must throw (not return a summary): a normal return used
// to surface as "Successfully installed" with exit 0 to machine consumers.
describe('unsupported framework versions decline the install', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'version-gate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function options(): InstallerOptions {
    return { installDir: dir } as InstallerOptions;
  }

  it('nextjs below the minimum throws InstallDeclinedError', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.2.0' } }));
    await expect(runNextjs(options())).rejects.toMatchObject({
      name: 'InstallDeclinedError',
      code: 'unsupported_framework_version',
    });
  });

  it('react-router below the minimum throws InstallDeclinedError', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'react-router': '^5.3.0' } }));
    await expect(runReactRouter(options())).rejects.toBeInstanceOf(InstallDeclinedError);
  });

  it('a supported nextjs version proceeds to the agent runner', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '^15.3.0' } }));
    await expect(runNextjs(options())).resolves.toBe('agent summary');
  });
});
