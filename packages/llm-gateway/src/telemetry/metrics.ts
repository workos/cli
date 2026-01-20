import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram } from '@opentelemetry/api';

const meter = metrics.getMeter('wizard-telemetry');

export const sessionCounter = meter.createCounter('wizard.sessions', {
  description: 'Total wizard runs',
});

export const sessionSuccessCounter = meter.createCounter('wizard.sessions.success', {
  description: 'Successful wizard completions',
});

export const sessionFailureCounter = meter.createCounter('wizard.sessions.failure', {
  description: 'Failed wizard runs',
});

export const tokensHistogram = meter.createHistogram('wizard.tokens.total', {
  description: 'Token usage distribution',
  unit: 'tokens',
});

export const durationHistogram = meter.createHistogram('wizard.duration', {
  description: 'Session duration',
  unit: 'ms',
});
