export type IssueSeverity = 'error' | 'warning';

export interface Issue {
  code: string;
  severity: IssueSeverity;
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
  docsUrl?: string;
}

export interface SdkInfo {
  name: string | null;
  version: string | null;
  latest: string | null;
  outdated: boolean;
  isAuthKit: boolean;
}

export interface FrameworkInfo {
  name: string | null;
  version: string | null;
  variant?: string; // e.g., 'app-router' | 'pages-router'
}

export interface RuntimeInfo {
  nodeVersion: string;
  packageManager: string | null;
  packageManagerVersion: string | null;
}

export interface EnvironmentInfo {
  apiKeyConfigured: boolean;
  apiKeyType: 'staging' | 'production' | null;
  clientId: string | null; // truncated
  redirectUri: string | null;
  cookieDomain: string | null;
  baseUrl: string | null;
}

export interface ConnectivityInfo {
  apiReachable: boolean;
  latencyMs: number | null;
  tlsValid: boolean;
  error?: string;
}

export interface DoctorReport {
  version: string;
  timestamp: string;
  project: {
    path: string;
    packageManager: string | null;
  };
  sdk: SdkInfo;
  runtime: RuntimeInfo;
  framework: FrameworkInfo;
  environment: EnvironmentInfo;
  connectivity: ConnectivityInfo;
  issues: Issue[];
  summary: {
    errors: number;
    warnings: number;
    healthy: boolean;
  };
}

export interface DoctorOptions {
  installDir: string;
  verbose?: boolean;
  skipApi?: boolean;
}
