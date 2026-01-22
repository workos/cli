/**
 * Parse a .env file into key-value pairs.
 * Handles comments, empty lines, and values containing '='.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        result[key] = valueParts.join('=');
      }
    }
  }
  return result;
}
