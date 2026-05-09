export type InteractionMode = 'human' | 'agent' | 'ci';

export type InteractionModeSource =
  | 'flag'
  | 'env'
  | 'workos_no_prompt'
  | 'ci_env'
  | 'agent_env'
  | 'non_tty'
  | 'default';

export interface InteractionModeInfo {
  mode: InteractionMode;
  source: InteractionModeSource;
}

export interface ResolveInteractionModeOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
}

const VALID_MODES: InteractionMode[] = ['human', 'agent', 'ci'];

let currentMode: InteractionModeInfo = { mode: 'human', source: 'default' };

export class InvalidInteractionModeError extends Error {
  constructor(
    public readonly value: string | undefined,
    public readonly source: 'flag' | 'env',
  ) {
    const label = source === 'flag' ? '--mode' : 'WORKOS_MODE';
    super(`${label} must be one of: ${VALID_MODES.join(', ')}`);
    this.name = 'InvalidInteractionModeError';
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function parseModeValue(value: string | undefined, source: 'flag' | 'env'): InteractionMode {
  const normalized = value?.toLowerCase();
  if (normalized && VALID_MODES.includes(normalized as InteractionMode)) {
    return normalized as InteractionMode;
  }
  throw new InvalidInteractionModeError(value, source);
}

function parseModeFromArgv(argv: string[]): InteractionMode | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new InvalidInteractionModeError(value, 'flag');
      }
      return parseModeValue(value, 'flag');
    }
    if (arg.startsWith('--mode=')) {
      return parseModeValue(arg.slice('--mode='.length), 'flag');
    }
  }

  return undefined;
}

function hasCiMarker(env: NodeJS.ProcessEnv): boolean {
  return (
    isTruthy(env.CI) ||
    isTruthy(env.GITHUB_ACTIONS) ||
    isTruthy(env.GITLAB_CI) ||
    isTruthy(env.CIRCLECI) ||
    isTruthy(env.BUILDKITE) ||
    isTruthy(env.TF_BUILD)
  );
}

function hasAgentMarker(env: NodeJS.ProcessEnv): boolean {
  return (
    isTruthy(env.WORKOS_AGENT) ||
    isTruthy(env.CLAUDECODE) ||
    isTruthy(env.CLAUDE_CODE) ||
    isTruthy(env.CURSOR_AGENT) ||
    isTruthy(env.CODEX_SANDBOX) ||
    env.CURSOR_TRACE_ID !== undefined
  );
}

export function resolveInteractionMode(options: ResolveInteractionModeOptions = {}): InteractionModeInfo {
  const argv = options.argv ?? [];
  const env = options.env ?? process.env;

  const flagMode = parseModeFromArgv(argv);
  if (flagMode) return { mode: flagMode, source: 'flag' };

  if (env.WORKOS_MODE !== undefined) {
    return { mode: parseModeValue(env.WORKOS_MODE, 'env'), source: 'env' };
  }

  if (isTruthy(env.WORKOS_NO_PROMPT)) {
    return { mode: 'agent', source: 'workos_no_prompt' };
  }

  if (hasCiMarker(env)) {
    return { mode: 'ci', source: 'ci_env' };
  }

  if (hasAgentMarker(env)) {
    return { mode: 'agent', source: 'agent_env' };
  }

  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY;
  const stderrIsTTY = options.stderrIsTTY ?? process.stderr.isTTY;
  if (!stdoutIsTTY || !stderrIsTTY) {
    return { mode: 'agent', source: 'non_tty' };
  }

  return { mode: 'human', source: 'default' };
}

export function setInteractionMode(info: InteractionModeInfo): void {
  currentMode = info;
}

export function getInteractionMode(): InteractionModeInfo {
  return currentMode;
}

export function isHumanMode(): boolean {
  return currentMode.mode === 'human';
}

export function isAgentMode(): boolean {
  return currentMode.mode === 'agent';
}

export function isCiMode(): boolean {
  return currentMode.mode === 'ci';
}

export function isPromptAllowed(): boolean {
  return isHumanMode();
}

export function resetInteractionModeForTests(): void {
  currentMode = { mode: 'human', source: 'default' };
}
