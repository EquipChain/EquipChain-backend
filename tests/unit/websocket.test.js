const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { WebSocketService } = require('../services/websocket');

describe('WebSocketService', () => {
  let server, wsService;
  
  beforeEach((t) => {
    server = http.createServer();
    wsService = new WebSocketService(server, { pingInterval: 60000 });
    t.after(() => {
      wsService.close();
      server.close();
    });
  });
  
  test('starts with zero connections', () => {
    const metrics = wsService.getMetrics();
    assert.strictEqual(metrics.activeConnections, 0);
    assert.strictEqual(metrics.activeChannels, 0);
  });
  
  test('broadcast returns 0 when no subscribers', () => {
    const sent = wsService.broadcast('test:channel', { msg: 'hello' });
    assert.strictEqual(sent, 0);
  });
  
  test('broadcast returns count of recipients', () => {
    wsService.channels.set('test:channel', new Set(['client1', 'client2', 'client3']));
    wsService.clients.set('client1', { ws: { readyState: 1, send: () => {} }, channels: new Set() });
    wsService.clients.set('client2', { ws: { readyState: 1, send: () => {} }, channels: new Set() });
    wsService.clients.set('client3', { ws: { readyState: 0, send: () => {} }, channels: new Set() });
    
    const sent = wsService.broadcast('test:channel', { msg: 'hello' });
    assert.strictEqual(sent, 2);
  });
});
