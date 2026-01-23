import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Result from credential discovery.
 * `source: 'declined'` indicates user declined to let us scan.
 */
export interface DiscoveryResult {
  found: boolean;
  source?: 'env' | 'declined';
  clientId?: string;
  apiKey?: string;
  sourcePath?: string; // e.g., ".env.local"
}

export interface EnvFileInfo {
  exists: boolean;
  files: string[]; // List of found env files
}

/**
 * Priority-ordered list of env files to check.
 * More specific files (like .env.local) take precedence.
 */
const ENV_FILE_NAMES = [
  '.env.local',
  '.env.development.local',
  '.env.development',
  '.env',
];

/**
 * Patterns to extract WorkOS credentials.
 * Handles both quoted and unquoted values.
 */
const WORKOS_CLIENT_ID_PATTERN = /^WORKOS_CLIENT_ID=["']?([^"'\s]+)["']?$/m;
const WORKOS_API_KEY_PATTERN = /^WORKOS_API_KEY=["']?([^"'\s]+)["']?$/m;

/**
 * Check which env files exist in a project directory.
 * Does NOT read file contents - only checks existence.
 */
export async function checkForEnvFiles(projectDir: string): Promise<EnvFileInfo> {
  const foundFiles: string[] = [];

  for (const fileName of ENV_FILE_NAMES) {
    const filePath = path.join(projectDir, fileName);
    try {
      await fs.access(filePath, fs.constants.R_OK);
      foundFiles.push(fileName);
    } catch {
      // File doesn't exist or not readable
    }
  }

  return {
    exists: foundFiles.length > 0,
    files: foundFiles,
  };
}

/**
 * Scan a single env file for WorkOS credentials.
 * Only extracts WORKOS_CLIENT_ID and WORKOS_API_KEY - ignores all other variables.
 */
export async function scanEnvFile(filePath: string): Promise<{ clientId?: string; apiKey?: string }> {
  const content = await fs.readFile(filePath, 'utf-8');

  // Only extract the two WorkOS variables, ignore everything else
  const clientIdMatch = content.match(WORKOS_CLIENT_ID_PATTERN);
  const apiKeyMatch = content.match(WORKOS_API_KEY_PATTERN);

  return {
    clientId: clientIdMatch?.[1],
    apiKey: apiKeyMatch?.[1],
  };
}

/**
 * Validate that a client ID has the expected format.
 * WorkOS client IDs start with "client_" prefix.
 */
export function isValidClientId(value: string): boolean {
  return value.startsWith('client_') && value.length > 10;
}

/**
 * Validate that an API key has the expected format.
 * WorkOS API keys start with "sk_" prefix.
 */
export function isValidApiKey(value: string): boolean {
  return value.startsWith('sk_') && value.length > 10;
}

/**
 * Discover WorkOS credentials from project env files.
 * Should only be called AFTER user grants consent.
 *
 * Searches env files in priority order, returning the first valid credentials found.
 */
export async function discoverCredentials(projectDir: string): Promise<DiscoveryResult> {
  for (const fileName of ENV_FILE_NAMES) {
    const filePath = path.join(projectDir, fileName);

    try {
      const result = await scanEnvFile(filePath);

      const clientIdValid = result.clientId && isValidClientId(result.clientId);
      const apiKeyValid = result.apiKey && isValidApiKey(result.apiKey);

      // Need at least clientId to be useful
      if (clientIdValid) {
        return {
          found: true,
          source: 'env',
          clientId: result.clientId,
          apiKey: apiKeyValid ? result.apiKey : undefined,
          sourcePath: fileName,
        };
      }
    } catch {
      // File not readable, continue to next
    }
  }

  return { found: false };
}
