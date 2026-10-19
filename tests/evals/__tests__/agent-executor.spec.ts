import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Hoist mocks so they're available in vi.mock factories
const { mockRunAgent, mockIntegrationRun, mockConfig, mockCredentials } = vi.hoisted(() => ({
  mockRunAgent: vi.fn(),
  mockIntegrationRun: vi.fn(),
  mockConfig: {
    model: 'test-model',
    workos: { clientId: 'client_test', authkitDomain: 'test.workos.com', llmGatewayUrl: 'http://localhost:8000' },
    telemetry: { enabled: false, eventName: 'test_event' },
    proxy: { refreshThresholdMs: 300000 },
    nodeVersion: '20',
    logging: { debugMode: false },
    documentation: {
      workosDocsUrl: 'https://workos.com/docs',
      dashboardUrl: 'https://dashboard.workos.com',
      issuesUrl: 'https://github.com',
    },
    frameworks: {},
    legacy: { oauthPort: 3000 },
    branding: { showAsciiArt: false, asciiArt: '', compactAsciiArt: '', useCompact: false },
  },
  mockCredentials: {
    workosApiKey: 'sk_test_key',
    workosClientId: 'client_test_id',
    anthropicApiKey: 'sk-ant-test',
  },
}));

// Mock the production runAgent — this is what we're testing the wiring to
vi.mock('../../../src/lib/agent-interface.js', () => ({
  runAgent: mockRunAgent,
}));

// The eval runs the real integration flow; the integration itself is mocked here.
vi.mock('../../../src/lib/registry.js', () => ({
  getRegistry: vi.fn(async () => ({
    get: (name: string) => (name === 'unknown' ? undefined : { run: mockIntegrationRun }),
  })),
}));

vi.mock('../../../src/lib/agent-sdk-assets.js', () => ({
  ensureClaudeCodeExecutable: vi.fn(async () => '/synthetic/claude'),
}));

// Mock dependencies
vi.mock('../env-loader.js', () => ({
  loadCredentials: vi.fn(() => mockCredentials),
}));

vi.mock('../../../src/lib/env-writer.js', async (original) => ({
  ...(await original<typeof import('../../../src/lib/env-writer.js')>()),
  writeEnvLocal: vi.fn(),
}));

vi.mock('../../../src/utils/exec-file.js', () => ({
  execFileNoThrow: vi.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
}));

vi.mock('../../../src/lib/settings.js', () => ({
  getConfig: vi.fn(() => mockConfig),
}));

vi.mock('../../../src/lib/validation/quick-checks.js', () => ({
  quickCheckValidateAndFormat: vi.fn(),
}));

// Mock debug/analytics that agent-interface transitively imports
vi.mock('../../../src/utils/debug.js', () => ({
  debug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  initLogFile: vi.fn(),
  getLogFilePath: vi.fn(() => null),
}));

vi.mock('../../../src/utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn(),
    llmRequest: vi.fn(),
    incrementAgentIterations: vi.fn(),
    toolCalled: vi.fn(),
  },
}));

import { AgentExecutor } from '../agent-executor.js';
import { writeEnvLocal } from '../../../src/lib/env-writer.js';

