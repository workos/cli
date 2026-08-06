import type { InstallerAdapter, AdapterConfig } from './types.js';
import type { InstallerEventEmitter, InstallerEvents } from '../events.js';
import { relative } from 'node:path';
import ui, { PromptUnavailableError } from '../../utils/ui.js';
import chalk from 'chalk';
import { getConfig } from '../settings.js';
import { ProgressTracker } from '../progress-tracker.js';
import { renderCompletionSummary, renderBrandMark } from '../../utils/summary-box.js';
import { formatWorkOSCommand } from '../../utils/command-invocation.js';

/**
 * CLI adapter that renders wizard events via ui.
 *
 * Subscribes to InstallerEventEmitter and translates events into
 * UI facade operations (logs, spinners, prompts).
 */
export class CLIAdapter implements InstallerAdapter {
  readonly emitter: InstallerEventEmitter;
  private sendEvent: AdapterConfig['sendEvent'];
  private debug: boolean;
  private spinner: ReturnType<typeof ui.spinner> | null = null;
  private isStarted = false;
  private progress = new ProgressTracker();

  // Scaffold (empty-dir) state, used to print a "next steps" hint on completion.
  private scaffolded = false;
  private scaffoldPackageManager = 'npm';

  // Store bound handlers for cleanup
  private handlers = new Map<string, (...args: unknown[]) => void>();

  // Queue for logs while prompt is active (parallel state issue)
  private isPromptActive = false;
  private pendingLogs: Array<() => void> = [];

  // SIGINT handler for cleanup
  private sigIntHandler: (() => void) | null = null;

  // Aborts in-flight/queued prompts when the run ends (cancellation, ctrl-c).
  // The installer's `preparing` state can queue a second prompt behind a live
  // one (git-dirty + protected-branch); if the first is cancelled, this signal
  // stops the queued sibling from opening a now-moot question.
  private promptAbort: AbortController | null = null;

  // Last phase message shown on the agent spinner, restored after logging above it.
  private lastAgentMessage = 'Running AI agent...';
  // Last file path rendered as a step line, to dedupe consecutive same-path ops.
  private lastFileOp: string | null = null;

  constructor(config: AdapterConfig) {
    this.emitter = config.emitter;
    this.sendEvent = config.sendEvent;
    this.debug = config.debug ?? false;
  }

  /**
   * Queue a log call if a prompt is active, otherwise execute immediately.
   */
  private queueableLog(logFn: () => void): void {
    if (this.isPromptActive) {
      this.pendingLogs.push(logFn);
    } else {
      logFn();
    }
  }

  /**
   * Flush any queued logs after prompt completes.
   */
  private flushPendingLogs(): void {
    const logs = this.pendingLogs.splice(0);
    logs.forEach((fn) => fn());
  }

