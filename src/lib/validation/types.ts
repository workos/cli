export type ValidationSeverity = 'error' | 'warning';
export type ValidationIssueType = 'package' | 'env' | 'file' | 'pattern';

export interface ValidationIssue {
  type: ValidationIssueType;
  severity: ValidationSeverity;
  message: string;
  hint?: string; // How to fix
}

export interface ValidationResult {
  passed: boolean;
  framework: string;
  issues: ValidationIssue[];
  durationMs: number;
}

// Rule definitions (matches JSON schema)
export interface PackageRule {
  name: string;
  location?: 'dependencies' | 'devDependencies' | 'any'; // default: 'any'
}

export interface EnvVarRule {
  name: string;
  required?: boolean; // default: true
  alternates?: string[]; // alternate env var names (e.g., VITE_WORKOS_CLIENT_ID)
}

export interface FileRule {
  path: string; // glob pattern, e.g., "middleware.ts" or "app/**/callback/**/route.ts"
  mustContain?: string[]; // strings that must appear in file
  mustContainAny?: string[]; // at least one must appear
}

export interface VariantRules {
  files?: FileRule[];
  packages?: PackageRule[];
  envVars?: EnvVarRule[];
}

export interface ValidationRules {
  framework: string;
  packages: PackageRule[];
  envVars: EnvVarRule[];
  files: FileRule[];
  variants?: Record<string, VariantRules>;
}

export interface QuickCheckResult {
  passed: boolean;
  phase: 'typecheck' | 'build';
  issues: ValidationIssue[];
  /** Formatted for agent consumption — actionable, not just error messages */
  agentPrompt: string | null;
  durationMs: number;
}

export interface QuickChecksOutput {
  passed: boolean;
  results: QuickCheckResult[];
  /** Combined agent-ready prompt summarizing all failures */
  agentRetryPrompt: string | null;
  totalDurationMs: number;
}

// Re-export BuildResult from build-validator
export type { BuildResult } from './build-validator.js';
