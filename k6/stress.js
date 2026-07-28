/**
 * Stress Test
 *
 * Purpose: Identify the breaking point of the API by gradually increasing load.
 * Scenarios: Ramp up from 10 → 50 → 100 → 200 → 500 VUs in stages.
 * Thresholds: p95 < 5000 ms, error rate < 5 % (relaxed for high load).
 *
 * Run: k6 run k6/stress.js
 *       k6 run k6/stress.js -e BASE_URL=https://staging.example.com
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, DEFAULT_HEADERS, randomWallet } from './shared.js';

export const options = {
  stages: [
    { target: 10, duration: '30s' },   // Warm-up
    { target: 50, duration: '1m' },    // Moderate load
    { target: 100, duration: '1m' },   // High load
    { target: 200, duration: '1m' },   // Very high load
    { target: 500, duration: '2m' },   // Stress peak
    { target: 0, duration: '30s' },    // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(75)', 'p(90)', 'p(95)', 'p(99)'],
};

export default function () {
  // Mix of endpoints to simulate realistic traffic
  const choice = Math.random();

  if (choice < 0.4) {
    // GET /
    const resp = http.get(`${BASE_URL}/`, { headers: DEFAULT_HEADERS });
    check(resp, {
      'stress-home: status is 200': (r) => r.status === 200,
    });
  } else if (choice < 0.7) {
    // GET /api/health
    const resp = http.get(`${BASE_URL}/api/health`, { headers: DEFAULT_HEADERS });
    check(resp, {
      'stress-health: status is 200': (r) => r.status === 200,
    });
  } else if (choice < 0.9) {
    // POST /api/auth/challenge
    const wallet = randomWallet();
    const resp = http.post(
      `${BASE_URL}/api/auth/challenge`,
      JSON.stringify({ wallet }),
      { headers: DEFAULT_HEADERS },
    );
    check(resp, {
      'stress-auth: status is 200': (r) => r.status === 200,
    });
  } else {
    // GET /api/protected (with token)
    const wallet = randomWallet();
    const authResp = http.post(
      `${BASE_URL}/api/auth/challenge`,
      JSON.stringify({ wallet }),
      { headers: DEFAULT_HEADERS },
    );
    const token = authResp.json('token');
    if (token) {
      const resp = http.get(`${BASE_URL}/api/protected`, {
        headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${token}` },
      });
      check(resp, {
        'stress-protected: status is 200': (r) => r.status === 200,
      });
    }
  }

  sleep(0.5);
}
