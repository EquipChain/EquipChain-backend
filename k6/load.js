/**
 * Load Test
 *
 * Purpose: Determine how the API performs under expected normal traffic.
 * Scenarios: Ramp up to 50 VUs over 1 min, stay at 50 for 3 min, ramp down to 0 over 1 min.
 * Mix: 80 % read operations (GET), 20 % authenticated operations with a setup-minted token.
 * Thresholds: p95 < 2000 ms, error rate < 1 %.
 *
 * Auth note: the token is minted ONCE in setup() - /api/auth/challenge now
 * carries a 5/min brute-force guard, so per-iteration minting would just
 * generate 429s under load (and the guard is working as intended).
 *
 * Run: k6 run k6/load.js
 *       k6 run k6/load.js -e BASE_URL=https://staging.example.com
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, DEFAULT_HEADERS, randomWallet } from './shared.js';

export const options = {
  stages: [
    { target: 50, duration: '1m' },   // Ramp up to 50 VUs
    { target: 50, duration: '3m' },   // Stay at 50 VUs
    { target: 0, duration: '1m' },    // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
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
  const token = data.token;

  // 80 % read operations
  if (Math.random() < 0.8) {
    // Read: GET /
    const resp = http.get(`${BASE_URL}/`, {
      headers: DEFAULT_HEADERS,
    });
    check(resp, {
      'load-read: status is 200': (r) => r.status === 200,
      'load-read: has project': (r) => r.json('project') !== undefined,
    });
    sleep(1);
  } else {
    // Authenticated read: GET /api/protected with the setup-minted token
    const resp = http.get(`${BASE_URL}/api/protected`, {
      headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${token}` },
    });
    check(resp, {
      'load-authed: status is 200': (r) => r.status === 200,
      'load-authed: returns data': (r) => r.json('data') !== undefined,
    });
    sleep(1);
  }
}
