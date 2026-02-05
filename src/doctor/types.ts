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
  expectedCallbackPath?: string; // e.g., '/auth/callback' for Next.js
  detectedPort?: number;
}

export interface RuntimeInfo {
  nodeVersion: string;
  packageManager: string | null;
  packageManagerVersion: string | null;
}

export interface EnvironmentInfo {
  apiKeyConfigured: boolean;
  apiKeyType: 'staging' | 'production' | null;
  clientId: string | null; // truncated for display
  redirectUri: string | null;
  cookieDomain: string | null;
  baseUrl: string | null;
}

/** Internal environment data - not included in report output */
export interface EnvironmentRaw {
  apiKey: string | null;
  clientId: string | null;
  baseUrl: string | null;
}

export interface EnvironmentCheckResult {
  info: EnvironmentInfo;
  raw: EnvironmentRaw;
}

export interface ConnectivityInfo {
  apiReachable: boolean;
  latencyMs: number | null;
  tlsValid: boolean;
  error?: string;
}

export interface DashboardSettings {
  redirectUris: string[];
  authMethods: string[];
  sessionTimeout: string | null;
  mfa: 'optional' | 'required' | 'disabled' | null;
  organizationCount: number;
}

export interface RedirectUriComparison {
  codeUri: string | null;
  dashboardUris: string[];
  match: boolean;
  source?: 'env' | 'inferred'; // Where the codeUri came from
}

export interface CredentialValidation {
  valid: boolean;
  clientIdMatch: boolean;
  error?: string;
}

export interface DashboardFetchResult {
  settings: DashboardSettings | null;
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
  dashboardSettings?: DashboardSettings;
  dashboardError?: string;
  redirectUris?: RedirectUriComparison;
  credentialValidation?: CredentialValidation;
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
  json?: boolean;
  copy?: boolean;
}
