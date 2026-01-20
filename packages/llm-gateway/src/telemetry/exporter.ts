import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace-node';
import type { MetricReader } from '@opentelemetry/sdk-metrics';

export function getTraceExporter(): SpanExporter | null {
  const exporterType = process.env.OTEL_EXPORTER_TYPE || 'console';
  const isLocalMode = process.env.LOCAL_MODE === 'true';

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

export function getMetricReader(): MetricReader | null {
  const exporterType = process.env.OTEL_EXPORTER_TYPE || 'console';
  const isLocalMode = process.env.LOCAL_MODE === 'true';

  if (exporterType === 'none') {
    return null;
  }

  const exporter =
    exporterType === 'otlp' && !isLocalMode
      ? new OTLPMetricExporter({
          url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace('/traces', '/metrics') || 'http://localhost:4318/v1/metrics',
        })
      : new ConsoleMetricExporter();

  return new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 10000,
  });
}
