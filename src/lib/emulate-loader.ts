import { loadRuntimeBundle } from './runtime-assets.js';

/**
 * The compiled-in signature stays the compile-time contract: a runtime bundle
 * is only ever cast to it after a shape check, never trusted for new API.
 */
export type CreateEmulatorFn = (typeof import('@workos/emulate'))['createEmulator'];

/**
 * Resolve `createEmulator`, preferring the runtime-downloaded @workos/emulate
 * bundle (see runtime-assets.ts) and falling back to the compiled-in package
 * when no bundle is available or it lacks the expected export.
 */
export async function resolveCreateEmulator(): Promise<CreateEmulatorFn> {
  const bundle = await loadRuntimeBundle('emulate');
  const candidate = bundle?.createEmulator;
  if (typeof candidate === 'function') {
    return candidate as CreateEmulatorFn;
  }
  const { createEmulator } = await import('@workos/emulate');
  return createEmulator;
}
