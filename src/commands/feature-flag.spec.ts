import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  featureFlags: {
    listFeatureFlags: vi.fn(),
    getFeatureFlag: vi.fn(),
    enableFeatureFlag: vi.fn(),
    disableFeatureFlag: vi.fn(),
    addFlagTarget: vi.fn(),
    removeFlagTarget: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const {
  runFeatureFlagList,
  runFeatureFlagGet,
  runFeatureFlagEnable,
  runFeatureFlagDisable,
  runFeatureFlagAddTarget,
  runFeatureFlagRemoveTarget,
} = await import('./feature-flag.js');

const mockFlag = {
  id: 'ff_123',
  slug: 'coffee',
  name: 'Coffee Feature',
  description: 'Enables coffee',
  enabled: true,
  defaultValue: false,
  tags: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('feature-flag commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runFeatureFlagList', () => {
    it('lists flags in table', async () => {
      mockSdk.featureFlags.listFeatureFlags.mockResolvedValue({
        data: [mockFlag],
        listMetadata: { before: null, after: null },
      });
      await runFeatureFlagList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('coffee'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('Coffee Feature'))).toBe(true);
    });

    it('passes pagination params', async () => {
      mockSdk.featureFlags.listFeatureFlags.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runFeatureFlagList({ limit: 5, order: 'desc' }, 'sk_test');
      expect(mockSdk.featureFlags.listFeatureFlags).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, order: 'desc' }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.featureFlags.listFeatureFlags.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runFeatureFlagList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No feature flags found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.featureFlags.listFeatureFlags.mockResolvedValue({
        data: [mockFlag],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runFeatureFlagList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runFeatureFlagGet', () => {
    it('fetches flag by slug', async () => {
      mockSdk.featureFlags.getFeatureFlag.mockResolvedValue(mockFlag);
      await runFeatureFlagGet('coffee', 'sk_test');
      expect(mockSdk.featureFlags.getFeatureFlag).toHaveBeenCalledWith('coffee');
      expect(consoleOutput.some((l) => l.includes('coffee'))).toBe(true);
    });
  });

  describe('runFeatureFlagEnable', () => {
    it('enables flag', async () => {
      mockSdk.featureFlags.enableFeatureFlag.mockResolvedValue({ ...mockFlag, enabled: true });
      await runFeatureFlagEnable('coffee', 'sk_test');
      expect(mockSdk.featureFlags.enableFeatureFlag).toHaveBeenCalledWith('coffee');
      expect(consoleOutput.some((l) => l.includes('Enabled feature flag'))).toBe(true);
    });
  });

  describe('runFeatureFlagDisable', () => {
    it('disables flag', async () => {
      mockSdk.featureFlags.disableFeatureFlag.mockResolvedValue({ ...mockFlag, enabled: false });
      await runFeatureFlagDisable('coffee', 'sk_test');
      expect(mockSdk.featureFlags.disableFeatureFlag).toHaveBeenCalledWith('coffee');
      expect(consoleOutput.some((l) => l.includes('Disabled feature flag'))).toBe(true);
    });
  });

  describe('runFeatureFlagAddTarget', () => {
    it('adds target with slug and targetId', async () => {
      mockSdk.featureFlags.addFlagTarget.mockResolvedValue(undefined);
      await runFeatureFlagAddTarget('coffee', 'user_123', 'sk_test');
      expect(mockSdk.featureFlags.addFlagTarget).toHaveBeenCalledWith({ slug: 'coffee', targetId: 'user_123' });
      expect(consoleOutput.some((l) => l.includes('Added target'))).toBe(true);
    });
  });

  describe('runFeatureFlagRemoveTarget', () => {
    it('removes target with slug and targetId', async () => {
      mockSdk.featureFlags.removeFlagTarget.mockResolvedValue(undefined);
      await runFeatureFlagRemoveTarget('coffee', 'user_123', 'sk_test');
      expect(mockSdk.featureFlags.removeFlagTarget).toHaveBeenCalledWith({ slug: 'coffee', targetId: 'user_123' });
      expect(consoleOutput.some((l) => l.includes('Removed target'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('list outputs { data, listMetadata }', async () => {
      mockSdk.featureFlags.listFeatureFlags.mockResolvedValue({
        data: [mockFlag],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runFeatureFlagList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].slug).toBe('coffee');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('list outputs empty data array for no results', async () => {
      mockSdk.featureFlags.listFeatureFlags.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runFeatureFlagList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
    });

    it('get outputs raw JSON', async () => {
      mockSdk.featureFlags.getFeatureFlag.mockResolvedValue(mockFlag);
      await runFeatureFlagGet('coffee', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.slug).toBe('coffee');
      expect(output).not.toHaveProperty('status');
    });

    it('enable outputs JSON success', async () => {
      mockSdk.featureFlags.enableFeatureFlag.mockResolvedValue({ ...mockFlag, enabled: true });
      await runFeatureFlagEnable('coffee', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Enabled feature flag');
    });
  });
});
