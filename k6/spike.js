/**
 * Spike Test
 *
 * Purpose: Verify the API can handle sudden traffic surges.
 * Scenarios: Sudden jump from 0 → 200 VUs, sustain for 1 min, then immediate drop.
 * Thresholds: p99 < 3000 ms, error rate < 2 %.
 *
 * Auth note: the protected-route check uses a setup-minted token;
 * /api/auth/challenge is deliberately not hit per iteration (5/min
 * brute-force guard would turn the spike into a 429 showcase).
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

export function setup() {
  const authResp = http.post(
    `${BASE_URL}/api/auth/challenge`,
    JSON.stringify({ wallet: randomWallet() }),
    { headers: DEFAULT_HEADERS },
  );
  const token = authResp.json('token');
  if (!token) {
    throw new Error(`setup: could not mint token (status ${authResp.status})`);
  }
  return { token };
}

export default function (data) {
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

  // Every 10th request exercises an authenticated read with the minted token
  if (__ITER % 10 === 0) {
    const protectedResp = http.get(`${BASE_URL}/api/protected`, {
      headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${data.token}` },
    });
    check(protectedResp, {
      'spike-protected: status is 200': (r) => r.status === 200,
    });
  }

  sleep(0.3);
}
