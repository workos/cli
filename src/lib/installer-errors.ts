/**
 * A deliberate, user-facing refusal to install (e.g. unsupported framework
 * version). Routed through the installer's error path so machine consumers
 * get a non-zero exit with a structured code, while adapters and the install
 * command recognize it as a decline: the integration has already printed
 * actionable guidance, so no generic failure output is layered on top.
 */
export class InstallDeclinedError extends Error {
  readonly code: string;

  constructor(message: string, code = 'unsupported_framework_version') {
    super(message);
    this.name = 'InstallDeclinedError';
    this.code = code;
  }
}
