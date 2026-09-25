/**
 * Full-screen installer adapter.
 *
 * It wraps the CLIAdapter rather than re-implementing it: every installer
 * event is still handled, and every question asked and answered, by the same
 * code as the plain CLI. What changes is where that goes. A UI host
 * (`setUiHost`) receives the lines and prompts instead of the terminal, the
 * run model turns installer events into the task list and walkthrough, and
 * Ink draws it all on the alternate screen.
 *
 * What the plain CLI prints is collected while the full screen is up and
 * printed to the normal screen when it closes: the answers, the settings it
 * made, every warning and error, and the same summary a plain run leaves. The
 * one thing left out is the agent's play-by-play (each command and file while
 * it works); the scrollback points to the log file that has it.
 */

import { homedir } from 'node:os';
import { basename } from 'node:path';
import { format } from 'node:util';
import { createElement } from 'react';
import { render, type Instance } from 'ink';
import chalk from 'chalk';
import type { AdapterConfig, InstallerAdapter } from './types.js';
import type { InstallerEventEmitter } from '../events.js';
import { CLIAdapter } from './cli-adapter.js';
import { CANCEL, isCancel, setUiHost, type UiHost, type UiLine, type UiPromptRequest } from '../../utils/ui.js';
import { createRunModel, type RunModel } from '../../tui/model/run-model.js';
import { loadInstallerContent } from '../../tui/content/index.js';
import { InstallerApp } from '../../tui/App.js';
import { ENTER_FULLSCREEN, LEAVE_FULLSCREEN, releaseStdin, writeNow } from '../../tui/terminal.js';
import { getLogFilePath } from '../../utils/debug.js';

export interface TuiAdapterConfig extends AdapterConfig {
  /** Project directory, for relative file paths and the header. */
  installDir: string;
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  tipIntervalMs?: number;
  /** Tests: have Ink write every frame whole (it skips live redraws when $CI is set). */
  renderFrames?: boolean;
}

