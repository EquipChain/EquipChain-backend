const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const isTest = process.env.NODE_ENV === 'test';

let sdk = null;

if (!isTest) {
  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'equipchain-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .finally(() => process.exit(0));
  });
}

module.exports = { sdk };
