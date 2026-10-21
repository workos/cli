import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'bun-import-attributes',
      enforce: 'pre',
      transform(code, id) {
        if (id.includes('/src/generated/') && code.includes("with { type: 'file' }")) {
          return code.replace(/import ([A-Za-z_$][\w$]*) from ("[^"]+") with \{ type: 'file' \};/g, 'const $1 = $2;');
        }

        if (code.includes("with { type: 'text' }")) {
          return code.replace(/from ('[^']+') with \{ type: 'text' \}/g, (_match, specifier: string) => {
            return `from ${specifier.slice(0, -1)}?raw'`;
          });
        }
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.ts', 'tests/evals/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/*.d.ts', '**/node_modules/**', '**/dist/**'],
    },
  },
});
