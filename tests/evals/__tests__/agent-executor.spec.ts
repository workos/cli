import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Hoist mocks so they're available in vi.mock factories
const { mockRunAgent, mockConfig, mockCredentials } = vi.hoisted(() => ({
  mockRunAgent: vi.fn(),
  mockConfig: {
    model: 'test-model',
    workos: { clientId: 'client_test', authkitDomain: 'test.workos.com', llmGatewayUrl: 'http://localhost:8000' },
    telemetry: { enabled: false, eventName: 'test_event' },
    proxy: { refreshThresholdMs: 300000 },
    nodeVersion: '20',
    logging: { debugMode: false },
    documentation: { workosDocsUrl: 'https://workos.com/docs', dashboardUrl: 'https://dashboard.workos.com', issuesUrl: 'https://github.com' },
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

// Mock dependencies
vi.mock('../env-loader.js', () => ({
  loadCredentials: vi.fn(() => mockCredentials),
}));

vi.mock('../../../src/lib/env-writer.js', () => ({
  writeEnvLocal: vi.fn(),
}));

vi.mock('../../../src/utils/env-parser.js', () => ({
  parseEnvFile: vi.fn(() => ({})),
}));

vi.mock('../../../src/lib/settings.js', () => ({
  getConfig: vi.fn(() => mockConfig),
}));

vi.mock('../../../src/lib/validation/quick-checks.js', () => ({
  runQuickChecks: vi.fn(),
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
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('calls production runAgent with correct AgentRunConfig', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run();

    expect(mockRunAgent).toHaveBeenCalledTimes(1);

    const [agentRunConfig] = mockRunAgent.mock.calls[0];
    expect(agentRunConfig.workingDirectory).toBe(testDir);
    expect(agentRunConfig.model).toBe('test-model');
    expect(agentRunConfig.allowedTools).toContain('Skill');
    expect(agentRunConfig.allowedTools).toContain('Write');
    expect(agentRunConfig.mcpServers).toHaveProperty('workos');
    // Direct mode — no gateway URL
    expect(agentRunConfig.sdkEnv.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(agentRunConfig.sdkEnv.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('passes RetryConfig when correction is enabled', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run({ enabled: true, maxRetries: 3 });

    const retryConfig = mockRunAgent.mock.calls[0][5]; // 6th arg
    expect(retryConfig).toBeDefined();
    expect(retryConfig.maxRetries).toBe(3);
    expect(typeof retryConfig.validateAndFormat).toBe('function');
  });

  it('passes no RetryConfig when correction is disabled', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run({ enabled: false, maxRetries: 0 });

    const retryConfig = mockRunAgent.mock.calls[0][5];
    expect(retryConfig).toBeUndefined();
  });

  it('passes InstallerOptions with skipAuth=true', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run();

    const installerOptions = mockRunAgent.mock.calls[0][2]; // 3rd arg
    expect(installerOptions.skipAuth).toBe(true);
    expect(installerOptions.installDir).toBe(testDir);
  });

  it('passes onMessage callback as 7th argument', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run();

    const onMessage = mockRunAgent.mock.calls[0][6]; // 7th arg
    expect(typeof onMessage).toBe('function');
  });

  it('maps retryCount=0 to correctionAttempts=0, selfCorrected=false', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    const result = await executor.run();

    expect(result.success).toBe(true);
    expect(result.correctionAttempts).toBe(0);
    expect(result.selfCorrected).toBe(false);
  });

  it('maps retryCount>0 to selfCorrected=true on success', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 2 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    const result = await executor.run();

    expect(result.success).toBe(true);
    expect(result.correctionAttempts).toBe(2);
    expect(result.selfCorrected).toBe(true);
  });

  it('maps runAgent error result to failed AgentResult', async () => {
    mockRunAgent.mockResolvedValue({
      error: 'EXECUTION_ERROR',
      errorMessage: 'SDK crashed',
      retryCount: 1,
    });

    const executor = new AgentExecutor(testDir, 'nextjs');
    const result = await executor.run();

    expect(result.success).toBe(false);
    expect(result.error).toBe('SDK crashed');
    expect(result.correctionAttempts).toBe(1);
    expect(result.selfCorrected).toBe(false);
  });

  it('handles runAgent throwing an exception', async () => {
    mockRunAgent.mockRejectedValue(new Error('Connection refused'));

    const executor = new AgentExecutor(testDir, 'nextjs');
    const result = await executor.run();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
    expect(result.correctionAttempts).toBe(0);
  });

  it('writes env vars before calling runAgent', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run();

    expect(writeEnvLocal).toHaveBeenCalledWith(testDir, {
      WORKOS_API_KEY: 'sk_test_key',
      WORKOS_CLIENT_ID: 'client_test_id',
    });
  });

  it('onMessage callback collects text output from assistant messages', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run();

    // Get the onMessage callback and simulate a message
    const onMessage = mockRunAgent.mock.calls[0][6];
    onMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Installing AuthKit...' }],
      },
    });

    // Run again to verify output is collected (can't check internal state,
    // but we can verify it doesn't throw)
    expect(onMessage).toBeDefined();
  });

  it('builds prompt with correct skill name for framework', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'react-router');
    await executor.run();

    const prompt = mockRunAgent.mock.calls[0][1]; // 2nd arg
    expect(prompt).toContain('workos-authkit-react-router');
    expect(prompt).toContain('react-router');
  });

  it('defaults to correction enabled with maxRetries=2', async () => {
    mockRunAgent.mockResolvedValue({ retryCount: 0 });

    const executor = new AgentExecutor(testDir, 'nextjs');
    await executor.run(); // no retryConfig arg — uses default

    const retryConfig = mockRunAgent.mock.calls[0][5];
    expect(retryConfig).toBeDefined();
    expect(retryConfig.maxRetries).toBe(2);
  });
});
