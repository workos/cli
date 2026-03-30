import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findUnsafeGetSignInUrlUsage } from '../nextjs.grader.js';

describe('findUnsafeGetSignInUrlUsage', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'grader-test-'));
    await mkdir(join(workDir, 'app'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('fails when getSignInUrl() is called in app/page.tsx', async () => {
    await writeFile(
      join(workDir, 'app/page.tsx'),
      `
import { getSignInUrl } from '@workos-inc/authkit-nextjs';
export default async function Page() {
  const url = await getSignInUrl();
  return <a href={url}>Sign in</a>;
}
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).not.toBeNull();
    expect(result!.file).toBe('app/page.tsx');
  });

  it('fails when getSignInUrl() is in a shared component without directive', async () => {
    await mkdir(join(workDir, 'app/components'), { recursive: true });
    await writeFile(
      join(workDir, 'app/components/nav-auth.tsx'),
      `
import { getSignInUrl } from '@workos-inc/authkit-nextjs';
export default async function NavAuth() {
  const url = await getSignInUrl();
  return <a href={url}>Sign in</a>;
}
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).not.toBeNull();
    expect(result!.file).toContain('nav-auth.tsx');
  });

  it('passes when getSignInUrl() is in a use client component', async () => {
    await writeFile(
      join(workDir, 'app/page.tsx'),
      `
'use client';
import { getSignInUrl } from '@workos-inc/authkit-nextjs';
export default function Page() {
  const handleClick = async () => { const url = await getSignInUrl(); window.location.href = url; };
  return <button onClick={handleClick}>Sign in</button>;
}
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).toBeNull();
  });

  it('passes when getSignInUrl() is in a top-level use server file', async () => {
    await mkdir(join(workDir, 'app/actions'), { recursive: true });
    await writeFile(
      join(workDir, 'app/actions/auth.tsx'),
      `
'use server';
import { getSignInUrl } from '@workos-inc/authkit-nextjs';
export async function getUrl() { return getSignInUrl(); }
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).toBeNull();
  });

  it('fails when use server is inline, not top-level', async () => {
    await writeFile(
      join(workDir, 'app/page.tsx'),
      `
import { getSignInUrl } from '@workos-inc/authkit-nextjs';
export default async function Page() {
  const url = await getSignInUrl();
  async function logout() {
    'use server';
    // server action
  }
  return <a href={url}>Sign in</a>;
}
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).not.toBeNull();
  });

  it('passes when no files contain getSignInUrl()', async () => {
    await writeFile(
      join(workDir, 'app/page.tsx'),
      `
export default function Page() {
  return <h1>Home</h1>;
}
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).toBeNull();
  });

  it('ignores mere mention of getSignInUrl without invocation', async () => {
    await writeFile(
      join(workDir, 'app/page.tsx'),
      `
// Do not use getSignInUrl in server components
export default function Page() { return <h1>Home</h1>; }
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).toBeNull();
  });

  it('ignores commented-out getSignInUrl() calls', async () => {
    await writeFile(
      join(workDir, 'app/page.tsx'),
      `
// don't call getSignInUrl() here
/* const url = await getSignInUrl(); */
export default function Page() { return <h1>Home</h1>; }
`,
    );
    const result = await findUnsafeGetSignInUrlUsage(workDir);
    expect(result).toBeNull();
  });
});
