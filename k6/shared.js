/**
 * Shared configuration, thresholds, and helper functions for k6 load tests.
 *
 * All test scenarios import from this module to maintain consistent defaults.
 * Environment variables override any value at runtime.
 *
 * Usage:
 *   import { BASE_URL, thresholds, randomWallet } from './shared.js';
 */

// ---------------------------------------------------------------------------
// Base URL & Default Headers
// ---------------------------------------------------------------------------
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// ---------------------------------------------------------------------------
// Thresholds (applied across all tests; individual tests may override)
// ---------------------------------------------------------------------------
export const THRESHOLDS = {
  /** 95 % of requests should complete under 2 seconds */
  http_req_duration: ['p(95)<2000'],
  /** Less than 1 % of requests may return errors */
  http_req_failed: ['rate<0.01'],
  /** All checks must pass (100 % success rate) */
  checks: ['rate===1'],
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Generate a random wallet address for auth challenge tests.
 * @returns {string} Random Stellar-like wallet address
 */
export function randomWallet() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let wallet = 'G';
  for (let i = 0; i < 55; i++) {
    wallet += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return wallet;
}

/**
 * Return a random integer between min and max (inclusive).
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simulated think / sleep time to mimic real user behaviour.
 * @param {number} t - base time in seconds
 * @param {number} [jitter=0.5] - random jitter fraction (0..1)
 */
export function thinkTime(t, jitter = 0.5) {
  const sleep = t * (1 + Math.random() * jitter);
  return sleep;
}
