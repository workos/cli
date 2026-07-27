export const IS_WINDOWS = process.platform === 'win32';

/**
 * Options for cross-platform spawn calls.
 * On Windows, .cmd/.bat shims require shell: true to resolve.
 */
export const SPAWN_OPTS = { shell: IS_WINDOWS } as const;
