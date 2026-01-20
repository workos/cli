import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { SpanExporter } from '@opentelemetry/sdk-trace-node';

export function getExporter(): SpanExporter | null {
  const exporterType = process.env.OTEL_EXPORTER_TYPE || 'console';
  const isLocalMode = process.env.LOCAL_MODE === 'true';

  // Force console in local mode
  if (isLocalMode) {
    return new ConsoleSpanExporter();
  }

  switch (exporterType) {
    case 'otlp':
      return new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      });
    case 'console':
      return new ConsoleSpanExporter();
    case 'none':
      return null;
    default:
      console.warn(`[Telemetry] Unknown exporter type: ${exporterType}, using console`);
      return new ConsoleSpanExporter();
  }
}
