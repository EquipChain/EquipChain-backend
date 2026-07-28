const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const app = require('../../index');
const { webhookService, generateSignature } = require('../../src/services/webhook');
const { webhookRepository } = require('../../src/repositories');
const { appEventEmitter } = require('../../src/services/eventEmitter');

describe('Webhook Integration Tests', () => {
  let expressServer;
  let expressPort;

  let receiverServer;
  let receiverPort;
  let receivedRequests = [];

  const AUTH_HEADER = { Authorization: 'Bearer mock-jwt-admin-token-123' };

  before(async () => {
    // Start Express application server
    expressServer = app.listen(0);
    expressPort = expressServer.address().port;

    // Start local Webhook Receiver HTTP server
    receiverServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
          rawBody: body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
      });
    });

    await new Promise((resolve) => {
      receiverServer.listen(0, () => {
        receiverPort = receiverServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (expressServer) expressServer.close();
    if (receiverServer) receiverServer.close();
  });

  beforeEach(async () => {
    await webhookRepository.clear();
    receivedRequests = [];
  });

  describe('Admin Webhooks REST API Endpoints', () => {
    it('requires Authorization header for admin endpoints', async () => {
      const res = await fetch(`http://localhost:${expressPort}/api/admin/webhooks`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'Unauthorized');
    });

    it('creates, lists, updates, and deletes webhooks via API', async () => {
      // 1. Register Webhook
      const createRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          url: `http://localhost:${receiverPort}/webhook-endpoint`,
          events: ['meter.reading.created', 'contract.state.changed'],
          secret: 'test-secret-key-456',
          description: 'Integration test webhook',
        }),
      });

      assert.strictEqual(createRes.status, 201);
      const created = await createRes.json();
      assert.ok(created.id);
      assert.strictEqual(created.url, `http://localhost:${receiverPort}/webhook-endpoint`);
      assert.strictEqual(created.status, 'active');

      // 2. List Webhooks
      const listRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks`, {
        headers: AUTH_HEADER,
      });

      assert.strictEqual(listRes.status, 200);
      const listData = await listRes.json();
      assert.strictEqual(listData.data.length, 1);
      assert.strictEqual(listData.data[0].id, created.id);

      // 3. Get Webhook by ID
      const getRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks/${created.id}`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(getRes.status, 200);
      const getObj = await getRes.json();
      assert.strictEqual(getObj.id, created.id);

      // 4. Update Webhook
      const patchRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          status: 'inactive',
          description: 'Updated description',
        }),
      });

      assert.strictEqual(patchRes.status, 200);
      const updated = await patchRes.json();
      assert.strictEqual(updated.status, 'inactive');
      assert.strictEqual(updated.description, 'Updated description');

      // 5. Delete Webhook
      const deleteRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks/${created.id}`, {
        method: 'DELETE',
        headers: AUTH_HEADER,
      });

      assert.strictEqual(deleteRes.status, 200);

      // Verify deletion
      const getAfterDelete = await fetch(`http://localhost:${expressPort}/api/admin/webhooks/${created.id}`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(getAfterDelete.status, 404);
    });
  });

  describe('Full Event Emitter to Receiver Delivery Flow', () => {
    it('dispatches application events to registered receiver and verifies HMAC signature', async () => {
      const secretKey = 'my-webhook-hmac-secret-789';

      // 1. Register Webhook via API
      const registerRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          url: `http://localhost:${receiverPort}/events-listener`,
          events: ['meter.reading.created'],
          secret: secretKey,
        }),
      });

      const registeredWebhook = await registerRes.json();

      // 2. Emit an application event
      const eventPayload = {
        meterId: 'METER-8888',
        readingValue: 789.01,
        timestamp: new Date().toISOString(),
      };

      await webhookService.dispatchEvent('meter.reading.created', eventPayload);

      // 3. Verify Receiver HTTP server got the request
      assert.strictEqual(receivedRequests.length, 1);
      const received = receivedRequests[0];

      assert.strictEqual(received.method, 'POST');
      assert.strictEqual(received.url, '/events-listener');
      assert.strictEqual(received.headers['content-type'], 'application/json');
      assert.strictEqual(received.headers['x-webhook-event'], 'meter.reading.created');

      // Verify HMAC-SHA256 signature header matches calculation on receiver side
      const signatureHeader = received.headers['x-webhook-signature'];
      assert.ok(signatureHeader);

      const computedSignature = generateSignature(secretKey, received.rawBody);
      assert.strictEqual(signatureHeader, computedSignature);

      // Verify JSON structure of payload
      assert.ok(received.body.id.startsWith('evt_'));
      assert.strictEqual(received.body.type, 'meter.reading.created');
      assert.strictEqual(received.body.webhookId, registeredWebhook.id);
      assert.deepStrictEqual(received.body.data, eventPayload);

      // 4. Verify Delivery Logs API
      const logsRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks/${registeredWebhook.id}/logs`, {
        headers: AUTH_HEADER,
      });

      assert.strictEqual(logsRes.status, 200);
      const logsData = await logsRes.json();
      assert.strictEqual(logsData.logs.length, 1);
      assert.strictEqual(logsData.logs[0].statusCode, 200);
      assert.strictEqual(logsData.logs[0].success, true);
    });

    it('deletes webhook and verifies no further events are dispatched to it', async () => {
      // 1. Register Webhook
      const registerRes = await fetch(`http://localhost:${expressPort}/api/admin/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({
          url: `http://localhost:${receiverPort}/delete-listener`,
          events: ['meter.reading.updated'],
        }),
      });

      const registered = await registerRes.json();

      // 2. Delete Webhook
      await fetch(`http://localhost:${expressPort}/api/admin/webhooks/${registered.id}`, {
        method: 'DELETE',
        headers: AUTH_HEADER,
      });

      // 3. Emit event
      await webhookService.dispatchEvent('meter.reading.updated', { meterId: 'METER-000' });

      // 4. Verify zero requests received
      assert.strictEqual(receivedRequests.length, 0);
    });
  });
});
