import { NodeSDK } from '@opentelemetry/sdk-node';
import { getTraceExporter, getMetricReader } from './exporter.js';

let sdk: NodeSDK | null = null;

export function initTelemetry(serviceName: string) {
  const traceExporter = getTraceExporter();
  const metricReader = getMetricReader();

  if (!traceExporter && !metricReader) {
    console.log('[Telemetry] Disabled (OTEL_EXPORTER_TYPE=none)');
    return;
  }

  sdk = new NodeSDK({
    serviceName,
    traceExporter: traceExporter ?? undefined,
    metricReader: metricReader ?? undefined,
  });

  sdk.start();
  console.log(`[Telemetry] Initialized with ${process.env.OTEL_EXPORTER_TYPE || 'console'} exporter`);
}

export function shutdownTelemetry() {
  return sdk?.shutdown();
}
