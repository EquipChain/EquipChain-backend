'use strict';

// src/jobs/webhookRetry.job.js
//
// Webhook delivery handler for the job queue. Performs a real HTTP(S) POST
// with bounded latency and SSRF guards, returning a structured result the
// queue can persist. Throwing signals failure so the queue's retry ladder
// (exponential backoff, max attempts) applies.
//
// Replaces the previous placeholder that slept 500ms and simulated a
// delivery with Math.random() - meaning registered webhooks were never
// actually contacted.

const http = require('http');
const https = require('https');
const net = require('net');
const { childLogger } = require('../config/logger');
const { webhookRepository } = require('../repositories/WebhookRepository');

const log = childLogger('job:webhookRetry');

const DELIVERY_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024; // read at most 64KB of the response body

/**
 * Resolve a hostname and reject private/loopback/link-local targets.
 * Webhook URLs are admin-supplied, and without this check a webhook is a
 * ready-made SSRF pivot: POST to http://169.254.169.254/ (cloud metadata),
 * internal services, or localhost ports.
 */
function assertPublicHost(hostname) {
  return new Promise((resolve, reject) => {
    if (net.isIP(hostname)) {
      return resolve(checkIp(hostname));
    }
    dnsLookup(hostname, (err, address) => {
      if (err) return reject(new Error(`Webhook host does not resolve: ${hostname}`));
      resolve(checkIp(address));
    });
  });

  function checkIp(ip) {
    const parts = ip.split('.').map(Number);
    const blocked =
      ip === '::1' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('fe80') ||
      (parts.length === 4 &&
        (parts[0] === 10 ||
          parts[0] === 127 ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168) ||
          (parts[0] === 169 && parts[1] === 254) ||
          parts[0] === 0));
    if (blocked) {
      throw new Error(`Refusing to deliver webhook to private/reserved address: ${ip}`);
    }
    return ip;
  }
}

function dnsLookup(hostname, cb) {
  require('dns').lookup(hostname, cb);
}

/**
 * POST the payload to the target URL with redirects followed (public hosts
 * only) and a hard timeout.
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
function postJson(urlString, payload, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return reject(new Error(`Invalid webhook URL: ${urlString}`));
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return reject(new Error(`Unsupported webhook protocol: ${url.protocol}`));
    }

    assertPublicHost(url.hostname).catch(reject);

    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);

    const req = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'EquipChain-Webhook/1.0',
        },
        timeout: DELIVERY_TIMEOUT_MS,
      },
      (res) => {
        // Follow a bounded number of redirects.
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          const location = res.headers.location;
          if (!location || redirectsLeft <= 0) {
            return resolve({ statusCode: res.statusCode, body: '' });
          }
          const next = new URL(location, url).toString();
          return resolve(postJson(next, payload, redirectsLeft - 1));
        }

        let data = '';
        let bytes = 0;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes <= MAX_RESPONSE_BYTES) {
            data += chunk;
          } else {
            req.destroy(new Error('Webhook response exceeded 64KB'));
          }
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data.slice(0, MAX_RESPONSE_BYTES) }));
        res.on('error', reject);
      }
    );

    req.on('timeout', () => req.destroy(new Error(`Webhook delivery timed out after ${DELIVERY_TIMEOUT_MS}ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Webhook retry job handler.
 *
 * @param {Object} data - Job data
 * @param {string} data.webhookId - Webhook delivery ID
 * @param {string} data.url - Target URL
 * @param {Object} data.payload - JSON payload to deliver
 * @param {number} [data.attempt] - Current attempt number (informational)
 * @returns {Object} Delivery result recorded by the queue
 */
async function webhookRetryHandler(data) {
  const { webhookId, url, payload } = data;

  log.info({ webhookId, url }, 'Delivering webhook');

  const startedAt = Date.now();
  const result = await postJson(url, payload || {});
  const durationMs = Date.now() - startedAt;

  // Record the delivery against the registered webhook when known.
  try {
    await webhookRepository.logDelivery(webhookId, result.statusCode, result.body || null);
  } catch (err) {
    log.warn({ webhookId, error: err.message }, 'Could not record delivery log');
  }

  // Non-2xx is a failed delivery: throw so the queue retries with backoff.
  if (result.statusCode < 200 || result.statusCode >= 300) {
    const err = new Error(`Webhook delivery failed: ${url} responded ${result.statusCode}`);
    err.statusCode = result.statusCode;
    err.durationMs = durationMs;
    log.warn({ webhookId, url, statusCode: result.statusCode, durationMs }, 'Webhook delivery failed');
    throw err;
  }

  log.info({ webhookId, url, statusCode: result.statusCode, durationMs }, 'Webhook delivered');

  return {
    webhookId,
    url,
    attempt: data.attempt || 1,
    success: true,
    statusCode: result.statusCode,
    durationMs,
    deliveredAt: new Date().toISOString(),
  };
}

module.exports = webhookRetryHandler;
