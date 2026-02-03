import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { evalEvents, type ScenarioStartEvent, type ScenarioCompleteEvent, type RunProgressEvent } from '../events.js';
import { Header } from './Header.js';
import { ScenarioRow } from './ScenarioRow.js';

interface ScenarioStatus {
  scenario: string;
  framework: string;
  state: string;
  status: 'pending' | 'running' | 'retrying' | 'passed' | 'failed';
  attempt: number;
  duration?: number;
  error?: string;
  startTime?: number;
}

interface DashboardProps {
  scenarios: Array<{ framework: string; state: string }>;
  concurrency: number;
}

export function EvalDashboard({ scenarios, concurrency }: DashboardProps) {
  const { exit } = useApp();

  const [statuses, setStatuses] = useState<Map<string, ScenarioStatus>>(() => {
    const map = new Map();
    for (const s of scenarios) {
      const name = `${s.framework}/${s.state}`;
      map.set(name, {
        scenario: name,
        framework: s.framework,
        state: s.state,
        status: 'pending',
        attempt: 0,
      });
    }
    return map;
  });

  const [progress, setProgress] = useState<RunProgressEvent>({
    completed: 0,
    total: scenarios.length,
    running: 0,
    elapsed: 0,
  });

  useEffect(() => {
    const onStart = (e: ScenarioStartEvent) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(e.scenario, {
          ...next.get(e.scenario)!,
          status: 'running',
          attempt: e.attempt,
          startTime: Date.now(),
        });
        return next;
      });
    };

    const onRetry = (e: ScenarioStartEvent) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(e.scenario, {
          ...next.get(e.scenario)!,
          status: 'retrying',
          attempt: e.attempt,
          startTime: Date.now(),
        });
        return next;
      });
    };

    const onComplete = (e: ScenarioCompleteEvent) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(e.scenario, {
          ...next.get(e.scenario)!,
          status: e.passed ? 'passed' : 'failed',
          duration: e.duration,
          error: e.error,
        });
        return next;
      });
    };

    const onProgress = (e: RunProgressEvent) => setProgress(e);
    const onRunComplete = () => exit();

    evalEvents.on('scenario:start', onStart);
    evalEvents.on('scenario:retry', onRetry);
    evalEvents.on('scenario:complete', onComplete);
    evalEvents.on('run:progress', onProgress);
    evalEvents.on('run:complete', onRunComplete);

    return () => {
      evalEvents.off('scenario:start', onStart);
      evalEvents.off('scenario:retry', onRetry);
      evalEvents.off('scenario:complete', onComplete);
      evalEvents.off('run:progress', onProgress);
      evalEvents.off('run:complete', onRunComplete);
    };
  }, [exit]);

  // Sort: running → retrying → failed → passed → pending
  const sorted = Array.from(statuses.values()).sort((a, b) => {
    const order = { running: 0, retrying: 1, failed: 2, passed: 3, pending: 4 };
    return order[a.status] - order[b.status];
  });

  return (
    <Box flexDirection="column">
      <Header progress={progress} concurrency={concurrency} />
      <Box flexDirection="column" marginTop={1}>
        {sorted.map((s) => (
          <ScenarioRow key={s.scenario} {...s} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to cancel</Text>
      </Box>
    </Box>
  );
}