  /**
   * Run a prompt with the log queue engaged: mark a prompt active so async log
   * events (detection:complete, branch:created, …) buffer instead of scribbling
   * over the question, then release and flush once it resolves. Wraps every
   * prompt handler so the active/flush lifecycle lives in one place.
   */
  private async withPromptActive<T>(run: () => Promise<T>): Promise<T> {
    this.isPromptActive = true;
    try {
      return await run();
    } finally {
      this.isPromptActive = false;
      this.flushPendingLogs();
    }
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;
    this.promptAbort = new AbortController();

    // Show intro
    const config = getConfig();
    if (config.branding.showAsciiArt) {
      // Compact brand mark (the lock + wordmark) instead of the full block banner.
      console.log('');
      console.log(renderBrandMark('AuthKit installer'));
      console.log('');
    } else {
      ui.intro('WorkOS', 'AuthKit installer');
    }

    // Handle Ctrl+C gracefully
    const handleSigInt = () => {
      this.promptAbort?.abort();
      if (this.spinner) {
        this.spinner.stop('Cancelled');
        this.spinner = null;
      }
      ui.log.warn('Installer cancelled');
      ui.outro('Your project was not modified');
      process.exit(0);
    };
    process.on('SIGINT', handleSigInt);
    this.sigIntHandler = handleSigInt;

    // Subscribe to state events for progress tracking
    this.subscribe('state:enter', this.handleStateEnter);
    this.subscribe('state:exit', this.handleStateExit);

    // Subscribe to events that require UI rendering
    this.subscribe('auth:success', this.handleAuthSuccess);
    this.subscribe('auth:failure', this.handleAuthFailure);
    this.subscribe('detection:complete', this.handleDetectionComplete);
    this.subscribe('detection:none', this.handleDetectionNone);
    this.subscribe('git:dirty', this.handleGitDirty);
    this.subscribe('credentials:found', this.handleCredentialsFound);
    this.subscribe('credentials:request', this.handleCredentialsRequest);
    this.subscribe('credentials:env:prompt', this.handleEnvScanPrompt);
    this.subscribe('device:started', this.handleDeviceStarted);
    this.subscribe('device:success', this.handleDeviceSuccess);
    this.subscribe('device:error', this.handleDeviceError);
    this.subscribe('device:timeout', this.handleDeviceTimeout);
    this.subscribe('staging:fetching', this.handleStagingFetching);
    this.subscribe('staging:success', this.handleStagingSuccess);
    this.subscribe('staging:error', this.handleStagingError);
    this.subscribe('credentials:env:found', this.handleEnvCredentialsFound);
    this.subscribe('config:complete', this.handleConfigComplete);
    this.subscribe('agent:start', this.handleAgentStart);
    this.subscribe('agent:progress', this.handleAgentProgress);
    this.subscribe('agent:success', this.handleAgentSuccess);
    // Persistent, append-only log of file operations + tool calls above the spinner.
    this.subscribe('file:write', this.handleFileWrite);
    this.subscribe('file:edit', this.handleFileEdit);
    this.subscribe('agent:tool', this.handleAgentTool);
    this.subscribe('validation:start', this.handleValidationStart);
    this.subscribe('validation:issues', this.handleValidationIssues);
    this.subscribe('validation:complete', this.handleValidationComplete);
    this.subscribe('complete', this.handleComplete);
    this.subscribe('error', this.handleError);
    // Scaffold events (empty-directory app scaffolding)
    this.subscribe('scaffold:prompt', this.handleScaffoldPrompt);
    this.subscribe('scaffold:start', this.handleScaffoldStart);
    this.subscribe('scaffold:progress', this.handleScaffoldProgress);
    this.subscribe('scaffold:complete', this.handleScaffoldComplete);
    this.subscribe('scaffold:failed', this.handleScaffoldFailed);

    // Branch check events
    this.subscribe('branch:prompt', this.handleBranchPrompt);
    this.subscribe('branch:created', this.handleBranchCreated);

    // Post-install events
    this.subscribe('postinstall:changes', this.handlePostInstallChanges);
    this.subscribe('postinstall:commit:prompt', this.handleCommitPrompt);
    this.subscribe('postinstall:commit:generating', this.handleCommitGenerating);
    this.subscribe('postinstall:commit:success', this.handleCommitSuccess);
    this.subscribe('postinstall:commit:failed', this.handleCommitFailed);
    this.subscribe('postinstall:pr:prompt', this.handlePrPrompt);
    this.subscribe('postinstall:pr:generating', this.handlePrGenerating);
    this.subscribe('postinstall:pr:pushing', this.handlePrPushing);
    this.subscribe('postinstall:pr:success', this.handlePrSuccess);
    this.subscribe('postinstall:pr:failed', this.handlePrFailed);
    this.subscribe('postinstall:push:failed', this.handlePushFailed);
    this.subscribe('postinstall:manual', this.handleManualInstructions);
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;

    // Abort any in-flight/queued prompt so a cancelled run can't leave a
    // now-moot sibling question open (e.g. the branch prompt after git-cancel).
    this.promptAbort?.abort();
    this.promptAbort = null;

    // Remove SIGINT handler
    if (this.sigIntHandler) {
      process.off('SIGINT', this.sigIntHandler);
      this.sigIntHandler = null;
    }

    // Unsubscribe from all events
    for (const [event, handler] of this.handlers) {
      this.emitter.off(event as keyof InstallerEvents, handler as never);
    }
    this.handlers.clear();

    // Stop any active spinner
    this.spinner?.stop();
    this.spinner = null;

    this.isStarted = false;
  }