describe('AgentExecutor', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'agent-executor-test-'));
    // Create package.json so env writing works
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'test' }));
    mockRunAgent.mockReset();
    mockIntegrationRun.mockReset();
    mockConfig.model = 'test-model';
    delete process.env.EVAL_MODEL;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('runs the real integration with installer options like production', async () => {
    mockIntegrationRun.mockResolvedValue('done');

    const executor = new AgentExecutor(testDir, 'nextjs');
    const result = await executor.run();

    expect(result.success).toBe(true);
    expect(mockIntegrationRun).toHaveBeenCalledTimes(1);
    const [options] = mockIntegrationRun.mock.calls[0];
    expect(options).toMatchObject({
      installDir: testDir,
      ci: true,
      skipAuth: true,
      direct: true,
      apiKey: 'sk_test_key',
      clientId: 'client_test_id',
      noValidate: false,
      maxRetries: 2,
    });
    expect(typeof options.onAgentMessage).toBe('function');
    expect(options.emitter).toBeDefined();
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('disables validation retries when correction is disabled', async () => {
    mockIntegrationRun.mockResolvedValue('done');

    await new AgentExecutor(testDir, 'nextjs').run({ enabled: false, maxRetries: 0 });

    expect(mockIntegrationRun.mock.calls[0][0]).toMatchObject({ noValidate: true, maxRetries: 0 });
  });

  it('counts agent:retry events as correction attempts', async () => {
    mockIntegrationRun.mockImplementation(async (options) => {
      options.emitter.emit('agent:retry', { attempt: 1, maxRetries: 2 });
      options.emitter.emit('agent:retry', { attempt: 2, maxRetries: 2 });
      return 'done';
    });

    const result = await new AgentExecutor(testDir, 'nextjs').run();

    expect(result.success).toBe(true);
    expect(result.correctionAttempts).toBe(2);
    expect(result.selfCorrected).toBe(true);
  });

  it('maps a thrown integration error to a failed result', async () => {
    mockIntegrationRun.mockRejectedValue(new Error('Installation validation failed'));

    const result = await new AgentExecutor(testDir, 'nextjs').run();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Installation validation failed');
    expect(result.selfCorrected).toBe(false);
  });

  it('records tool calls and text from agent messages', async () => {
    mockIntegrationRun.mockImplementation(async (options) => {
      options.onAgentMessage({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Installing AuthKit...' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'package.json' } },
          ],
        },
      });
      return 'done';
    });

    const result = await new AgentExecutor(testDir, 'nextjs').run();

    expect(result.output).toContain('Installing AuthKit...');
    expect(result.toolCalls).toEqual([expect.objectContaining({ tool: 'Read' })]);
  });

  it('applies EVAL_MODEL to the installer config', async () => {
    process.env.EVAL_MODEL = 'claude-opus-5-5';
    mockIntegrationRun.mockResolvedValue('done');

    await new AgentExecutor(testDir, 'nextjs').run();

    expect(mockConfig.model).toBe('claude-opus-5-5');
  });

  it('writes env vars before running the integration', async () => {
    mockIntegrationRun.mockImplementation(async () => {
      expect(writeEnvLocal).toHaveBeenCalledWith(testDir, {
        WORKOS_API_KEY: 'sk_test_key',
        WORKOS_CLIENT_ID: 'client_test_id',
      });
      return 'done';
    });

    const result = await new AgentExecutor(testDir, 'nextjs').run();
    expect(result.success).toBe(true);
  });

  it('rejects a framework with no installer integration', async () => {
    await expect(new AgentExecutor(testDir, 'unknown').run()).rejects.toThrow('No installer integration');
  });

  it('uses isolated Ruby environment and explicit callback without inheriting host secrets', async () => {
    mockRunAgent.mockResolvedValue({});
    const executor = new AgentExecutor(testDir, 'ruby', {
      environment: { HOME: '/synthetic/home', PATH: '/synthetic/bin' },
      redirectUri: 'http://app.fizzy.localhost:3006/auth/callback',
    });
    await executor.run({ enabled: false, maxRetries: 0 });
    const [config, prompt] = mockRunAgent.mock.calls[0];
    expect(config.sdkEnv.HOME).toBe('/synthetic/home');
    expect(config.sdkEnv.PATH).toBe('/synthetic/bin');
    expect(config.sdkEnv).not.toHaveProperty('WORKOS_API_KEY');
    expect(prompt).toContain('configured in .env:');
    expect(prompt).not.toContain('configured in .env.local');
    expect(prompt).toContain('WORKOS_REDIRECT_URI=http://app.fizzy.localhost:3006/auth/callback');
    expect(readFileSync(join(testDir, '.env'), 'utf8')).toContain(
      'WORKOS_REDIRECT_URI=http://app.fizzy.localhost:3006/auth/callback',
    );
  });
});
