import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  portal: {
    generateLink: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runPortalGenerateLink } = await import('./portal.js');

describe('portal commands', () => {
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

  describe('runPortalGenerateLink', () => {
    it('generates portal link with correct params', async () => {
      mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/abc' });
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123' }, 'sk_test');
      expect(mockSdk.portal.generateLink).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'sso', organization: 'org_123' }),
      );
    });

    it('outputs link URL in human mode', async () => {
      mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/abc' });
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('https://portal.workos.com/abc'))).toBe(true);
    });

    it('shows expiry note in human mode', async () => {
      mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/abc' });
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('expire'))).toBe(true);
    });

    it('passes optional returnUrl and successUrl', async () => {
      mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/abc' });
      await runPortalGenerateLink(
        {
          intent: 'dsync',
          organization: 'org_123',
          returnUrl: 'https://app.com/return',
          successUrl: 'https://app.com/success',
        },
        'sk_test',
      );
      expect(mockSdk.portal.generateLink).toHaveBeenCalledWith(
        expect.objectContaining({ returnUrl: 'https://app.com/return', successUrl: 'https://app.com/success' }),
      );
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs full response object', async () => {
      mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/abc' });
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.link).toBe('https://portal.workos.com/abc');
    });
  });
});
