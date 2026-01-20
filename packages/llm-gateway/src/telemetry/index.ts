import { NodeSDK } from '@opentelemetry/sdk-node';
import { getExporter } from './exporter.js';

let sdk: NodeSDK | null = null;

export function initTelemetry(serviceName: string) {
  const exporter = getExporter();

  if (!exporter) {
    console.log('[Telemetry] Disabled (OTEL_EXPORTER_TYPE=none)');
    return;
  }

  sdk = new NodeSDK({
    serviceName,
    traceExporter: exporter,
  });

  sdk.start();
  console.log(`[Telemetry] Initialized with ${process.env.OTEL_EXPORTER_TYPE || 'console'} exporter`);
}

export function shutdownTelemetry() {
  return sdk?.shutdown();
}
