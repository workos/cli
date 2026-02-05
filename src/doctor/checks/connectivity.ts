import type { DoctorOptions, ConnectivityInfo } from '../types.js';

export async function checkConnectivity(options: DoctorOptions): Promise<ConnectivityInfo> {
  if (options.skipApi) {
    return {
      apiReachable: false,
      latencyMs: null,
      tlsValid: false,
      error: 'Skipped (--skip-api)',
    };
  }

  const baseUrl = process.env.WORKOS_BASE_URL ?? 'https://api.workos.com';
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    return {
      apiReachable: response.ok,
      latencyMs,
      tlsValid: true, // If fetch succeeded over HTTPS, TLS is valid
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      apiReachable: false,
      latencyMs: null,
      tlsValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
