// Runtime-agnostic environment variable access
// Falls back to process.env in Node.js, supports import.meta.env in edge runtimes

interface Env {
  ANTHROPIC_API_KEY?: string;
  PORT?: string;
  WORKOS_CLIENT_ID?: string;
  /** AuthKit domain for Connect OAuth JWT validation */
  WORKOS_AUTHKIT_DOMAIN?: string;
  /** Enable local development mode - allows unauthenticated requests */
  LOCAL_MODE?: string;
  /** OTel exporter type: 'otlp' | 'console' | 'none' */
  OTEL_EXPORTER_TYPE?: string;
  /** OTLP endpoint URL for trace export */
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  /** Service name for telemetry (defaults to 'workos-authkit-wizard') */
  OTEL_SERVICE_NAME?: string;
}

function getEnv(): Env {
  // Try import.meta.env first (Vite, edge runtimes)
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env;
  }

  // Fall back to process.env (Node.js)
  if (typeof process !== 'undefined' && process.env) {
    return process.env as Env;
  }

  // No environment available
  return {};
}

export const env = getEnv();
