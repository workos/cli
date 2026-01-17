import { config } from 'dotenv';

// Load .env.local first, then .env as fallback
config({ path: '.env.local' });
config({ path: '.env' });
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { validateJWT } from './jwt.js';
import { refreshAccessToken } from './refresh.js';

const app = new Hono();
const PORT = Number(env.PORT) || 8000;

// Anthropic client (uses ANTHROPIC_API_KEY from env)
const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'workos-llm-gateway' });
});

// Anthropic Messages API proxy
app.post('/v1/messages', async (c) => {
  try {
    const authHeader = c.req.header('authorization');

    // Check for Bearer token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json(
        {
          error: 'Missing Authorization header',
          hint: 'Run `wizard login` to authenticate',
        },
        401
      );
    }

    const tokenValue = authHeader.replace('Bearer ', '');

    // Token format: accessToken::refreshToken (refresh token is optional)
    const [accessToken, refreshToken] = tokenValue.split('::');

    // Validate JWT
    let validation = await validateJWT(accessToken);

    // If expired and we have a refresh token, try to refresh
    if (!validation.valid && validation.error === 'Token expired' && refreshToken) {
      console.log('[Auth] Access token expired, attempting refresh...');
      const refreshResult = await refreshAccessToken(refreshToken);

      if (refreshResult.success && refreshResult.accessToken) {
        // Validate the new token
        validation = await validateJWT(refreshResult.accessToken);
        if (validation.valid) {
          console.log('[Auth] Token refreshed and validated');
        }
      } else {
        console.log(`[Auth] Refresh failed: ${refreshResult.error}`);
      }
    }

    if (!validation.valid) {
      console.log(`[Auth] JWT validation failed: ${validation.error}`);
      return c.json(
        {
          error: validation.error || 'Invalid token',
          hint: 'Run `wizard login` to authenticate',
        },
        401
      );
    }

    console.log(`[Auth] Request from user: ${validation.payload?.sub}`);

    const body = await c.req.json();
    console.log(`[Proxy] Model: ${body.model}, Max tokens: ${body.max_tokens}`);

    // Check if streaming is requested
    const stream = body.stream === true;

    if (stream) {
      // Streaming response using SSE
      return streamSSE(c, async (stream) => {
        const messageStream = anthropic.messages.stream({
          ...body,
        });

        for await (const event of messageStream) {
          await stream.writeSSE({
            event: 'message_delta',
            data: JSON.stringify(event),
          });
        }
      });
    } else {
      // Non-streaming response
      const response = await anthropic.messages.create({
        ...body,
        stream: false,
      });

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
        error.status
      );
    } else {
      return c.json(
        {
          error: {
            type: 'internal_error',
            message: error.message,
          },
        },
        500
      );
    }
  }
});

serve({
  fetch: app.fetch,
  port: PORT,
}, () => {
  console.log(`\n🚀 WorkOS LLM Gateway running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Anthropic proxy: POST http://localhost:${PORT}/v1/messages`);
  console.log(`\n   Anthropic API Key: ${env.ANTHROPIC_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`   WorkOS Client ID: ${env.WORKOS_CLIENT_ID ? '✓ Set' : '✗ Missing'}\n`);
});
