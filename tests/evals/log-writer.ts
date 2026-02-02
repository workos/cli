import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { evalEvents, type ScenarioCompleteEvent } from './events.js';
import type { EvalLogFile, LogMeta, LogScenario, LogScenarioAttempt } from './log-types.js';

const MAX_AGENT_OUTPUT_LENGTH = 10 * 1024; // 10KB

export class LogWriter {
  private logFile: EvalLogFile;
  private filePath: string;
  private scenarioAttempts: Map<string, LogScenarioAttempt[]> = new Map();
  private scenarioStartTimes: Map<string, number> = new Map();

  constructor(options: { concurrency: number; cliFlags: LogMeta['cliFlags'] }) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.filePath = path.join(process.cwd(), 'tests', 'eval-results', `eval-run-${timestamp}.json`);

    this.logFile = {
      meta: {
        timestamp: new Date().toISOString(),
        startTime: Date.now(),
        concurrency: options.concurrency,
        cpuCount: os.cpus().length,
        cliFlags: options.cliFlags,
      },
      scenarios: [],
      summary: { total: 0, passed: 0, failed: 0, passRate: 0 },
    };

    this.setupListeners();
  }

  private setupListeners(): void {
    evalEvents.on('scenario:start', (e) => {
      this.scenarioStartTimes.set(e.scenario, Date.now());
      if (!this.scenarioAttempts.has(e.scenario)) {
        this.scenarioAttempts.set(e.scenario, []);
      }
    });

    evalEvents.on('scenario:retry', (e) => {
      this.scenarioStartTimes.set(e.scenario, Date.now());
    });

    evalEvents.on('scenario:complete', async (e: ScenarioCompleteEvent) => {
      const startTime = this.scenarioStartTimes.get(e.scenario) ?? Date.now();
      const attempts = this.scenarioAttempts.get(e.scenario) ?? [];

      // Record this attempt
      attempts.push({
        attempt: e.attempt,
        startTime,
        endTime: Date.now(),
        duration: e.duration,
        passed: e.passed,
        error: e.error,
        checks: e.checks,
        toolCalls: e.toolCalls,
      });

      this.scenarioAttempts.set(e.scenario, attempts);

      // Build scenario entry
      const scenario: LogScenario = {
        scenario: e.scenario,
        framework: e.framework,
        state: e.state,
        finalStatus: e.passed ? 'passed' : 'failed',
        totalDuration: attempts.reduce((sum, a) => sum + a.duration, 0),
        attempts,
        agentOutput: this.truncateOutput(e.agentOutput),
        agentOutputTruncated: (e.agentOutput?.length ?? 0) > MAX_AGENT_OUTPUT_LENGTH,
      };

      this.logFile.scenarios.push(scenario);
      await this.writeFile();
    });

    evalEvents.on('run:complete', async () => {
      this.logFile.meta.endTime = Date.now();
      this.logFile.meta.totalDuration = this.logFile.meta.endTime - this.logFile.meta.startTime;

      const passed = this.logFile.scenarios.filter((s) => s.finalStatus === 'passed').length;
      const total = this.logFile.scenarios.length;

      this.logFile.summary = {
        total,
        passed,
        failed: total - passed,
        passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      };

      await this.writeFile();
    });
  }

  private truncateOutput(output?: string): string | undefined {
    if (!output) return undefined;
    if (output.length <= MAX_AGENT_OUTPUT_LENGTH) return output;
    return output.slice(0, MAX_AGENT_OUTPUT_LENGTH) + '\n\n[TRUNCATED - output exceeded 10KB]';
  }

  private async writeFile(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.logFile, null, 2), 'utf-8');
    } catch (error) {
      // Non-fatal - log warning and continue
      console.warn(`Warning: Failed to write log file: ${error}`);
    }
  }

  getFilePath(): string {
    return this.filePath;
  }

  cleanup(): void {
    evalEvents.removeAllListeners('scenario:start');
    evalEvents.removeAllListeners('scenario:retry');
    evalEvents.removeAllListeners('scenario:complete');
    evalEvents.removeAllListeners('run:complete');
  }
}