  private stopSpinner(message: string, code = 0): void {
    if (this.spinner) {
      this.spinner.stop(message, code);
      this.spinner = null;
    }
  }

  /**
   * Start a fresh spinner for a new phase, clearing any previous handle first.
   * ui.spinner() enforces the same single-spinner invariant globally (start()
   * retires the active spinner), but clearing here additionally keeps
   * this.spinner honest: it never points at a handle whose phase already ended
   * (AUTH-6732 — an overwritten handle left its interval redrawing over the
   * next prompt).
   */
  private startSpinner(message: string): void {
    this.spinner?.clear();
    this.spinner = ui.spinner();
    this.spinner.start(message);
  }

  /** Debug logging - only outputs when debug mode is enabled */
  private debugLog = (message: string): void => {
    if (this.debug) {
      console.log(chalk.dim(`[debug] ${message}`));
    }
  };

  /**
   * Helper to subscribe and track handlers for cleanup.
   */
  private subscribe<K extends keyof InstallerEvents>(
    event: K,
    handler: (payload: InstallerEvents[K]) => void | Promise<void>,
  ): void {
    const boundHandler = handler.bind(this);
    // Handlers are invoked fire-and-forget by a plain EventEmitter, so an async
    // rejection would become an unhandledRejection (silent crash). Route a
    // PromptUnavailableError (prompt attempted where the user can't answer) to a
    // clean fail-fast; re-surface anything else unchanged so real bugs still crash.
    const safeHandler = (payload: InstallerEvents[K]): void => {
      try {
        const result = boundHandler(payload);
        if (result instanceof Promise) result.catch((err) => this.onHandlerError(err));
      } catch (err) {
        this.onHandlerError(err);
      }
    };
    this.handlers.set(event, safeHandler as (...args: unknown[]) => void);
    this.emitter.on(event, safeHandler as typeof boundHandler);
  }

  /**
   * Terminal handler failure. A PromptUnavailableError means we reached a prompt
   * in a context that can't answer it (non-TTY stdin) — the CLIAdapter only runs
   * in human, non-JSON output, so this is always a real human at a broken input,
   * never a JSON stream. Surface a clear message and exit before anything is
   * written, rather than hanging or crashing. Re-throw anything else.
   */
  private onHandlerError = (error: unknown): void => {
    if (error instanceof PromptUnavailableError) {
      this.spinner?.clear();
      this.spinner = null;
      ui.log.error(error.message);
      ui.log.hint('Re-run in an interactive terminal, or pass the flags that answer these prompts.');
      // Exit 1 (general error), matching the direct-command classification of
      // this same error in bin.ts. NOT 4 — that's "auth required" (gh
      // convention), which would send scripts into an auth-retry loop.
      process.exit(1);
    }
    throw error;
  };

  // ===== Event Handlers =====

  private handleStateEnter = ({ state }: InstallerEvents['state:enter']): void => {
    this.progress.enterPhase(state);
  };

  private handleStateExit = ({ state }: InstallerEvents['state:exit']): void => {
    this.progress.exitPhase(state);
  };

  private handleAuthSuccess = (): void => {
    ui.log.success('Authenticated');
  };

  private handleAuthFailure = ({ message }: InstallerEvents['auth:failure']): void => {
    ui.log.error(`Auth failed: ${message}`);
    ui.log.info('Visit https://dashboard.workos.com to verify your account');
  };

  private handleDetectionComplete = ({ integration }: InstallerEvents['detection:complete']): void => {
    this.queueableLog(() => ui.log.success(`Detected ${chalk.bold(integration)}`));
  };

  private handleDetectionNone = (): void => {
    this.queueableLog(() => ui.log.warn('Could not detect framework automatically'));
  };

  private handleCredentialsFound = (): void => {
    ui.log.success('Found existing WorkOS credentials in .env.local');
  };

