'use strict';

// src/middleware/metrics.js
//
// Minimal Prometheus-compatible metrics without adding a client library
// dependency: request counter, response-time histogram buckets, and gauge
// snapshots exposed in the Prometheus text exposition format at /metrics.
//
// Design notes:
// - Cardinality is deliberately bounded: the path label uses the Express
//   route pattern (req.route.path / baseUrl), not the raw URL, so unbounded
//   values (meter IDs, cursor strings, query strings) cannot explode label
//   cardinality - the classic way Prometheus deployments fall over.
// - All state lives in plain Maps; a scrape is O(1) over label combinations.

const { childLogger } = require('../config/logger');

const log = childLogger('metrics');

const HTTP_DURATION_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// Deployment identity for the build_info gauge. Unset env collapses to
// 'unknown' rather than emitting an empty label - an empty git_sha label is
// indistinguishable in dashboards from a scrape bug.
const GIT_SHA = process.env.GIT_SHA || 'unknown';
const DEPLOY_TIME = process.env.DEPLOY_TIME || 'unknown';

/** Map<`${method}|${route}|${status}`, count> */
const requestCounts = new Map();
/** Map<`${method}|${route}`, { buckets: Map<bucketIndex, count>, sum, count }> */
const durationHistograms = new Map();
const processStartMs = Date.now();

/**
 * Gauge providers registered by services (queue depth, schedule count,
 * cache pressure, ...). Each provider returns zero or more gauge series:
 *   { name, help, values: [{ labels: {...}, value }] }
 * Providers run on every scrape, so gauges always reflect live state without
 * any push machinery. A throwing provider is skipped (with a warning) so one
 * broken service cannot poison the whole scrape.
 */
const gaugeProviders = new Set();

/**
 * Register a gauge provider. Returns an unregister function so services can
 * remove their gauges on shutdown (avoids scraping dead instances' state).
 *
 * @param {() => Array<{name: string, help: string, values: Array<{labels?: Object, value: number}>}>} provider
 * @returns {() => void}
 */
function registerGaugeProvider(provider) {
  gaugeProviders.add(provider);
  return () => gaugeProviders.delete(provider);
}

// ─── Event-loop lag sampler ──────────────────────────────────────────────

// Most recent measured lag in ms. The sampler schedules setImmediate on a
// recurring timer: when the immediate fires, the elapsed time since its
// scheduling approximates how long the loop was busy. Sampling continuously
// (rather than at scrape time) keeps renderMetrics synchronous - Prometheus
// text exposition has no deferred semantics.
let lastLagMs = 0;
let lagTimer = null;

/**
 * Start the 1s lag sampler. Called by server boot; idempotent, unref'd so
 * it never holds the process open.
 */
function startLagSampler() {
  if (lagTimer) return;
  lagTimer = setInterval(() => {
    const scheduled = process.hrtime.bigint();
    setImmediate(() => {
      lastLagMs = Number(process.hrtime.bigint() - scheduled) / 1e6;
    });
  }, 1000);
  if (typeof lagTimer.unref === 'function') {
    lagTimer.unref();
  }
}

/**
 * Best-effort route label for cardinality safety. Falls back through:
 * mounted route path -> baseUrl+'/' -> 'unmatched' (e.g. 404s).
 */
function routeLabel(req) {
  if (req.route && req.route.path) {
    return (req.baseUrl || '') + req.route.path;
  }
  if (req.baseUrl) {
    return req.baseUrl + '/';
  }
  return 'unmatched';
}

function bucketFor(ms) {
  for (let i = 0; i < HTTP_DURATION_BUCKETS_MS.length; i++) {
    if (ms <= HTTP_DURATION_BUCKETS_MS[i]) return i;
  }
  return HTTP_DURATION_BUCKETS_MS.length; // +Inf bucket
}

/**
 * Express middleware: records request count and duration per
 * (method, route, status). Must be mounted before the router.
 */
