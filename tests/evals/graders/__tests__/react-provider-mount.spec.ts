import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMountedAuthKitProvider } from '../react.grader.js';

const PROVIDER = `import { AuthKitProvider } from '@workos-inc/authkit-react';
export function AuthProvider({ children }) {
  return <AuthKitProvider clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}>{children}</AuthKitProvider>;
}
`;

describe('findMountedAuthKitProvider', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'react-grader-'));
    await mkdir(join(workDir, 'src/auth'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('accepts AuthKitProvider in the entry file', async () => {
    await writeFile(join(workDir, 'src/main.tsx'), PROVIDER);
    expect(await findMountedAuthKitProvider(workDir)).toBe('src/main.tsx');
  });

  it('accepts a provider module imported by the entry file', async () => {
    await writeFile(join(workDir, 'src/auth/AuthProvider.tsx'), PROVIDER);
    await writeFile(join(workDir, 'src/main.tsx'), `import { AuthProvider } from './auth/AuthProvider';\n`);
    expect(await findMountedAuthKitProvider(workDir)).toBe('src/auth/AuthProvider.tsx');
  });

  it('accepts a provider module imported via the @/ alias from another component', async () => {
    await writeFile(join(workDir, 'src/auth/index.tsx'), PROVIDER);
    await writeFile(join(workDir, 'src/App.tsx'), `import { AuthProvider } from '@/auth';\n`);
    expect(await findMountedAuthKitProvider(workDir)).toBe('src/auth/index.tsx');
  });

  it('rejects a provider module nothing imports', async () => {
    await writeFile(join(workDir, 'src/auth/AuthProvider.tsx'), PROVIDER);
    await writeFile(join(workDir, 'src/main.tsx'), `import App from './App';\n`);
    expect(await findMountedAuthKitProvider(workDir)).toBeNull();
  });

  it('rejects a provider from a different SDK', async () => {
    await writeFile(join(workDir, 'src/main.tsx'), `import { AuthKitProvider } from '@workos-inc/authkit-js';\n`);
    expect(await findMountedAuthKitProvider(workDir)).toBeNull();
  });
});
