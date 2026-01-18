// Dashboard module entry point
// All Ink/React dependencies are contained here

export interface DashboardOptions {
  emitter: import('../lib/events.js').WizardEventEmitter;
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  // Dynamic import to avoid loading React unless needed
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { Dashboard } = await import('./components/Dashboard.js');

  render(createElement(Dashboard, { emitter: options.emitter }));
}

export async function stopDashboard(): Promise<void> {
  // Cleanup will be implemented in Phase 3
}
