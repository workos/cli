/**
 * Development entry point that loads .env.local before running the CLI.
 * Use this instead of bin.ts during local development.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local from the package directory
config({ path: resolve(__dirname, '.env.local'), quiet: true });

// Now import and run the actual CLI
import './bin.js';
