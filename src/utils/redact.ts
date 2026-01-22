/**
 * Redact sensitive values from logs
 */

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
    // Recursively redact nested objects
    else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactCredentials(value);
    }
  }

  return redacted;
}
