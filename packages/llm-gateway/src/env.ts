// Runtime-agnostic environment variable access
// Falls back to process.env in Node.js, supports import.meta.env in edge runtimes

interface Env {
  ANTHROPIC_API_KEY?: string;
  PORT?: string;
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
