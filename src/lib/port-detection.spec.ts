import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { detectPort } from './port-detection.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

vi.mock('./settings.js', () => ({
  getConfig: () => ({
    frameworks: {},
  }),
}));

const mockReadFileSync = vi.mocked(fs.readFileSync);

describe('port-detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectPort for nextjs', () => {
    it('detects port from -p flag in dev script', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ scripts: { dev: 'next dev -p 4000' } }),
      );
      expect(detectPort('nextjs', '/test')).toBe(4000);
    });

    it('detects port from --port flag in dev script', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ scripts: { dev: 'next dev --port 5000' } }),
      );
      expect(detectPort('nextjs', '/test')).toBe(5000);
    });

    it('detects port from --port= flag in dev script', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ scripts: { dev: 'next dev --port=3123' } }),
      );
      expect(detectPort('nextjs', '/test')).toBe(3123);
    });

    it('detects PORT=NNNN inline env var in dev script', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ scripts: { dev: 'PORT=3123 next dev' } }),
      );
      expect(detectPort('nextjs', '/test')).toBe(3123);
    });

    it('prefers -p flag over PORT= env var', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ scripts: { dev: 'PORT=4000 next dev -p 5000' } }),
      );
      expect(detectPort('nextjs', '/test')).toBe(5000);
    });

    it('falls back to .env file PORT when no script port', () => {
      // First call: package.json (no port in script)
      mockReadFileSync.mockReturnValueOnce(
        JSON.stringify({ scripts: { dev: 'next dev' } }),
      );
      // Second call: .env.local
      mockReadFileSync.mockReturnValueOnce('PORT=3123\nOTHER_VAR=foo');

      expect(detectPort('nextjs', '/test')).toBe(3123);
    });

    it('falls back to default 3000 when no port found anywhere', () => {
      // package.json - no port
      mockReadFileSync.mockReturnValueOnce(
        JSON.stringify({ scripts: { dev: 'next dev' } }),
      );
      // All .env files throw (don't exist)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(detectPort('nextjs', '/test')).toBe(3000);
    });
  });
});
