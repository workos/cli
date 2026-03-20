import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDetect = vi.fn();
const mockCheckExistingVars = vi.fn();
const mockUploadEnvVars = vi.fn();

vi.mock('../../utils/clack.js', () => ({
  default: {
    select: vi.fn(),
    log: { warn: vi.fn(), info: vi.fn() },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
}));

vi.mock('../../utils/clack-utils.js', () => ({
  abortIfCancelled: vi.fn((promise) => promise),
}));

vi.mock('../../utils/analytics.js', () => ({
  analytics: { capture: vi.fn() },
}));

vi.mock('../../telemetry.js', () => ({
  traceStep: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
}));

// Mock the entire provider module with a proper class
vi.mock('./providers/vercel.js', () => {
  class MockVercel {
    name = 'Vercel';
    detect = mockDetect;
    checkExistingVars = mockCheckExistingVars;
    uploadEnvVars = mockUploadEnvVars;
  }
  return { VercelEnvironmentProvider: MockVercel };
});

import clack from '../../utils/clack.js';
import { uploadEnvironmentVariablesStep } from './index.js';

const mockClack = vi.mocked(clack);

describe('uploadEnvironmentVariablesStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when no provider detected', async () => {
    mockDetect.mockResolvedValue(false);

    const result = await uploadEnvironmentVariablesStep(
      { WORKOS_API_KEY: 'sk_test', WORKOS_CLIENT_ID: 'client_test' },
      { integration: 'nextjs', options: { installDir: '/test' } as any },
    );

    expect(result).toEqual([]);
  });

  it('warns about existing WorkOS vars before prompting', async () => {
    mockDetect.mockResolvedValue(true);
    mockCheckExistingVars.mockResolvedValue(['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'NODE_ENV']);
    mockClack.select.mockResolvedValue(false);

    await uploadEnvironmentVariablesStep(
      { WORKOS_API_KEY: 'sk_test' },
      { integration: 'nextjs', options: { installDir: '/test' } as any },
    );

    expect(mockClack.log.warn).toHaveBeenCalledWith(expect.stringContaining('WORKOS_API_KEY, WORKOS_CLIENT_ID'));
  });

  it('does not warn when no existing WorkOS vars', async () => {
    mockDetect.mockResolvedValue(true);
    mockCheckExistingVars.mockResolvedValue(['NODE_ENV', 'VERCEL_URL']);
    mockClack.select.mockResolvedValue(true);
    mockUploadEnvVars.mockResolvedValue({ WORKOS_API_KEY: true });

    await uploadEnvironmentVariablesStep(
      { WORKOS_API_KEY: 'sk_test' },
      { integration: 'nextjs', options: { installDir: '/test' } as any },
    );

    expect(mockClack.log.warn).not.toHaveBeenCalled();
  });

  it('proceeds normally when checkExistingVars returns empty', async () => {
    mockDetect.mockResolvedValue(true);
    mockCheckExistingVars.mockResolvedValue([]);
    mockClack.select.mockResolvedValue(true);
    mockUploadEnvVars.mockResolvedValue({ WORKOS_API_KEY: true });

    const result = await uploadEnvironmentVariablesStep(
      { WORKOS_API_KEY: 'sk_test' },
      { integration: 'nextjs', options: { installDir: '/test' } as any },
    );

    expect(mockClack.log.warn).not.toHaveBeenCalled();
    expect(result).toEqual(['WORKOS_API_KEY']);
  });
});
