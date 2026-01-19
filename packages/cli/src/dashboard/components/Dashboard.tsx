import React, { useState, useEffect } from 'react';
import { useInput } from 'ink';
import { DashboardLayout } from './DashboardLayout.js';
import { CompletionView } from './CompletionView.js';
import type { DashboardProps } from '../types.js';

type DashboardState = 'running' | 'complete';
type FocusedPanel = 'changes' | 'output';

interface OutputLine {
  text: string;
  isError?: boolean;
  isStatus?: boolean;
}

export function Dashboard({ emitter }: DashboardProps): React.ReactElement {
  const [state, setState] = useState<DashboardState>('running');
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>('changes');
  const [completionData, setCompletionData] = useState<{
    success: boolean;
    summary?: string;
  } | null>(null);
  const [outputLog, setOutputLog] = useState<OutputLine[]>([]);
  const [credentialsRequest, setCredentialsRequest] = useState<{
    requiresApiKey: boolean;
  } | null>(null);

  // Tab to switch focus between panels (only when not entering credentials)
  useInput(
    (input, key) => {
      if (key.tab) {
        setFocusedPanel((prev) => (prev === 'changes' ? 'output' : 'changes'));
      }
    },
    { isActive: state === 'running' && !credentialsRequest },
  );

  useEffect(() => {
    const handleOutput = ({
      text,
      isError,
    }: {
      text: string;
      isError?: boolean;
    }) => {
      const newLines = text.split('\n').map((line) => ({
        text: line,
        isError,
        isStatus: line.includes('[STATUS]'),
      }));
      setOutputLog((prev) => [...prev, ...newLines]);
    };

    const handleStatus = ({ message }: { message: string }) => {
      setOutputLog((prev) => [
        ...prev,
        { text: `[STATUS] ${message}`, isStatus: true },
      ]);
    };

    const handleComplete = ({
      success,
      summary,
    }: {
      success: boolean;
      summary?: string;
    }) => {
      setCompletionData({ success, summary });
      setState('complete');
    };

    const handleError = ({ message }: { message: string }) => {
      setOutputLog((prev) => [
        ...prev,
        { text: `ERROR: ${message}`, isError: true },
      ]);
    };

    const handleCredentialsRequest = ({
      requiresApiKey,
    }: {
      requiresApiKey: boolean;
    }) => {
      setCredentialsRequest({ requiresApiKey });
    };

    emitter.on('output', handleOutput);
    emitter.on('status', handleStatus);
    emitter.on('complete', handleComplete);
    emitter.on('error', handleError);
    emitter.on('credentials:request', handleCredentialsRequest);

    return () => {
      emitter.off('output', handleOutput);
      emitter.off('status', handleStatus);
      emitter.off('complete', handleComplete);
      emitter.off('error', handleError);
      emitter.off('credentials:request', handleCredentialsRequest);
    };
  }, [emitter]);

  const handleCredentialsSubmit = (credentials: {
    apiKey: string;
    clientId: string;
  }) => {
    emitter.emit('credentials:response', credentials);
    setCredentialsRequest(null);
  };

  if (state === 'complete' && completionData) {
    return (
      <CompletionView
        success={completionData.success}
        summary={completionData.summary}
        outputLog={outputLog}
      />
    );
  }

  return (
    <DashboardLayout
      emitter={emitter}
      focusedPanel={focusedPanel}
      credentialsRequest={credentialsRequest}
      onCredentialsSubmit={handleCredentialsSubmit}
    />
  );
}
