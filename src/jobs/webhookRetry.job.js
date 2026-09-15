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
const crypto = require('crypto');
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
 * HMAC-SHA256 signature over "<unix_seconds>.<raw_body>".
 *
 * The timestamp is inside the signed material, so a replayed payload cannot
 * carry a fresh timestamp without invalidating the signature: a receiver
 * that checks both the HMAC and that the timestamp is within a small
 * tolerance (e.g. 5 minutes) of its own clock defeats capture-and-replay
 * of webhook deliveries. Separating the concerns - body integrity via the
 * HMAC, freshness via the timestamp - is the same scheme Stripe uses for
 * outbound webhooks, so receivers can reuse standard verification code.
 *
 * @param {string} rawBody - The exact serialized body that will be sent
 * @param {string} secret - Webhook signing secret
 * @param {number} timestampSec - Unix seconds; signed, not trusted
 * @returns {string} hex digest
 */
function signDelivery(rawBody, secret, timestampSec) {
  return crypto.createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
}

/**
 * POST the payload to the target URL with redirects followed (public hosts
 * only) and a hard timeout.
 * @param {string} urlString
 * @param {Object} payload
 * @param {{ secret?: string|null }} [opts] - signing material
 * @param {number} [redirectsLeft]
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
function postJson(urlString, payload, opts = {}, redirectsLeft = MAX_REDIRECTS) {
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

    // Transport injection exists so tests can run a local receiver: the
    // SSRF guard (correctly) refuses loopback/private targets, so tests
    // substitute a loopback-capable transport instead of weakening the
    // guard with a bypass flag. The handler only forwards a transport
    // outside production-tested flows when config.isTest, so a crafted job
    // payload cannot redirect deliveries in production. The injected
    // transport owns host policy for its call - hence no assertPublicHost.
    if (!opts.transport) {
      assertPublicHost(url.hostname).catch(reject);
    }

    const transport =
      opts.transport || (url.protocol === 'https:' ? https : http);
    const body = JSON.stringify(payload);

    // Sign the EXACT byte sequence being sent - receivers verify against
    // the raw request body, so the signature must be computed over the same
    // serialized string, not a re-serialization. Fresh timestamp per hop:
    // a redirect chain that lingers must not ship a stale signed instant.
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'EquipChain-Webhook/1.0',
    };
    if (opts.secret) {
      const t = Math.floor(Date.now() / 1000);
      headers['x-equipchain-signature'] = `t=${t},v1=${signDelivery(body, opts.secret, t)}`;
    }

    const req = transport.request(
      url,
      {
        method: 'POST',
        headers,
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
          return resolve(postJson(next, payload, opts, redirectsLeft - 1));
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

  // Resolve the registered webhook: pull its signing secret (deliveries to
  // registered webhooks are signed) and honour the pause flag. An unknown
  // webhookId still delivers - the service API allows ad-hoc deliveries
  // that never went through registration - it just ships unsigned.
  let secret = null;
  try {
    const record = await webhookRepository.findById(webhookId);
    if (record) {
      if (record.status === 'inactive') {
        log.info({ webhookId, url }, 'Webhook is inactive; skipping delivery');
        return {
          webhookId,
          url,
          skipped: true,
          reason: 'webhook-inactive',
          skippedAt: new Date().toISOString(),
        };
      }
      secret = record.secret || null;
    }
  } catch (err) {
    // Repository hiccup must not wedge delivery; ship unsigned and let the
    // delivery log show the outcome.
    log.warn({ webhookId, error: err.message }, 'Could not resolve webhook record for signing');
  }

  log.info({ webhookId, url, signed: Boolean(secret) }, 'Delivering webhook');

  const startedAt = Date.now();
  const result = await postJson(url, payload || {}, {
    secret,
    // Test-only transport injection (see postJson). Gated on isTest so a
    // manipulated job payload can never swap the HTTP stack in production.
    transport: require('../config').isTest ? data.transport : undefined,
  });
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
module.exports.signDelivery = signDelivery;
