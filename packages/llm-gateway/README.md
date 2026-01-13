# @workos/authkit-llm-gateway

LLM Gateway for WorkOS AuthKit Wizard - proxies Claude API calls so users don't need their own Anthropic API keys.

## Purpose

In production, this service runs at `https://mcp.workos.com/wizard` and allows the wizard to call Claude using WorkOS's Anthropic credentials instead of requiring users to have their own API keys.

## Architecture

```
Wizard → LLM Gateway → Anthropic API
           ↓
    Validates WorkOS API key
    Uses WorkOS's Anthropic credentials
```

## Local Development

For local testing, run this gateway alongside the wizard:

```bash
# Set WorkOS's Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-api03-YOUR-KEY

# Start gateway
pnpm dev
```

Gateway runs on `http://localhost:8000`

## How It Works

1. **Receives** request from wizard with WorkOS API key in Authorization header
2. **Validates** WorkOS API key format (sk_test_* or sk_live_*)
3. **Proxies** request to Anthropic API using backend credentials
4. **Streams** response back to wizard
5. **Redacts** API keys from logs

## Endpoints

### `POST /v1/messages`

Proxy for Anthropic Messages API.

**Headers:**
```
Authorization: Bearer sk_test_...  (WorkOS API key)
Content-Type: application/json
```

**Body:**
Same as Anthropic Messages API

**Response:**
Same as Anthropic Messages API (streamed)

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "workos-llm-gateway",
  "anthropicKeySet": true
}
```

## Configuration

**Environment Variables:**

- `ANTHROPIC_API_KEY` (required) - WorkOS's Anthropic API key
- `PORT` (optional) - Server port (default: 8000)

## Security Features

- ✅ **API Key Validation** - Checks WorkOS key format before proxying
- ✅ **Log Redaction** - Keys show as `sk_test_...X6Y` in logs
- ✅ **Streaming Support** - Handles Anthropic's SSE responses
- ✅ **Error Handling** - Returns proper error codes

## Production Deployment

This service should be deployed to `https://mcp.workos.com/wizard`

**Requirements:**
- Node.js 18+
- WorkOS Anthropic API key set as env var
- HTTPS endpoint
- CORS headers for wizard access

**Optional enhancements for production:**
- Rate limiting per WorkOS customer
- Usage tracking/analytics
- Caching for repeated requests
- Load balancing

## Development

**Start in watch mode:**
```bash
pnpm dev
```

**Build:**
```bash
pnpm build
```

**Start built version:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm start
```

## Testing

Test the health endpoint:
```bash
curl http://localhost:8000/health
```

Test a Claude API call:
```bash
curl -X POST http://localhost:8000/v1/messages \
  -H "Authorization: Bearer sk_test_YOUR_WORKOS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-5-20251101",
    "max_tokens": 1024,
    "messages": [{
      "role": "user",
      "content": "Hello!"
    }]
  }'
```

## License

MIT © WorkOS