  private handleEnvScanPrompt = async ({ files }: InstallerEvents['credentials:env:prompt']): Promise<void> => {
    const fileList = files.length === 1 ? files[0] : files.slice(0, 2).join(', ');
    const confirmed = await this.withPromptActive(() =>
      ui.confirm({
        message: `Found ${fileList}. Check for existing WorkOS credentials?`,
        initialValue: true,
      }),
    );

    this.sendEvent({
      type: ui.isCancel(confirmed) || !confirmed ? 'ENV_SCAN_DECLINED' : 'ENV_SCAN_APPROVED',
    });
  };

  private handleDeviceStarted = ({ verificationUri, userCode }: InstallerEvents['device:started']): void => {
    ui.log.info(`\nOpen this URL in your browser:\n`);
    console.log(`  ${chalk.cyan(verificationUri)}`);
    console.log(`\nEnter code: ${chalk.bold(userCode)}\n`);

    this.startSpinner('Waiting for authentication...');
  };

  private handleDeviceSuccess = (): void => {
    // Spinner will be stopped by handleStagingFetching
  };

  private handleStagingFetching = (): void => {
    this.stopSpinner('Authenticated');
    this.startSpinner('Fetching your WorkOS credentials...');
  };

  private handleStagingSuccess = ({ source }: InstallerEvents['staging:success']): void => {
    if (source === 'device') {
      this.stopSpinner('Environment ready');
      ui.log.success('Set up a WorkOS environment for this install');
    } else if (source === 'stored') {
      this.stopSpinner('Using active environment');
      ui.log.success('Using your active WorkOS environment');
    } else {
      this.stopSpinner('Environment ready');
      ui.log.success('Using your WorkOS environment');
    }
  };

  private handleEnvCredentialsFound = ({ sourcePath }: InstallerEvents['credentials:env:found']): void => {
    ui.log.success(`Found existing WorkOS credentials in ${sourcePath}`);
  };

  // Automatic auth / credential fetch can fail and fall back to manual entry.
  // These finalize the spinner with a failure glyph so it isn't left spinning
  // (orphaned) over the manual-credentials prompt that follows.
  private handleDeviceError = ({ message }: InstallerEvents['device:error']): void => {
    this.stopSpinner('Automatic sign-in failed', 1);
    if (this.debug) this.debugLog(`[device:error] ${message}`);
  };

  private handleDeviceTimeout = (): void => {
    this.stopSpinner('Sign-in timed out', 1);
  };

  private handleStagingError = ({ message }: InstallerEvents['staging:error']): void => {
    this.stopSpinner('Could not fetch WorkOS credentials', 1);
    if (this.debug) this.debugLog(`[staging:error] ${message}`);
  };

  private handleGitDirty = async ({ files }: InstallerEvents['git:dirty']): Promise<void> => {
    ui.log.warn('You have uncommitted or untracked files:');
    files.slice(0, 5).forEach((f) => ui.log.info(chalk.dim(`  ${f}`)));
    if (files.length > 5) {
      ui.log.info(chalk.dim(`  ... and ${files.length - 5} more`));
    }

    const confirmed = await this.withPromptActive(() =>
      ui.confirm({
        message: 'Continue anyway?',
        initialValue: false,
        signal: this.promptAbort?.signal,
      }),
    );

    this.sendEvent({
      type: ui.isCancel(confirmed) || !confirmed ? 'GIT_CANCELLED' : 'GIT_CONFIRMED',
    });
  };

