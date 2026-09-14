/**
 * Smoke Test
 *
 * Purpose: Verify the API responds correctly under minimal load.
 * Scenarios: 1 virtual user performing all primary operations.
 * Duration: 30 seconds.
 * Thresholds: All requests succeed, p95 < 1000 ms.
 *
 * The auth challenge is exercised ONCE in setup() and the minted token is
 * reused across iterations: the endpoint now carries a 5/min brute-force
 * guard (by design), so per-iteration minting would throttle any run longer
 * than a few seconds and turn a smoke test into a 429 generator.
 *
 * Run: k6 run k6/smoke.js
 *       k6 run k6/smoke.js -e BASE_URL=https://staging.example.com
 */

import { check } from 'k6';
import http from 'k6/http';
import { BASE_URL, DEFAULT_HEADERS, randomWallet } from './shared.js';

// Allow both success (2xx) and expected auth failures (401) — 401 is intentional behaviour
http.setResponseCallback(http.expectedStatuses(200, 401));

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate===1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(75)', 'p(90)', 'p(95)', 'p(99)'],
};

// Mint one token per run (not per iteration) - see header note.
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

  // 1. GET / – Project metadata
  const homeResp = http.get(`${BASE_URL}/`, {
    headers: DEFAULT_HEADERS,
  });
  check(homeResp, {
    'home: status is 200': (r) => r.status === 200,
    'home: body has project field': (r) => r.json('project') !== undefined,
    'home: body has contract field': (r) => r.json('contract') !== undefined,
  });

  // 2. GET /api/health – Health check
  const healthResp = http.get(`${BASE_URL}/api/health`, {
    headers: DEFAULT_HEADERS,
  });
  check(healthResp, {
    'health: status is 200': (r) => r.status === 200,
    'health: body is healthy': (r) => r.json('status') === 'healthy',
    'health: has uptime field': (r) => r.json('uptime') !== undefined,
  });

  // 3. GET /api/protected – Protected route (setup-minted token)
  const protectedHeaders = {
    ...DEFAULT_HEADERS,
    Authorization: `Bearer ${token}`,
  };
  const protectedResp = http.get(`${BASE_URL}/api/protected`, {
    headers: protectedHeaders,
  });
  check(protectedResp, {
    'protected: status is 200': (r) => r.status === 200,
    'protected: returns data': (r) => r.json('data') === 'Sensitive meter data',
  });

  // 4. GET /api/protected – Without token (expected 401)
  const unauthorizedResp = http.get(`${BASE_URL}/api/protected`, {
    headers: DEFAULT_HEADERS,
  });
  check(unauthorizedResp, {
    'unauthorized: status is 401': (r) => r.status === 401,
    'unauthorized: returns error': (r) => r.json('error') !== undefined,
  });
}
