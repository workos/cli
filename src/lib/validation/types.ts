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

// Re-export BuildResult from build-validator
export type { BuildResult } from './build-validator.js';
