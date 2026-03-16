import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

// Stub out optional/dev-only packages that shouldn't be in the production bundle
const stubPlugin = {
  name: 'stub-optional-deps',
  setup(b) {
    const stubs = ['react-devtools-core', '@statelyai/inspect', 'dotenv'];
    for (const pkg of stubs) {
      b.onResolve({ filter: new RegExp(`^${pkg.replace('/', '\\/')}$`) }, () => ({
        path: pkg,
        namespace: 'stub',
      }));
    }
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default undefined;',
      loader: 'js',
    }));
  },
};

// Step 1: Bundle to ESM (required because ink/yoga-layout use top-level await).
// IMPORTANT: minify must be false — the CJS conversion in step 2 uses line-start
// anchored regexes to distinguish real import declarations from string content.
await build({
  entryPoints: ['src/bin.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  minify: false,
  outfile: 'dist/cli.mjs',
  plugins: [stubPlugin],
  jsx: 'automatic',
  target: 'node20',
  banner: {
    js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);',
  },
});

// Step 2: Post-process ESM → CJS for Node SEA compatibility.
// The ESM bundle is self-contained (all deps inlined). We convert ESM syntax to CJS
// because Node SEA with CJS avoids import.meta.url issues (SEA sets it to "node:sea").
//
// Why not bundle directly to CJS? The codebase and dependencies (ink, yoga-layout)
// use top-level await, which esbuild refuses to compile to CJS format.
let esm = readFileSync('dist/cli.mjs', 'utf-8');

// Remove shebang (we'll add it back)
const shebang = esm.startsWith('#!') ? esm.slice(0, esm.indexOf('\n') + 1) : '';
if (shebang) esm = esm.slice(shebang.length);

// Remove the ESM createRequire banner (CJS has require() natively)
esm = esm.replace(
  /^import \{ createRequire as __bundleCreateRequire \} from "node:module"; const require = __bundleCreateRequire\(import\.meta\.url\);\n/,
  '',
);

// Convert ESM imports to CJS require().
// Only match lines that START with 'import' (real import declarations),
// not 'import' embedded inside strings or template literals.

// Named imports: import { X as Y } from "mod" → var { X: Y } = require("mod")
esm = esm.replace(
  /^import (\{[^}]+\}) from\s*"([^"]+)";?$/gm,
  (_, names, mod) => {
    const fixed = names.replace(/([\w$]+) as ([\w$]+)/g, '$1: $2');
    return `var ${fixed} = require("${mod}");`;
  },
);
// Default imports: import X from "mod" → var X = require("mod")
esm = esm.replace(
  /^import (\w+) from\s*"([^"]+)";?$/gm,
  'var $1 = require("$2");',
);
// Namespace imports: import * as X from "mod" → var X = require("mod")
esm = esm.replace(
  /^import \* as (\w+) from\s*"([^"]+)";?$/gm,
  'var $1 = require("$2");',
);
// Side-effect imports: import "mod" → require("mod")
esm = esm.replace(
  /^import\s+"([^"]+)";?$/gm,
  'require("$1");',
);

// Replace import.meta.url with CJS equivalent
esm = esm.replace(/import\.meta\.url/g, 'require("url").pathToFileURL(__filename).href');
// Replace import.meta.resolve with CJS require.resolve
esm = esm.replace(/import\.meta\.resolve/g, 'require.resolve');

// Validate: no residual ESM import/export declarations should remain
const residualImports = (esm.match(/^import\s/gm) || []).length;
const residualExports = (esm.match(/^export\s/gm) || []).length;
if (residualImports > 0 || residualExports > 0) {
  console.error(`ERROR: CJS conversion incomplete — ${residualImports} import and ${residualExports} export statements remain`);
  process.exit(1);
}

// Wrap in async IIFE for TLA support.
// Force stdout/stderr to blocking mode so yargs --help flushes before exit.
const cjs = `${shebang}if (process.stdout._handle && process.stdout._handle.setBlocking) process.stdout._handle.setBlocking(true);
if (process.stderr._handle && process.stderr._handle.setBlocking) process.stderr._handle.setBlocking(true);
(async () => {
${esm}
})().catch((e) => { console.error(e); process.exit(1); });
`;

writeFileSync('dist/cli.cjs', cjs);
