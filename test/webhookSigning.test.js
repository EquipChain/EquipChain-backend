'use strict';

// test/webhookSigning.test.js
//
// Tests for HMAC-SHA256 webhook delivery signatures and the inactive-webhook
// pause path. Signatures follow the "t=<ts>,v1=<hex>" scheme (Stripe-style):
// the unix-second timestamp is inside the signed material, so a captured
// delivery cannot be replayed later with a fresh timestamp - receivers
// checking both the HMAC and timestamp tolerance defeat replay.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('node:http');

const webhookRetryHandler = require('../src/jobs/webhookRetry.job');
const { signDelivery } = webhookRetryHandler;
const { webhookRepository } = require('../src/repositories/WebhookRepository');

describe('webhook delivery signing', () => {
  it('signDelivery produces a deterministic HMAC over "<ts>.<body>"', () => {
    const body = JSON.stringify({ event: 'meter.reading', value: 42 });
    const ts = 1789000000;
    const sig = signDelivery(body, 'a-very-secret-signing-material', ts);
    const expected = crypto
      .createHmac('sha256', 'a-very-secret-signing-material')
      .update(`${ts}.${body}`)
      .digest('hex');
    assert.strictEqual(sig, expected);
    assert.strictEqual(sig.length, 64); // sha256 hex
  });

  it('signDelivery differs when the timestamp or body changes (replay/tamper guard)', () => {
    const body = JSON.stringify({ value: 1 });
    const base = signDelivery(body, 'secret-material-0001', 1789000000);
    assert.notStrictEqual(base, signDelivery(body, 'secret-material-0001', 1789000001));
    assert.notStrictEqual(base, signDelivery(body + ' ', 'secret-material-0001', 1789000000));
    assert.notStrictEqual(base, signDelivery(body, 'secret-material-0002', 1789000000));
  });

  it('delivers a registered webhook WITH a valid x-equipchain-signature header', async () => {
    const secret = 'signing-material-aaaa-0123456789';
    const webhook = await webhookRepository.create({
      url: 'set-below',
      event: 'meter.reading',
      secret,
      status: 'active',
    });

    let received = null;
    const httpServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received = { headers: req.headers, raw };
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = httpServer.address().port;

    try {
      // Point the registered webhook at the local receiver.
      await webhookRepository.update(webhook.id, { url: `http://127.0.0.1:${port}/hook` });

      const result = await webhookRetryHandler({
        webhookId: webhook.id,
        url: `http://127.0.0.1:${port}/hook`,
        payload: { event: 'meter.reading', value: 42 },
        // Loopback transport: the SSRF guard rightly refuses private
        // targets, so tests inject a transport that can reach the local
        // receiver instead of weakening the guard.
        transport: http,
      });

      assert.strictEqual(result.success, true);
      assert.ok(received);

      const header = received.headers['x-equipchain-signature'];
      assert.ok(header, 'signature header present');
      const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
      assert.ok(m, `header shape matches t=..,v1=..: ${header}`);

      // Receiver-side verification, exactly as documented: HMAC over
      // "<t>.<rawBody>" with the shared secret must match v1.
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${m[1]}.${received.raw}`)
        .digest('hex');
      assert.strictEqual(m[2], expected);

      // Timestamp is fresh (within a minute) - the replay window receiver
      // would enforce.
      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(m[1]));
      assert.ok(age < 60, `signature timestamp fresh (age=${age}s)`);
    } finally {
      httpServer.close();
      await webhookRepository.delete(webhook.id);
    }
  });

  it('delivers an unregistered webhook UNSIGNED (ad-hoc deliveries still work)', async () => {
    let received = null;
    const httpServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received = { headers: req.headers, raw };
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = httpServer.address().port;

    try {
      const result = await webhookRetryHandler({
        webhookId: 'webhook_adhoc_unknown',
        url: `http://127.0.0.1:${port}/hook`,
        payload: { hello: 'world' },
        transport: http,
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(received.headers['x-equipchain-signature'], undefined);
    } finally {
      httpServer.close();
    }
  });

  it('skips delivery to an inactive webhook without contacting the target', async () => {
    const webhook = await webhookRepository.create({
      url: 'http://127.0.0.1:1/never-called',
      event: 'meter.reading',
      status: 'inactive',
    });

    try {
      const result = await webhookRetryHandler({
        webhookId: webhook.id,
        url: webhook.url,
        payload: { event: 'meter.reading' },
      });
      assert.deepStrictEqual(result, {
        webhookId: webhook.id,
        url: webhook.url,
        skipped: true,
        reason: 'webhook-inactive',
        skippedAt: result.skippedAt,
      });
      assert.ok(result.skippedAt);
    } finally {
      await webhookRepository.delete(webhook.id);
    }
  });
});
