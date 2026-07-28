/**
 * Spike Test
 *
 * Purpose: Verify the API can handle sudden traffic surges.
 * Scenarios: Sudden jump from 0 → 200 VUs, sustain for 1 min, then immediate drop.
 * Thresholds: p99 < 3000 ms, error rate < 2 %.
 *
 * Run: k6 run k6/spike.js
 *       k6 run k6/spike.js -e BASE_URL=https://staging.example.com
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, DEFAULT_HEADERS, randomWallet } from './shared.js';

export const options = {
  stages: [
    { target: 200, duration: '10s' },  // Instant spike to 200 VUs
    { target: 200, duration: '1m' },   // Sustain spike
    { target: 0, duration: '10s' },    // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(99)<3000'],
    http_req_failed: ['rate<0.02'],
    checks: ['rate>0.98'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(75)', 'p(90)', 'p(95)', 'p(99)'],
};

export default function () {
  // Primarily read operations (GET) during spike
  const resp = http.get(`${BASE_URL}/`, {
    headers: DEFAULT_HEADERS,
    tags: { operation: 'spike-read' },
  });
  check(resp, {
    'spike: status is 200': (r) => r.status === 200,
    'spike: has project': (r) => r.json('project') !== undefined,
  });

  // Every 5th request also hits the health endpoint
  if (__ITER % 5 === 0) {
    const healthResp = http.get(`${BASE_URL}/api/health`, {
      headers: DEFAULT_HEADERS,
    });
    check(healthResp, {
      'spike-health: status is 200': (r) => r.status === 200,
    });
  }

  // Every 10th request also hits the auth endpoint
  if (__ITER % 10 === 0) {
    const wallet = randomWallet();
    const authResp = http.post(
      `${BASE_URL}/api/auth/challenge`,
      JSON.stringify({ wallet }),
      { headers: DEFAULT_HEADERS },
    );
    check(authResp, {
      'spike-auth: status is 200': (r) => r.status === 200,
    });
  }

  sleep(0.3);
}
