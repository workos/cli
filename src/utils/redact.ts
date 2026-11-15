/**
 * Redact sensitive values from logs
 */

/**
 * Exact secret values registered at runtime that have no recognizable prefix,
 * such as the short-lived GitHub OIDC and WorkOS access tokens used by
 * workload identity federation (src/lib/wif.ts). In memory only.
 */
const registeredSecrets = new Set<string>();

/** Register a secret value so the redaction helpers strip it wherever it appears. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) registeredSecrets.add(value);
}

/** Test-only: forget every registered secret, so each test starts from a known state. */
export function resetRegisteredSecretsForTests(): void {
  registeredSecrets.clear();
}

/** Replace every registered secret value in `text` with `[REDACTED]`. */
export function redactRegisteredSecrets(text: string): string {
  let redacted = text;
  for (const secret of registeredSecrets) {
    redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  return redacted;
}

export function redactApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) return '[REDACTED]';

  // Show format: sk_test_xxx...xxx (first 8 chars + last 3 chars)
  const prefix = apiKey.substring(0, 8);
  const suffix = apiKey.substring(apiKey.length - 3);

  return `${prefix}...${suffix}`;
}

export function redactCredentials(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;

  const redacted = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key in redacted) {
    const value = redacted[key];

    // Redact API keys
    if (typeof value === 'string' && value.startsWith('sk_')) {
      redacted[key] = redactApiKey(value);
    }
    // Redact registered secrets (prefix-less tokens), whole or embedded
    else if (typeof value === 'string' && registeredSecrets.size > 0) {
      redacted[key] = redactRegisteredSecrets(value);
    }
    // Recursively redact nested objects
    else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactCredentials(value);
    }
  }

  return redacted;
}