function metricsMiddleware(req, res, next) {
  const startNs = process.hrtime.bigint();

  res.on('finish', () => {
    try {
      const route = routeLabel(req);
      const method = req.method;
      const status = String(res.statusCode);

      const countKey = `${method}|${route}|${status}`;
      requestCounts.set(countKey, (requestCounts.get(countKey) || 0) + 1);

      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const histKey = `${method}|${route}`;
      let hist = durationHistograms.get(histKey);
      if (!hist) {
        hist = { buckets: new Map(), sum: 0, count: 0 };
        durationHistograms.set(histKey, hist);
      }
      const b = bucketFor(durationMs);
      hist.buckets.set(b, (hist.buckets.get(b) || 0) + 1);
      hist.sum += durationMs;
      hist.count += 1;
    } catch (err) {
      // Metrics must never take a request down.
      log.warn({ error: err.message }, 'metrics recording failed');
    }
  });

  next();
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Render metrics in the Prometheus text exposition format.
 * @returns {string}
 */
function renderMetrics() {
  const lines = [];
  const nowMs = Date.now();

  lines.push('# HELP equipchain_http_requests_total Total HTTP requests.');
  lines.push('# TYPE equipchain_http_requests_total counter');
  for (const [key, count] of requestCounts) {
    const [method, route, status] = key.split('|');
    lines.push(
      `equipchain_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"} ${count}`
    );
  }

  lines.push('# HELP equipchain_http_request_duration_ms HTTP request duration in ms.');
  lines.push('# TYPE equipchain_http_request_duration_ms histogram');
  for (const [key, hist] of durationHistograms) {
    const [method, route] = key.split('|');
    const label = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
    let cumulative = 0;
    for (let i = 0; i < HTTP_DURATION_BUCKETS_MS.length; i++) {
      cumulative += hist.buckets.get(i) || 0;
      lines.push(
        `equipchain_http_request_duration_ms_bucket{${label},le="${HTTP_DURATION_BUCKETS_MS[i]}"} ${cumulative}`
      );
    }
    cumulative += hist.buckets.get(HTTP_DURATION_BUCKETS_MS.length) || 0;
    lines.push(`equipchain_http_request_duration_ms_bucket{${label},le="+Inf"} ${cumulative}`);
    lines.push(`equipchain_http_request_duration_ms_sum{${label}} ${hist.sum.toFixed(3)}`);
    lines.push(`equipchain_http_request_duration_ms_count{${label}} ${hist.count}`);
  }

  lines.push('# HELP equipchain_process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE equipchain_process_uptime_seconds gauge');
  lines.push(`equipchain_process_uptime_seconds ${(nowMs - processStartMs) / 1000}`);

  const mem = process.memoryUsage();
  lines.push('# HELP equipchain_process_heap_bytes Process heap statistics in bytes.');
  lines.push('# TYPE equipchain_process_heap_bytes gauge');
  lines.push(`equipchain_process_heap_bytes{type="used"} ${mem.heapUsed}`);
  lines.push(`equipchain_process_heap_bytes{type="total"} ${mem.heapTotal}`);
  lines.push(`equipchain_process_heap_bytes{type="rss"} ${mem.rss}`);

  // Event-loop lag: the single most telling health metric for a Node API.
  // A pinned CPU, a synchronous hot path, or a wedged loop shows up here
  // long before request latency percentiles move. Sampled continuously by
  // startLagSampler(); renderMetrics stays synchronous.
  lines.push('# HELP equipchain_eventloop_lag_ms Approximate event-loop lag in ms.');
  lines.push('# TYPE equipchain_eventloop_lag_ms gauge');
  lines.push(`equipchain_eventloop_lag_ms ${lastLagMs.toFixed(3)}`);

  // Build info: the standard Prometheus pattern for deployment identity.
  // /health reports it in JSON for humans, but dashboards and alert rules
  // need it as a label they can group by - "is this instance running the
  // build with the fix?" becomes a PromQL join instead of a guess. Labels
  // are set from deploy-tooling env (GIT_SHA/DEPLOY_TIME) and stay constant
  // for the process lifetime, so cardinality is fixed at 1 series.
  lines.push('# HELP equipchain_build_info Build identity (git SHA, deploy time).');
  lines.push('# TYPE equipchain_build_info gauge');
  lines.push(`equipchain_build_info{git_sha="${escapeLabel(GIT_SHA)}",deploy_time="${escapeLabel(DEPLOY_TIME)}"} 1`);

  // Service gauges (queue depth, schedules, cache pressure, ...).
  // HELP/TYPE are only emitted when at least one finite value renders: a
  // gauge whose every value is NaN (e.g. a provider reading a dead
  // subsystem) otherwise leaves orphan metadata lines that Prometheus
  // accepts but that pollute the output and confuse parsers that expect
  // samples after TYPE.
  for (const provider of gaugeProviders) {
    try {
      for (const gauge of provider()) {
        if (!gauge || !gauge.name || !Array.isArray(gauge.values)) continue;
        const sampleLines = [];
        for (const series of gauge.values) {
          const labels = Object.entries(series.labels || {})
            .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
            .join(',');
          const labelPart = labels ? `{${labels}}` : '';
          const value = Number(series.value);
          if (!Number.isFinite(value)) continue;
          sampleLines.push(`${gauge.name}${labelPart} ${value}`);
        }
        if (sampleLines.length === 0) continue;
        lines.push(`# HELP ${gauge.name} ${escapeLabel(gauge.help || gauge.name)}`);
        lines.push(`# TYPE ${gauge.name} gauge`);
        lines.push(...sampleLines);
      }
    } catch (err) {
      log.warn({ error: err.message }, 'gauge provider failed during scrape');
    }
  }

  return lines.join('\n') + '\n';
}

module.exports = { metricsMiddleware, renderMetrics, registerGaugeProvider, startLagSampler, HTTP_DURATION_BUCKETS_MS };
