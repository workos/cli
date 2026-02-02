import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    alias: {
      '~': resolve(__dirname, './app'),
    },
  },
});
