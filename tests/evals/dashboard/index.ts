import React from 'react';
import { render } from 'ink';
import { EvalDashboard } from './EvalDashboard.js';

interface RenderOptions {
  scenarios: Array<{ framework: string; state: string }>;
  concurrency: number;
}

export function renderDashboard(options: RenderOptions): { unmount: () => void } {
  const { unmount } = render(React.createElement(EvalDashboard, options));
  return { unmount };
}

export { EvalDashboard };
