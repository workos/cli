import type { Hono } from 'hono';
import type { Store } from './store.js';
import type { JWTManager } from './jwt.js';
import type { WorkOSAppEnv } from './middleware/auth.js';

export interface RouteContext {
  app: Hono<WorkOSAppEnv>;
  store: Store;
  jwt: JWTManager;
  baseUrl: string;
}

export interface ServicePlugin {
  name: string;
  register(ctx: RouteContext): void;
  seed?(store: Store, baseUrl: string): void;
}
