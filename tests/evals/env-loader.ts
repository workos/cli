import { config } from 'dotenv';
import { join } from 'node:path';

export interface EvalCredentials {
  anthropicApiKey: string;
  workosApiKey: string;
  workosClientId: string;
}

export function loadCredentials(): EvalCredentials {
  // Load from project root .env.local
  config({ path: join(process.cwd(), '.env.local') });

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const workosApiKey = process.env.WORKOS_API_KEY;
  const workosClientId = process.env.WORKOS_CLIENT_ID;

  if (!anthropicApiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not found.\n' +
        'Copy .env.local.example to .env.local and add your key:\n' +
        '  ANTHROPIC_API_KEY=sk-ant-...'
    );
  }

  // WorkOS credentials can be placeholder values for evals
  return {
    anthropicApiKey,
    workosApiKey: workosApiKey || 'sk_test_placeholder',
    workosClientId: workosClientId || 'client_placeholder',
  };
}
