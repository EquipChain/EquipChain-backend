/**
 * Soak / Endurance Test
 *
 * Purpose: Detect memory leaks and performance degradation over extended periods.
 * Scenarios: 50 VUs sustained for 30+ minutes.
 * Thresholds: p95 < 2000 ms, error rate < 1 %.
 *
 * Run: k6 run k6/soak.js
 *       k6 run k6/soak.js -e BASE_URL=https://staging.example.com
 *       k6 run k6/soak.js -e DURATION=60m -e VUS=100
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, DEFAULT_HEADERS, randomWallet, randomInt } from './shared.js';

// Allow duration and VUs to be overridden via environment variables
const DURATION = __ENV.DURATION || '30m';
const VUS = parseInt(__ENV.VUS, 10) || 50;

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(75)', 'p(90)', 'p(95)', 'p(99)'],
};

export default function () {
  // Realistic user behaviour: mix of operations with think time
  const choice = Math.random();

  if (choice < 0.35) {
    // GET /
    const resp = http.get(`${BASE_URL}/`, { headers: DEFAULT_HEADERS });
    check(resp, {
      'soak-home: status is 200': (r) => r.status === 200,
    });
  } else if (choice < 0.55) {
    // GET /api/health
    const resp = http.get(`${BASE_URL}/api/health`, { headers: DEFAULT_HEADERS });
    check(resp, {
      'soak-health: status is 200': (r) => r.status === 200,
    });
  } else if (choice < 0.75) {
    // POST /api/auth/challenge
    const wallet = randomWallet();
    const resp = http.post(
      `${BASE_URL}/api/auth/challenge`,
      JSON.stringify({ wallet }),
      { headers: DEFAULT_HEADERS },
    );
    check(resp, {
      'soak-auth: status is 200': (r) => r.status === 200,
    });
  } else if (choice < 0.9) {
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
        'soak-protected: status is 200': (r) => r.status === 200,
      });
    }
  } else {
    // Unauthorized access (401 expected)
    const resp = http.get(`${BASE_URL}/api/protected`, {
      headers: DEFAULT_HEADERS,
    });
    check(resp, {
      'soak-unauthorized: status is 401': (r) => r.status === 401,
    });
  }

  // Think time: simulate real user pause between actions
  sleep(randomInt(1, 3));
}
