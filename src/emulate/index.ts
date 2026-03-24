import { createServer, type ApiKeyMap } from './core/index.js';
import { workosPlugin, seedFromConfig, type WorkOSSeedConfig } from './workos/index.js';
import { serve } from '@hono/node-server';

export interface EmulatorSeedConfig {
  apiKeys?: Record<string, { environment: string }>;
  organizations?: WorkOSSeedConfig['organizations'];
  users?: WorkOSSeedConfig['users'];
  connections?: WorkOSSeedConfig['connections'];
}

export interface EmulatorOptions {
  port?: number;
  seed?: EmulatorSeedConfig;
}

export interface Emulator {
  url: string;
  port: number;
  close(): Promise<void>;
  reset(): void;
}

export async function createEmulator(options: EmulatorOptions = {}): Promise<Emulator> {
  const port = options.port ?? 4100;
  const baseUrl = `http://localhost:${port}`;

  const apiKeys: ApiKeyMap = options.seed?.apiKeys ?? {
    sk_test_default: { environment: 'test' },
  };

  const { app, store } = createServer(workosPlugin, {
    port,
    baseUrl,
    apiKeys,
  });

  // Health check endpoint
  app.get('/health', (c) => c.json({ status: 'ok' }));

  const seedFn = () => {
    workosPlugin.seed?.(store, baseUrl);
    if (options.seed) {
      seedFromConfig(store, baseUrl, options.seed);
    }
  };
  seedFn();

  const httpServer = serve({ fetch: app.fetch, port });

  // Resolve actual port (important for port: 0)
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://localhost:${actualPort}`;

  return {
    url,
    port: actualPort,
    reset() {
      store.reset();
      seedFn();
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
