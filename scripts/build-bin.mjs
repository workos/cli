#!/usr/bin/env node

/**
 * Build a standalone binary using Node.js Single Executable Applications (SEA).
 * https://nodejs.org/api/single-executable-applications.html
 *
 * Pipeline: esbuild (bundle) → SEA blob → inject into node binary
 *
 * Why SEA instead of @yao-pkg/pkg:
 * pkg produced SIGSEGV crashes on commands beyond --version due to V8 bytecode
 * compilation issues with our ~4MB CJS bundle. SEA uses the real Node binary
 * with our code injected, avoiding the bytecode compilation layer entirely.
 *
 * Platform notes:
 * - macOS: requires codesign --remove-signature before injection, then codesign --sign - after
 * - Linux: no signing needed
 * - Windows: no signing needed; output is workos.exe
 */

import { execFileSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import { platform } from 'node:os';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

const OUTPUT = platform() === 'win32' ? 'dist/workos.exe' : 'dist/workos';
const BLOB = 'dist/sea-prep.blob';
// Official Node.js SEA fuse string — see https://nodejs.org/api/single-executable-applications.html
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// Step 1: Bundle with esbuild (produces dist/cli.mjs + dist/cli.cjs)
console.log('→ Bundling...');
run('node', ['esbuild.config.mjs']);

// Step 2: Generate SEA blob
console.log('→ Generating SEA blob...');
run('node', ['--experimental-sea-config', 'sea-config.json']);

// Step 3: Copy the node binary
console.log('→ Copying node binary...');
cpSync(process.execPath, OUTPUT);

// Step 4: Remove code signature (macOS only)
if (platform() === 'darwin') {
  console.log('→ Removing macOS code signature...');
  run('codesign', ['--remove-signature', OUTPUT]);
}

// Step 5: Inject the blob
console.log('→ Injecting SEA blob...');
const postjectArgs = [
  OUTPUT,
  'NODE_SEA_BLOB',
  BLOB,
  '--sentinel-fuse', SENTINEL,
];
if (platform() === 'darwin') {
  postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}
run('npx', ['postject@1.0.0-alpha.6', ...postjectArgs]);

// Step 6: Re-sign (macOS only)
if (platform() === 'darwin') {
  console.log('→ Re-signing binary...');
  run('codesign', ['--sign', '-', OUTPUT]);
}

console.log(`✓ Built ${OUTPUT}`);