const INDENT = '  ';
const TERMINATING_SIGNALS = ['SIGTERM', 'SIGHUP'] as const;
/** Events after which the agent is no longer working (validation follows it). */
const AGENT_ENDS = ['validation:start', 'agent:success', 'agent:failure', 'complete'] as const;
const ANSI = /\x1b\[[0-9;]*m/g;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

interface PendingPrompt {
  request: UiPromptRequest;
  resolve: (value: unknown) => void;
  onAbort: () => void;
}

/** How an answered prompt reads in the scrollback, like inquirer leaves it. */
function answeredLine(request: UiPromptRequest, value: unknown): string {
  const message = request.message;
  if (isCancel(value)) return `${INDENT}${chalk.red('✗')} ${message} ${chalk.dim('cancelled')}`;
  let answer: string;
  switch (request.kind) {
    case 'confirm':
      answer = value ? 'Yes' : 'No';
      break;
    case 'select': {
      const option = request.options.find((o) => o.value === value);
      answer = option?.label ?? String(value);
      break;
    }
    case 'password':
      answer = '********';
      break;
    default:
      answer = String(value);
  }
  return `${INDENT}${chalk.green('✔')} ${message} ${chalk.cyan(answer)}`;
}

export class TuiAdapter implements InstallerAdapter {
  readonly emitter: InstallerEventEmitter;
  private readonly cli: CLIAdapter;
  private readonly config: TuiAdapterConfig;
  private readonly stdout: NodeJS.WriteStream;
  private readonly stdin: NodeJS.ReadStream;
  private model: RunModel | null = null;
  private ink: Instance | null = null;
  private pending: PendingPrompt | null = null;
  private transcript: string[] = [];
  private savedConsole: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  private active = false;
  // While the agent works, its step-by-step lines stay out of the transcript.
  private agentWorking = false;
  private hiddenAgentLines = 0;
  // Where the hidden lines went; printed after the agent's closing line.
  private logPointer: string | null = null;

  constructor(config: TuiAdapterConfig) {
    this.config = config;
    this.emitter = config.emitter;
    this.cli = new CLIAdapter(config);
    this.stdout = config.stdout ?? process.stdout;
    this.stdin = config.stdin ?? process.stdin;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      this.model = createRunModel({
        emitter: this.emitter,
        content: loadInstallerContent(),
        cwd: this.config.installDir,
      });
      this.captureConsole();
      setUiHost(this.host);
      // Before the CLI adapter subscribes, so the agent window opens before its
      // spinner starts and closes before it prints the agent's final line.
      this.emitter.on('agent:start', this.agentStarted);
      for (const event of AGENT_ENDS) this.emitter.on(event, this.agentEnded);
      // Covers every way out that skips stop(): process.exit() from a handler
      // or an uncaught error. A signal that terminates by default (kill, a
      // closed terminal) emits no 'exit', so those restore the terminal themselves.
      process.on('exit', this.teardown);
      for (const signal of TERMINATING_SIGNALS) process.on(signal, this.terminated);

      writeNow(this.stdout, ENTER_FULLSCREEN);
      this.ink = render(
        createElement(InstallerApp, {
          model: this.model,
          answer: this.answer,
          // ctrl-c with no prompt open: the same SIGINT path as the plain CLI.
          interrupt: () => process.emit('SIGINT'),
          projectName: basename(this.config.installDir),
          tipIntervalMs: this.config.tipIntervalMs,
        }),
        {
          stdout: this.stdout,
          stdin: this.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
          debug: this.config.renderFrames ?? false,
        },
      );

      // Last, so its handlers land inside the full screen. What it prints on
      // start is its opener (the brand mark): the view already shows the logo,
      // so the scrollback shouldn't repeat it.
      const openerStart = this.transcript.length;
      await this.cli.start();
      this.transcript.splice(openerStart);
    } catch (error) {
      // Don't leave the terminal, console, or ui hijacked by a half-started view.
      await this.cli.stop();
      this.teardown();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    await this.cli.stop();
    this.teardown();
  }

  /** Restore the terminal and print the transcript. Safe to call more than once. */
  private teardown = (): void => {
    if (!this.active) return;
    this.active = false;
    process.off('exit', this.teardown);
    for (const signal of TERMINATING_SIGNALS) process.off(signal, this.terminated);

    // A prompt nobody will answer now must not leave its caller hanging.
    this.settle(CANCEL);
    try {
      this.ink?.unmount();
    } catch {
      // Already gone.
    }
    this.ink = null;
    releaseStdin(this.stdin);
    writeNow(this.stdout, LEAVE_FULLSCREEN);

    setUiHost(null);
    this.restoreConsole();
    this.emitter.off('agent:start', this.agentStarted);
    for (const event of AGENT_ENDS) this.emitter.off(event, this.agentEnded);
    this.agentEnded();
    this.flushLogPointer();
    this.model?.dispose();
    this.model = null;

    const transcript = this.transcript.splice(0);
    if (transcript.length) writeNow(this.stdout, `${transcript.join('\n')}\n`);
  };

  /** Restore the terminal, then die of the signal as if it had never been caught. */
  private readonly terminated = (signal: NodeJS.Signals): void => {
    this.teardown();
    process.kill(process.pid, signal);
  };

  // ── UI host ─────────────────────────────────────────────────────────────

  private readonly host: UiHost = {
    line: (line: UiLine) => {
      this.record(line.rendered ? INDENT + line.rendered : '', line.kind === 'warn' || line.kind === 'error');
      // Warnings and errors also show in the walkthrough. A line ending in ':'
      // only introduces a list that follows, so it would read as broken there.
      const message = line.message.replace(ANSI, '').trim();
      if ((line.kind === 'warn' || line.kind === 'error') && message && !message.endsWith(':')) {
        this.model?.addNotice(line.kind === 'warn' ? 'warning' : 'error', message);
      }
    },
    status: (message) => this.model?.setStatus(message ? message.replace(ANSI, '') : null),
    prompt: (request) =>
      new Promise((resolve) => {
        const onAbort = () => this.settle(CANCEL);
        request.signal?.addEventListener('abort', onAbort, { once: true });
        this.pending = { request, resolve, onAbort };
        this.model?.setPrompt(request);
      }),
  };

  private readonly answer = (value: unknown): void => this.settle(value);

  // ── Transcript ──────────────────────────────────────────────────────────

  /** Keep a line for the scrollback, unless it's the agent's play-by-play. */
  private record(text: string, important: boolean): void {
    if (this.agentWorking && !important) {
      this.hiddenAgentLines++;
      return;
    }
    this.transcript.push(text);
    this.flushLogPointer();
  }

  private flushLogPointer(): void {
    if (this.logPointer) this.transcript.push(this.logPointer);
    this.logPointer = null;
  }

  private readonly agentStarted = (): void => {
    this.agentWorking = true;
  };

  /**
   * Close the agent window. This runs just before the CLI adapter prints the
   * agent's closing line ("Agent completed"), so the note on where the hidden
   * lines went waits for that line.
   */
  private readonly agentEnded = (): void => {
    if (!this.agentWorking) return;
    this.agentWorking = false;
    if (this.hiddenAgentLines > 0) {
      const log = getLogFilePath();
      const where = log ? `: ${log.startsWith(homedir()) ? `~${log.slice(homedir().length)}` : log}` : '';
      this.logPointer = `${INDENT}${chalk.dim(`› The agent's step-by-step log is in the installer log${where}`)}`;
    }
    this.hiddenAgentLines = 0;
  };

  private settle(value: unknown): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.request.signal?.removeEventListener('abort', pending.onAbort);
    this.model?.setPrompt(null);
    this.transcript.push(answeredLine(pending.request, value));
    pending.resolve(value);
  }

  // ── Console capture ─────────────────────────────────────────────────────
  // Direct console output (the brand mark, the device-code URL, the completion
  // summary, debug lines) would scribble over the full screen, so it joins the
  // transcript instead.

  private captureConsole(): void {
    for (const method of CONSOLE_METHODS) {
      this.savedConsole[method] = console[method];
      console[method] = (...args: unknown[]) => {
        this.record(format(...args), method === 'warn' || method === 'error');
      };
    }
  }

  private restoreConsole(): void {
    for (const method of CONSOLE_METHODS) {
      const original = this.savedConsole[method];
      if (original) console[method] = original;
    }
    this.savedConsole = {};
  }
}
