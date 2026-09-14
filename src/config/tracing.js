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
}

/**
 * Flush and stop tracing with a bounded wait.
 *
 * This module deliberately owns NO signal handlers. It previously registered
 * its own SIGTERM listener that called process.exit(0) the moment
 * sdk.shutdown() resolved - racing the server's graceful shutdown and, when
 * the exporter flushed fast, killing the process before HTTP connections
 * drained and services closed. Tracing shutdown is now a step INSIDE the
 * server's ordered shutdown sequence, and the sdk's promise is raced against
 * a timeout because a wedged exporter must not extend the shutdown window.
 *
 * @param {number} [timeoutMs=3000] - Max wait for the flush
 * @returns {Promise<void>} Resolves when flushed, timed out, or failed
 */
async function shutdownTracing(timeoutMs = 3000) {
  if (!sdk) {
    return;
  }
  try {
    await Promise.race([
      sdk.shutdown(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
    ]);
  } catch (err) {
    // Swallow: tracing must never turn shutdown into an error path.
    console.error('[tracing] shutdown failed:', err && err.message);
  }
}

module.exports = { sdk, shutdownTracing };
