import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameworkConfig } from './framework-config.js';
import type { InstallerOptions } from '../utils/types.js';

vi.mock('./skills-assets.js', () => ({ getReference: vi.fn() }));
vi.mock('./agent-interface.js', () => ({ initializeAgent: vi.fn(), runAgent: vi.fn() }));
vi.mock('./validation/index.js', () => ({ validateInstallation: vi.fn(), quickCheckValidateAndFormat: vi.fn() }));
vi.mock('./validation/security-checks.js', () => ({
  runInstallSecurityChecks: vi.fn(async () => ({ findings: [], blocking: [] })),
  securityFindingsToIssues: vi.fn(() => []),
  formatSecurityFindingsForAgent: vi.fn(() => ''),
}));
vi.mock('../steps/index.js', () => ({}));
vi.mock('./workos-management.js', () => ({ autoConfigureWorkOSEnvironment: vi.fn() }));
vi.mock('./env-writer.js', () => ({ writeEnvLocal: vi.fn() }));
vi.mock('../utils/ui-utils.js', () => ({
  ensurePackageIsInstalled: vi.fn(),
  getOrAskForWorkOSCredentials: vi.fn(async () => ({ apiKey: 'test-key', clientId: 'client_test' })),
  getPackageDotJson: vi.fn(async () => ({ dependencies: { next: '16.3.5' } })),
  isUsingTypeScript: vi.fn(() => true),
}));
vi.mock('../utils/analytics.js', () => ({
  analytics: { setTag: vi.fn(), capture: vi.fn(), shutdown: vi.fn() },
}));

import { getReference } from './skills-assets.js';
import { initializeAgent, runAgent } from './agent-interface.js';
import { runAgentInstaller } from './agent-runner.js';
import { validateInstallation, quickCheckValidateAndFormat } from './validation/index.js';
import { autoConfigureWorkOSEnvironment } from './workos-management.js';
import { writeEnvLocal } from './env-writer.js';
import { getOrAskForWorkOSCredentials } from '../utils/ui-utils.js';

const options: InstallerOptions = {
  debug: false,
  forceInstall: false,
  installDir: '/tmp/test-authkit-app',
  local: false,
  ci: true,
  skipAuth: true,
  clientId: 'client_test',
  noValidate: true,
};

const config: FrameworkConfig = {
  metadata: {
    name: 'Next.js',
    integration: 'nextjs',
    skillName: 'workos-authkit-nextjs',
    language: 'javascript',
    docsUrl: 'https://workos.com/docs/authkit/nextjs',
    stability: 'stable',
    priority: 100,
  },
  detection: { packageName: 'next', packageDisplayName: 'Next.js', getVersion: () => '16.3.5' },
  environment: { requiresApiKey: true, uploadToHosting: false, getEnvVars: () => ({}) },
  analytics: { getTags: () => ({}) },
  prompts: { getAdditionalContextLines: () => ['Router: app'] },
  ui: { successMessage: 'Installed', getOutroChanges: () => [], getOutroNextSteps: () => [] },
};

const setupContent = 'Configure and read back Sign-out URI and Initiate login URI. Report unverified flows.';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getReference).mockImplementation(async (name) => {
    if (name === 'workos-authkit-setup') return setupContent;
    return `Instructions from ${name}`;
  });
  vi.mocked(runAgent).mockResolvedValue({});
  vi.mocked(quickCheckValidateAndFormat).mockResolvedValue(null);
  vi.mocked(validateInstallation).mockResolvedValue({ passed: true, framework: 'nextjs', issues: [], durationMs: 0 });
});

