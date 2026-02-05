import { defineConfig } from 'orval';

export default defineConfig({
  widgets: {
    output: {
      mode: 'single',
      target: './generated/widgets.ts',
      client: 'fetch',
    },
    input: {
      target: './widgets-open-api-spec.yaml',
    },
  },
});
