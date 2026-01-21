import { config } from 'dotenv';

// Load .env.local first, then .env as fallback
config({ path: '.env.local' });
config({ path: '.env' });

import { initTelemetry, shutdownTelemetry } from './telemetry/index.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { validateJWT } from './jwt.js';
import { telemetry } from './routes/telemetry.js';
import { gatewayRequests, gatewayTokensIn, gatewayTokensOut } from './telemetry/metrics.js';

// Initialize OTel before creating app
initTelemetry(env.OTEL_SERVICE_NAME || 'workos-authkit-wizard');

const app = new Hono();
const PORT = Number(env.PORT) || 8000;

// Anthropic client (uses ANTHROPIC_API_KEY from env)
const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

app.use('*', cors());

// Mount telemetry route
app.route('/telemetry', telemetry);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'workos-llm-gateway' });
});

// Check if local development mode is enabled via env var
const isLocalMode = env.LOCAL_MODE === 'true' || env.LOCAL_MODE === '1';

// Anthropic Messages API proxy
app.post('/v1/messages', async (c) => {
  let userId = 'anonymous';

  try {
    const authHeader = c.req.header('authorization');
    const hasToken = authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 7;

    // If token provided, always validate it
    if (hasToken) {
      const accessToken = authHeader.replace('Bearer ', '');
      const validation = await validateJWT(accessToken);

      if (!validation.valid) {
        console.log(`[Auth] JWT validation failed: ${validation.error}`);
        return c.json(
          {
            error: validation.error || 'Invalid token',
            hint: 'Run `wizard login` to authenticate',
          },
          401,
        );
      }

      userId = validation.payload?.sub || 'unknown';
      console.log(`[Auth] Request from user: ${userId}`);
    } else if (isLocalMode) {
      // No token but LOCAL_MODE enabled - allow for local development
      userId = 'local-dev';
      console.log(`[Auth] Local development mode (LOCAL_MODE=true, no token)`);
    } else {
      // No token and not in local mode - reject
      return c.json(
        {
          error: 'Missing Authorization header',
          hint: 'Run `wizard login` to authenticate',
        },
        401,
      );
    }

    const body = await c.req.json();
    const model = body.model || 'unknown';
    console.log(`[Proxy] Model: ${model}, Max tokens: ${body.max_tokens}`);

    // Track request
    gatewayRequests.add(1, { user: userId, model });

    // Check if streaming is requested
    const stream = body.stream === true;

    if (stream) {
      // Streaming response using SSE
      return streamSSE(c, async (sseStream) => {
        const messageStream = anthropic.messages.stream({
          ...body,
        });

        for await (const event of messageStream) {
          await sseStream.writeSSE({
            event: 'message_delta',
            data: JSON.stringify(event),
          });
        }

        // Track token usage after stream completes
        const finalMessage = await messageStream.finalMessage();
        if (finalMessage.usage) {
          gatewayTokensIn.add(finalMessage.usage.input_tokens, { user: userId, model });
          gatewayTokensOut.add(finalMessage.usage.output_tokens, { user: userId, model });
        }
      });
    } else {
      // Non-streaming response
      const response = await anthropic.messages.create({
        ...body,
        stream: false,
      });

      // Track token usage
      if (response.usage) {
        gatewayTokensIn.add(response.usage.input_tokens, { user: userId, model });
        gatewayTokensOut.add(response.usage.output_tokens, { user: userId, model });
      }

      console.log(`[Proxy] Request completed successfully`);
      return c.json(response);
    }
  } catch (error: any) {
    console.error('[Proxy] Error:', error.message);

    if (error.status) {
      return c.json(
        {
          error: {
            type: error.type || 'api_error',
            message: error.message,
          },
        },
        error.status,
      );
    } else {
      return c.json(
        {
          error: {
            type: 'internal_error',
            message: error.message,
          },
        },
        500,
      );
    }
  }
});

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  () => {
    console.log(`\n🚀 WorkOS LLM Gateway running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Anthropic proxy: POST http://localhost:${PORT}/v1/messages`);
    console.log(`   Telemetry: POST http://localhost:${PORT}/telemetry`);
    console.log(`\n   Anthropic API Key: ${env.ANTHROPIC_API_KEY ? '✓ Set' : '✗ Missing'}`);
    console.log(`   WorkOS Client ID: ${env.WORKOS_CLIENT_ID ? '✓ Set' : '✗ Missing'}`);
    console.log(`   Local Mode: ${isLocalMode ? '✓ Enabled (auth optional)' : '✗ Disabled (auth required)'}\n`);
  },
);

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Gateway] SIGTERM received, shutting down...');
  await shutdownTelemetry();
  process.exit(0);
});
