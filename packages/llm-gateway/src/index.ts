import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';

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

    // Validate WorkOS API key format
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing Authorization header' }, 401);
    }

    const workosKey = authHeader.replace('Bearer ', '');

    // Validate it's a WorkOS API key (starts with sk_test_ or sk_live_)
    if (!workosKey.startsWith('sk_test_') && !workosKey.startsWith('sk_live_')) {
      return c.json({ error: 'Invalid WorkOS API key format' }, 401);
    }

    const body = await c.req.json();
    console.log(`[Proxy] Request from WorkOS key: ${workosKey.substring(0, 15)}...`);
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
  console.log(`\n   Using Anthropic API Key: ${env.ANTHROPIC_API_KEY ? '✓ Set' : '✗ Missing'}\n`);
});
