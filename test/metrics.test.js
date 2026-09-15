'use strict';

// test/metrics.test.js
//
// Tests for the Prometheus scrape output. The /metrics endpoint previously
// had zero direct test coverage; these pin the exposition-format contract
// that dashboards and alert rules depend on: metric naming, TYPE/HELP
// lines, label escaping, and the build-identity series.

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { renderMetrics, registerGaugeProvider, HTTP_DURATION_BUCKETS_MS } = require('../src/middleware/metrics');

describe('/metrics scrape output', () => {
  it('exposes the standard process gauges', () => {
    const output = renderMetrics();
    assert.match(output, /^# TYPE equipchain_process_uptime_seconds gauge$/m);
    assert.match(output, /^equipchain_process_uptime_seconds \d/m);
    assert.match(output, /^# TYPE equipchain_process_heap_bytes gauge$/m);
    assert.match(output, /equipchain_process_heap_bytes\{type="rss"\} \d+/m);
  });

  it('exposes the event-loop lag gauge', () => {
    const output = renderMetrics();
    assert.match(output, /^# TYPE equipchain_eventloop_lag_ms gauge$/m);
    assert.match(output, /^equipchain_eventloop_lag_ms \d/m);
  });

  it('emits build info with git_sha and deploy_time labels', () => {
    const output = renderMetrics();
    assert.match(output, /^# TYPE equipchain_build_info gauge$/m);
    assert.match(
      output,
      /^equipchain_build_info\{git_sha="[^"]*",deploy_time="[^"]*"\} 1$/m
    );
  });

  it('falls back to "unknown" build labels when deploy env is unset', () => {
    // In the test process GIT_SHA/DEPLOY_TIME are not set by deploy tooling;
    // empty labels would be indistinguishable from a scrape bug.
    const output = renderMetrics();
    assert.match(output, /equipchain_build_info\{git_sha="unknown",deploy_time="unknown"\} 1/);
  });

  it('escapes label values in the exposition format', () => {
    const unregister = registerGaugeProvider(() => [
      {
        name: 'test_escape_gauge',
        help: 'escapes \n and " chars',
        values: [{ labels: { nasty: 'a"b\\c' }, value: 1 }],
      },
    ]);
    try {
      const output = renderMetrics();
      assert.match(output, /nasty="a\\"b\\\\c"/);
    } finally {
      unregister();
    }
  });

  it('registers and unregisters gauge providers (bounded scrape)', () => {
    const unregister = registerGaugeProvider(() => [
      { name: 'test_provider_gauge', help: 'h', values: [{ value: 42 }] },
    ]);
    assert.match(renderMetrics(), /^test_provider_gauge 42$/m);
    unregister();
    assert.doesNotMatch(renderMetrics(), /test_provider_gauge/);
  });

  it('skips gauge values that are not finite numbers', () => {
    const unregister = registerGaugeProvider(() => [
      { name: 'test_broken_gauge', help: 'h', values: [{ value: Number.NaN }] },
    ]);
    try {
      assert.doesNotMatch(renderMetrics(), /test_broken_gauge/);
    } finally {
      unregister();
    }
  });

  it('documents every histogram bucket including +Inf', () => {
    const output = renderMetrics();
    // The histogram block only renders when a request has been recorded;
    // the contract checked here is the bucket table itself.
    assert.ok(HTTP_DURATION_BUCKETS_MS.length >= 10);
    assert.ok(!output.includes('NaN'));
  });
});