  private handleCredentialsRequest = async ({
    requiresApiKey,
  }: InstallerEvents['credentials:request']): Promise<void> => {
    // Guaranteed chokepoint: promptingManual is the fallback for any auth path,
    // so clear any still-running spinner before the prompt opens (defense in
    // depth on top of the device/staging error handlers and withPrompt's pause).
    this.spinner?.clear();
    this.spinner = null;

    ui.log.step(`Get your credentials from ${chalk.cyan('https://dashboard.workos.com')}`);

    const clientId = await ui.text({
      message: 'Enter your WorkOS Client ID:',
      placeholder: 'client_...',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Client ID is required';
        }
        if (!value.startsWith('client_')) {
          return 'Client ID should start with "client_"';
        }
        return undefined;
      },
    });

    if (ui.isCancel(clientId)) {
      this.sendEvent({ type: 'CANCEL' });
      return;
    }

    let apiKey = '';
    if (requiresApiKey) {
      ui.log.info(chalk.dim('ℹ️ Your API key will be hidden for security and saved to .env.local'));
      const apiKeyResult = await ui.password({
        message: 'Enter your WorkOS API Key:',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'API Key is required';
          }
          if (!value.startsWith('sk_')) {
            return 'API Key should start with "sk_"';
          }
          return undefined;
        },
      });

      if (ui.isCancel(apiKeyResult)) {
        this.sendEvent({ type: 'CANCEL' });
        return;
      }
      apiKey = apiKeyResult as string;
    } else {
      ui.log.info(chalk.dim('ℹ️ Client-only SDK - API key not required'));
    }

    this.sendEvent({
      type: 'CREDENTIALS_SUBMITTED',
      apiKey,
      clientId: clientId as string,
    });
  };

  private handleConfigComplete = (): void => {
    ui.log.success('Environment configured');
  };

  private handleAgentStart = (): void => {
    this.startSpinner(this.lastAgentMessage);
    // No setInterval: ui animates its own frames, and the old 2s reset
    // clobbered the current phase text set by handleAgentProgress.
  };

  /**
   * The agent phase is over — finalize its spinner. Integrations that run
   * validation emit validation:start (which stops it first); this covers the
   * ones that don't (Ruby, or any run with --no-validate), so the spinner
   * never outlives its phase into the post-install commit/PR prompts
   * (AUTH-6732). Failure paths are already finalized by handleError/handleComplete.
   */
  private handleAgentSuccess = (): void => {
    this.stopSpinner('Agent completed');
  };

  private handleAgentProgress = ({ step, detail }: InstallerEvents['agent:progress']): void => {
    const message = detail ? `${step}: ${detail}` : step;
    this.lastAgentMessage = message;
    this.spinner?.message(message);
  };

  /**
   * Render a persistent line above the running spinner: stop the spinner to
   * finalize its line, emit the log, then restart it on the last phase message.
   * Mirrors the existing stop→log and stop→start-new-spinner precedents.
   */
  private logAboveSpinner(render: () => void): void {
    const wasRunning = this.spinner !== null;
    this.spinner?.stop();
    this.spinner = null;
    render();
    if (wasRunning) {
      this.startSpinner(this.lastAgentMessage);
    }
  }

  private logFileOp(verb: 'Creating' | 'Editing', path: string): void {
    if (path === this.lastFileOp) return; // dedupe consecutive same-path ops
    this.lastFileOp = path;
    const rel = relative(process.cwd(), path);
    this.logAboveSpinner(() => ui.log.step(`${verb} ${chalk.dim(rel)}`));
  }

  private handleFileWrite = ({ path }: InstallerEvents['file:write']): void => {
    this.logFileOp('Creating', path);
  };

  private handleFileEdit = ({ path }: InstallerEvents['file:edit']): void => {
    this.logFileOp('Editing', path);
  };

  private handleAgentTool = ({ detail }: InstallerEvents['agent:tool']): void => {
    const cmd = detail.length > 80 ? `${detail.slice(0, 77)}…` : detail;
    this.logAboveSpinner(() => ui.log.step(`Running ${chalk.dim(cmd)}`));
  };

  private handleValidationStart = (): void => {
    this.stopSpinner('Agent completed');
  };

  private handleValidationIssues = ({ issues }: InstallerEvents['validation:issues']): void => {
    for (const issue of issues) {
      if (issue.severity === 'error') {
        ui.log.error(issue.message);
      } else {
        ui.log.warn(issue.message);
      }
      if (issue.hint) {
        ui.log.info(`Hint: ${issue.hint}`);
      }
    }
  };

  private handleValidationComplete = ({ passed, issueCount }: InstallerEvents['validation:complete']): void => {
    if (passed) {
      ui.log.success('Validation passed');
    } else {
      ui.log.warn(`Validation found ${issueCount} issue(s)`);
    }
  };

  private handleComplete = ({ success, summary, completion }: InstallerEvents['complete']): void => {
    // Fires synchronously during the cancelled-state transition (emitCancelled),
    // BEFORE a queued sibling prompt's microtask runs — so aborting here makes a
    // cancelled run's still-queued prompt (e.g. the branch select after a
    // git-dirty "No") open with an already-aborted signal and resolve to CANCEL
    // without ever rendering a now-moot question.
    this.promptAbort?.abort();

    this.stopSpinner(success ? 'Done' : 'Failed');

    console.log('');
    console.log(renderCompletionSummary(success, summary, completion));
    console.log('');

    // When we scaffolded a fresh app, the install ran in the current dir, so
    // point the user straight at the dev server.
    if (success && this.scaffolded) {
      ui.log.info(`Start your app:  ${chalk.cyan(`${this.scaffoldPackageManager} run dev`)}`);
    }
  };

  private handleError = ({ message, stack, code }: InstallerEvents['error']): void => {
    // A structured decline (e.g. unsupported framework version) already
    // printed its guidance via the integration — don't restyle it as a
    // generic failure.
    if (code) {
      this.stopSpinner('Installation skipped');
      return;
    }
    this.stopSpinner('Failed', 1);

    // Rewrite raw API/SDK errors into user-friendly messages with a next step.
    // Matching is word-boundary / code-based so 'author' doesn't read as 'auth'
    // and 'Module not found' doesn't read as a missing-directory error.
    const isServiceError =
      /\b50[0-9]\b/.test(message) || /server_error|internal_error|overloaded|service.*unavailable/i.test(message);
    const isRateLimit = /\b429\b/.test(message) || /\brate.?limit/i.test(message);
    const isNetworkError = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message);
    const isProcessExit = /process exited with code/i.test(message);
    const isAuthError = /\b(401|403|unauthorized|forbidden|authentication|authorization)\b/i.test(message);
    const isMissingPath = /\bENOENT\b/.test(message);

    if (isServiceError) {
      ui.log.error('The AI service is temporarily unavailable.');
      ui.log.info('This is usually resolved within a few minutes. Please try again shortly.');
    } else if (isRateLimit) {
      ui.log.error('The AI service is currently rate-limited.');
      ui.log.info('Please wait a minute and try again.');
    } else if (isNetworkError) {
      ui.log.error('Could not connect to the AI service.');
      ui.log.info('Check your internet connection and try again.');
    } else if (isProcessExit) {
      ui.log.error('The AI agent process exited unexpectedly.');
      ui.log.info('Try running again. If this persists, run with --debug for details.');
    } else if (isAuthError) {
      ui.log.error('Authentication failed.');
      ui.log.info(`Try running: ${formatWorkOSCommand('auth logout')} && ${formatWorkOSCommand('install')}`);
    } else if (isMissingPath) {
      ui.log.error(message);
      ui.log.info('Make sure you are running this in your project directory.');
    } else {
      // Unknown error: still give the user somewhere to go next.
      ui.log.error(message);
      ui.log.info(
        `Re-run with ${chalk.cyan('--debug')} for details, or report it at ${chalk.cyan('https://github.com/workos/cli/issues')}`,
      );
    }

    if (stack && this.debug) {
      this.debugLog(stack);
    }
  };

  // ===== Scaffold Event Handlers =====

  private handleScaffoldPrompt = async ({ packageManager }: InstallerEvents['scaffold:prompt']): Promise<void> => {
    this.scaffoldPackageManager = packageManager;
    const confirmed = await this.withPromptActive(() =>
      ui.confirm({
        message: 'This directory is empty. Scaffold a new Next.js app with AuthKit here?',
        initialValue: true,
      }),
    );

    this.sendEvent({
      type: ui.isCancel(confirmed) || !confirmed ? 'SCAFFOLD_CANCELLED' : 'SCAFFOLD_CONFIRMED',
    });
  };

  private handleScaffoldStart = ({ packageManager }: InstallerEvents['scaffold:start']): void => {
    this.scaffoldPackageManager = packageManager;
    this.startSpinner(`Scaffolding a new Next.js app with ${packageManager} (this can take a minute)...`);
  };

  // create-next-app output is verbose; surface it only under --debug and keep
  // the spinner message stable so the CLI stays readable.
  private handleScaffoldProgress = ({ text }: InstallerEvents['scaffold:progress']): void => {
    const line = text.trim();
    if (line) {
      this.debugLog(line);
    }
  };

  private handleScaffoldComplete = (): void => {
    this.scaffolded = true;
    this.stopSpinner('Next.js app created');
  };

  private handleScaffoldFailed = ({ error }: InstallerEvents['scaffold:failed']): void => {
    this.stopSpinner('Scaffold failed');
    ui.log.error(`Could not scaffold the app: ${error}`);
  };

  private handleBranchPrompt = async ({ branch }: InstallerEvents['branch:prompt']): Promise<void> => {
    const choice = await this.withPromptActive(() =>
      ui.select({
        message: `You are on ${chalk.bold(branch)}. Create a feature branch?`,
        options: [
          { value: 'create', label: 'Create feat/add-workos-authkit' },
          { value: 'continue', label: 'Continue on current branch' },
          { value: 'cancel', label: 'Cancel' },
        ],
        signal: this.promptAbort?.signal,
      }),
    );

    if (ui.isCancel(choice) || choice === 'cancel') {
      this.sendEvent({ type: 'BRANCH_CANCEL' });
    } else if (choice === 'create') {
      this.sendEvent({ type: 'BRANCH_CREATE' });
    } else {
      this.sendEvent({ type: 'BRANCH_CONTINUE' });
    }
  };

  private handleBranchCreated = ({ branch }: InstallerEvents['branch:created']): void => {
    this.queueableLog(() => ui.log.success(`Created branch ${chalk.bold(branch)}`));
  };

  // ===== Post-install Event Handlers =====

  private handlePostInstallChanges = ({ files }: InstallerEvents['postinstall:changes']): void => {
    this.debugLog(`Post-install: ${files.length} changed files detected`);
  };

  private handleCommitPrompt = async (): Promise<void> => {
    const confirmed = await this.withPromptActive(() =>
      ui.confirm({
        message: 'Commit the changes?',
        initialValue: true,
      }),
    );

    this.sendEvent({
      type: ui.isCancel(confirmed) || !confirmed ? 'COMMIT_DECLINED' : 'COMMIT_APPROVED',
    });
  };

  private handleCommitGenerating = (): void => {
    this.startSpinner('Generating commit message...');
  };

  private handleCommitSuccess = ({ message }: InstallerEvents['postinstall:commit:success']): void => {
    this.stopSpinner('Committed');
    ui.log.success(`Committed: ${chalk.dim(message)}`);
  };

  private handleCommitFailed = ({ error }: InstallerEvents['postinstall:commit:failed']): void => {
    this.stopSpinner('Commit failed');
    ui.log.error(`Commit failed: ${error}`);
  };

  private handlePrPrompt = async (): Promise<void> => {
    const confirmed = await this.withPromptActive(() =>
      ui.confirm({
        message: 'Create a pull request?',
        initialValue: true,
      }),
    );

    this.sendEvent({
      type: ui.isCancel(confirmed) || !confirmed ? 'PR_DECLINED' : 'PR_APPROVED',
    });
  };

  private handlePrGenerating = (): void => {
    this.startSpinner('Generating PR description...');
  };

  private handlePrPushing = (): void => {
    if (this.spinner) {
      this.spinner.message('Pushing to remote...');
    } else {
      this.startSpinner('Pushing to remote...');
    }
  };

  private handlePrSuccess = ({ url }: InstallerEvents['postinstall:pr:success']): void => {
    this.stopSpinner('PR created');
    ui.log.success(`Pull request created: ${chalk.cyan(url)}`);
  };

  private handlePrFailed = ({ error }: InstallerEvents['postinstall:pr:failed']): void => {
    this.stopSpinner('PR creation failed');
    ui.log.error(`PR creation failed: ${error}`);
  };

  private handlePushFailed = ({ error }: InstallerEvents['postinstall:push:failed']): void => {
    this.stopSpinner('Push failed');
    ui.log.error(`Push failed: ${error}`);
  };

  private handleManualInstructions = ({ instructions }: InstallerEvents['postinstall:manual']): void => {
    ui.log.info('GitHub CLI not found. Manual steps:');
    console.log(chalk.dim(instructions));
  };
}
