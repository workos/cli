import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockClient = {
  sdk: {},
  redirectUris: { add: vi.fn() },
  corsOrigins: { add: vi.fn() },
  homepageUrl: { set: vi.fn() },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => mockClient,
}));

const { setOutputMode } = await import('../utils/output.js');

const { runConfigRedirectAdd, runConfigCorsAdd, runConfigHomepageUrlSet } = await import('./config.js');

describe('config commands', () => {
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

  describe('runConfigRedirectAdd', () => {
    it('adds redirect URI', async () => {
      mockClient.redirectUris.add.mockResolvedValue({ success: true, alreadyExists: false });
      await runConfigRedirectAdd('http://localhost:3000/callback', 'sk_test');
      expect(mockClient.redirectUris.add).toHaveBeenCalledWith('http://localhost:3000/callback');
      expect(consoleOutput.some((l) => l.includes('Added redirect URI'))).toBe(true);
    });

    it('handles already exists gracefully', async () => {
      mockClient.redirectUris.add.mockResolvedValue({ success: true, alreadyExists: true });
      await runConfigRedirectAdd('http://localhost:3000/callback', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('already exists'))).toBe(true);
    });
  });

  describe('runConfigCorsAdd', () => {
    it('adds CORS origin', async () => {
      mockClient.corsOrigins.add.mockResolvedValue({ success: true, alreadyExists: false });
      await runConfigCorsAdd('http://localhost:3000', 'sk_test');
      expect(mockClient.corsOrigins.add).toHaveBeenCalledWith('http://localhost:3000');
      expect(consoleOutput.some((l) => l.includes('Added CORS origin'))).toBe(true);
    });

    it('handles already exists gracefully', async () => {
      mockClient.corsOrigins.add.mockResolvedValue({ success: true, alreadyExists: true });
      await runConfigCorsAdd('http://localhost:3000', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('already exists'))).toBe(true);
    });
  });

  describe('runConfigHomepageUrlSet', () => {
    it('sets homepage URL', async () => {
      mockClient.homepageUrl.set.mockResolvedValue(undefined);
      await runConfigHomepageUrlSet('http://localhost:3000', 'sk_test');
      expect(mockClient.homepageUrl.set).toHaveBeenCalledWith('http://localhost:3000');
      expect(consoleOutput.some((l) => l.includes('Set homepage URL'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('runConfigRedirectAdd outputs JSON success', async () => {
      mockClient.redirectUris.add.mockResolvedValue({ success: true, alreadyExists: false });
      await runConfigRedirectAdd('http://localhost:3000/callback', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.uri).toBe('http://localhost:3000/callback');
    });

    it('runConfigRedirectAdd outputs JSON for already exists', async () => {
      mockClient.redirectUris.add.mockResolvedValue({ success: true, alreadyExists: true });
      await runConfigRedirectAdd('http://localhost:3000/callback', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.alreadyExists).toBe(true);
    });

    it('runConfigCorsAdd outputs JSON success', async () => {
      mockClient.corsOrigins.add.mockResolvedValue({ success: true, alreadyExists: false });
      await runConfigCorsAdd('http://localhost:3000', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.origin).toBe('http://localhost:3000');
    });

    it('runConfigHomepageUrlSet outputs JSON success', async () => {
      mockClient.homepageUrl.set.mockResolvedValue(undefined);
      await runConfigHomepageUrlSet('http://localhost:3000', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.url).toBe('http://localhost:3000');
    });
  });
});
