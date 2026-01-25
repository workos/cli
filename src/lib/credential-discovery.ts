import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DiscoveryResult {
  found: boolean;
  source?: 'env' | 'declined';
  clientId?: string;
  apiKey?: string;
  sourcePath?: string;
}

export interface EnvFileInfo {
  exists: boolean;
  files: string[];
}

const ENV_FILE_NAMES = ['.env.local', '.env.development.local', '.env.development', '.env'];

// Only extract WorkOS variables - ignore everything else
const WORKOS_CLIENT_ID_PATTERN = /^WORKOS_CLIENT_ID=["']?([^"'\s#]+)["']?/m;
const WORKOS_API_KEY_PATTERN = /^WORKOS_API_KEY=["']?([^"'\s#]+)["']?/m;

/**
 * Check if env files exist in the project directory (without reading contents).
 * Returns which files were found so the UI can prompt for consent.
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

  // Filter out commented lines before matching
  const lines = content.split('\n');
  const uncommentedContent = lines.filter((line) => !line.trim().startsWith('#')).join('\n');

  const clientIdMatch = uncommentedContent.match(WORKOS_CLIENT_ID_PATTERN);
  const apiKeyMatch = uncommentedContent.match(WORKOS_API_KEY_PATTERN);

  return {
    clientId: clientIdMatch?.[1],
    apiKey: apiKeyMatch?.[1],
  };
}

/**
 * Validate client ID format.
 * WorkOS client IDs start with 'client_' prefix.
 */
export function isValidClientId(value: string): boolean {
  return value.startsWith('client_') && value.length > 10;
}

/**
 * Validate API key format.
 * WorkOS secret keys start with 'sk_' prefix.
 */
export function isValidApiKey(value: string): boolean {
  return value.startsWith('sk_') && value.length > 10;
}

/**
 * Discover WorkOS credentials from project env files.
 * Must be called AFTER user consent is given.
 *
 * Scans files in priority order: .env.local > .env.development.local > .env.development > .env
 * Returns first complete match (both clientId and apiKey preferred, but clientId-only is valid).
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
      // File not readable or doesn't exist, continue to next
    }
  }

  return { found: false };
}
