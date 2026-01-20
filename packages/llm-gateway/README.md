# @workos/authkit-llm-gateway

LLM Gateway for WorkOS AuthKit Wizard - proxies Claude API calls so users don't need their own Anthropic API keys.

## Purpose

LLM proxy gateway that allows the wizard to call Claude API using backend Anthropic credentials instead of requiring users to have their own API keys.

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
2. **Validates** WorkOS API key format (sk*test*_ or sk*live*_)
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

### `POST /telemetry`

Receives wizard telemetry events and converts to OpenTelemetry spans/metrics.

**Headers:**

```
Authorization: Bearer <access_token>  (optional in LOCAL_MODE)
Content-Type: application/json
```

**Body:**

```json
{
  "events": [
    { "type": "session.start", "sessionId": "...", "timestamp": "...", "attributes": {...} },
    { "type": "session.end", "sessionId": "...", "timestamp": "...", "attributes": {...} }
  ]
}
```

**Response:**

```json
{ "received": 2 }
```

### `GET /health`

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "service": "workos-llm-gateway"
}
```

## Configuration

**Environment Variables:**

- `ANTHROPIC_API_KEY` (required) - WorkOS's Anthropic API key
- `PORT` (optional) - Server port (default: 8000)
- `LOCAL_MODE` (optional) - Set `true` for dev mode (console telemetry, auth optional)

**Telemetry:**

- `OTEL_EXPORTER_TYPE` - Telemetry exporter: `console` (default), `otlp`, `none`
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP endpoint (default: `http://localhost:4318/v1/traces`)
- `OTEL_SERVICE_NAME` - Service name in traces (default: `workos-authkit-wizard`)

## Security Features

- ✅ **API Key Validation** - Checks WorkOS key format before proxying
- ✅ **Log Redaction** - Keys show as `sk_test_...X6Y` in logs
- ✅ **Streaming Support** - Handles Anthropic's SSE responses
- ✅ **Error Handling** - Returns proper error codes

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
