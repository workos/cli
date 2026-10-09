import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadRuntimeBundle: vi.fn(),
  compiledCreateEmulator: vi.fn(),
}));

vi.mock('./runtime-assets.js', () => ({
  loadRuntimeBundle: mocks.loadRuntimeBundle,
}));

vi.mock('@workos/emulate', () => ({
  createEmulator: mocks.compiledCreateEmulator,
}));

const { resolveCreateEmulator } = await import('./emulate-loader.js');

describe('resolveCreateEmulator', () => {
  beforeEach(() => {
    mocks.loadRuntimeBundle.mockReset();
  });

  it('uses the runtime bundle createEmulator when present', async () => {
    const runtimeCreateEmulator = vi.fn();
    mocks.loadRuntimeBundle.mockResolvedValue({ createEmulator: runtimeCreateEmulator });

    expect(await resolveCreateEmulator()).toBe(runtimeCreateEmulator);
    expect(mocks.loadRuntimeBundle).toHaveBeenCalledWith('emulate');
  });

  it('falls back to the compiled-in module when no bundle is available', async () => {
    mocks.loadRuntimeBundle.mockResolvedValue(null);

    expect(await resolveCreateEmulator()).toBe(mocks.compiledCreateEmulator);
  });

  it('falls back when the bundle lacks a createEmulator function', async () => {
    mocks.loadRuntimeBundle.mockResolvedValue({ createEmulator: 'not-a-function' });

    expect(await resolveCreateEmulator()).toBe(mocks.compiledCreateEmulator);
  });
});