describe('installer prompt', () => {
  it.each(['javascript', 'php'] as const)('injects shared application setup for %s integrations', async (language) => {
    const framework = {
      ...config,
      metadata: {
        ...config.metadata,
        language,
        integration: language === 'javascript' ? 'nextjs' : 'php',
        skillName: language === 'javascript' ? 'workos-authkit-nextjs' : 'workos-php',
      },
    };
    await runAgentInstaller(framework, options);

    const prompt = vi.mocked(runAgent).mock.calls[0][1];
    if (framework.metadata.integration === 'nextjs') {
      expect(getReference).toHaveBeenCalledWith('workos-authkit-setup');
      expect(prompt).toContain(setupContent);
    } else {
      expect(getReference).not.toHaveBeenCalledWith('workos-authkit-setup');
      expect(prompt).not.toContain(setupContent);
      expect(prompt).not.toContain('installer handles supported dashboard configuration');
    }
    expect(prompt).toContain(`Instructions from ${framework.metadata.skillName}`);
    expect(prompt).toContain('Router: app');
    expect(prompt).not.toContain('test-key');
    if (language === 'javascript') {
      expect(prompt).toContain('NEXT_PUBLIC_WORKOS_REDIRECT_URI');
      expect(prompt).toContain('Instructions from workos-authkit-base');
    } else {
      expect(prompt).toContain('WORKOS_REDIRECT_URI');
      expect(prompt).not.toContain('NEXT_PUBLIC_WORKOS_REDIRECT_URI');
      expect(getReference).not.toHaveBeenCalledWith('workos-authkit-base');
    }
  });

  const promptFor = async (integration: FrameworkConfig['metadata']['integration'], skillName: string) => {
    const requiresApiKey = !['react', 'vanilla-js'].includes(integration);
    await runAgentInstaller(
      {
        ...config,
        metadata: { ...config.metadata, integration, skillName },
        environment: { ...config.environment, requiresApiKey },
      },
      options,
    );
    return vi.mocked(runAgent).mock.calls[0][1];
  };

  it('tells a client-only app to add a /login route and pass its redirect URI', async () => {
    const prompt = await promptFor('react', 'workos-authkit-react');
    expect(prompt).toContain('## Sign-in route (Initiate login URI)');
    expect(prompt).toContain('the app origin plus /login');
    expect(prompt).toContain('add a /login client route');
    expect(prompt).toContain("if (window.location.pathname === '/login') { void signIn(); }");
    expect(prompt).toContain('Keep the call directly in that branch, not in a click handler or another function.');
    expect(prompt).toContain('VITE_WORKOS_REDIRECT_URI for Vite');
  });

  it("pins a server SDK to its guide's sign-in route without the client-only steps", async () => {
    const prompt = await promptFor('kotlin', 'workos-kotlin');
    expect(prompt).toContain('the app origin plus /auth/login');
    expect(prompt).not.toContain('client route');
  });

  it.each([
    ['react-router', '/login'],
    ['tanstack-start', '/api/auth/sign-in'],
    ['sveltekit', '/sign-in'],
    ['node', '/login'],
    ['php', '/login.php'],
  ])('pins %s to its documented sign-in route %s', async (integration, path) => {
    const prompt = await promptFor(integration, `workos-${integration}`);
    expect(prompt).toContain(`the app origin plus ${path}.`);
  });

  it('leaves Next.js to its own sign-in instructions', async () => {
    const prompt = await promptFor('nextjs', 'workos-authkit-nextjs');
    expect(prompt).not.toContain('## Sign-in route (Initiate login URI)');
  });

  it('declines Pages Router before requesting credentials, writing files, or starting the agent', async () => {
    const framework = {
      ...config,
      metadata: { ...config.metadata, gatherContext: async () => ({ router: 'pages-router' }) },
    };
    await expect(runAgentInstaller(framework, options)).rejects.toMatchObject({
      code: 'unsupported_nextjs_router',
    });
    expect(getOrAskForWorkOSCredentials).not.toHaveBeenCalled();
    expect(writeEnvLocal).not.toHaveBeenCalled();
    expect(initializeAgent).not.toHaveBeenCalled();
  });

  it('does not register a callback in the API-key environment when run directly', async () => {
    await runAgentInstaller(config, { ...options, clientId: undefined });
    expect(autoConfigureWorkOSEnvironment).not.toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalled();
  });

  it.each(['tanstack-start', 'react', 'react-router', 'vanilla-js'])(
    'keeps %s completeness checks advisory',
    async (integration) => {
      const framework = { ...config, metadata: { ...config.metadata, integration } };
      vi.mocked(validateInstallation).mockResolvedValue({
        passed: false,
        framework: integration,
        durationMs: 0,
        issues: [
          { type: 'file', severity: 'error', message: 'Legacy layout missing', hint: 'Install obsolete package' },
        ],
      });
      await expect(runAgentInstaller(framework, { ...options, noValidate: false })).resolves.toContain('Successfully');
      const retry = vi.mocked(runAgent).mock.calls[0][5]!;
      expect(await retry.validateAndFormat(options.installDir)).toBeNull();
      vi.mocked(quickCheckValidateAndFormat).mockResolvedValue('Fix a genuine build failure');
      expect(await retry.validateAndFormat(options.installDir)).toBe('Fix a genuine build failure');
    },
  );

  it('blocks success when an application route is still missing after retries', async () => {
    vi.mocked(validateInstallation).mockResolvedValue({
      passed: false,
      framework: 'nextjs',
      durationMs: 0,
      issues: [{ type: 'file', severity: 'error', message: 'Missing sign-in route', hint: 'Create /sign-in' }],
    });
    await expect(runAgentInstaller(config, { ...options, noValidate: false })).rejects.toThrow('Missing sign-in route');
    const retry = vi.mocked(runAgent).mock.calls[0][5];
    expect(await retry!.validateAndFormat(options.installDir)).toContain('Create /sign-in');
  });

  it('does not start the agent when the bundled setup reference is missing', async () => {
    vi.mocked(getReference).mockImplementation(async (name) => {
      if (name === 'workos-authkit-setup') throw new Error('Missing bundled setup reference');
      return `Instructions from ${name}`;
    });

    await expect(runAgentInstaller(config, options)).rejects.toThrow('Missing bundled setup reference');
    expect(initializeAgent).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });
});
