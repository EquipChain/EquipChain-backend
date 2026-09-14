const assert = require('node:assert');
const test = require('node:test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'websocket-test-secret';

const websocket = require('../src/services/websocket');

const SECRET = process.env.JWT_SECRET;

function sign(overrides = {}) {
  return jwt.sign({ sub: 'user-1', roles: ['user'], ...overrides }, SECRET, { expiresIn: '1h' });
}

function createMockIo() {
  const handlers = {};
  const middlewares = [];
  const rooms = new Set();
  const emitted = [];
  const toMock = {
    emit: (event, payload) => emitted.push({ event, payload }),
  };
  const io = {
    engine: { clientsCount: 0 },
    on: (event, fn) => {
      handlers[event] = fn;
    },
    use: (fn) => {
      middlewares.push(fn);
    },
    emit: (event, payload) => emitted.push({ event, payload }),
    to: () => toMock,
    _handlers: handlers,
    _middlewares: middlewares,
    _emitted: emitted,
    _rooms: rooms,
  };
  return io;
}

function createMockSocket(id, handshake) {
  const socketHandlers = {};
  const socketEmit = (event, payload) => emitted.push({ event, payload });
  const emitted = [];
  const socket = {
    id,
    data: {},
    handshake: handshake || { auth: {}, headers: {} },
    on: (event, fn) => {
      socketHandlers[event] = fn;
    },
    join: (room) => mockIo._rooms.add(room),
    emit: socketEmit,
    _handlers: socketHandlers,
    _emitted: emitted,
  };
  return socket;
}

function runHandshake(socket) {
  // The connection middleware is synchronous; invoke it and capture errors.
  let error = null;
  websocket.handshakeAuth(socket, (err) => {
    error = err;
  });
  return error;
}

let mockIo;

test('initWebSocket registers connection middleware and handler, returns io', () => {
  mockIo = createMockIo();
  const result = websocket.initWebSocket(mockIo);
  assert.strictEqual(result, mockIo);
  assert.strictEqual(typeof mockIo._handlers.connection, 'function');
  assert.ok(mockIo._middlewares.includes(websocket.handshakeAuth));
});

test('getConnectionCount returns 0 before io is initialized', () => {
  // Re-require to reset module state
  delete require.cache[require.resolve('../src/services/websocket')];
  const fresh = require('../src/services/websocket');
  assert.strictEqual(fresh.getConnectionCount(), 0);
});

test('handshakeAuth accepts a valid JWT from auth.token and attaches user', () => {
  const socket = createMockSocket('sock-a', { auth: { token: sign() }, headers: {} });
  const error = runHandshake(socket);
  assert.ifError(error);
  assert.strictEqual(socket.data.user.sub, 'user-1');
});

test('handshakeAuth accepts a valid JWT from the Authorization header', () => {
  const socket = createMockSocket('sock-b', {
    auth: {},
    headers: { authorization: `Bearer ${sign({ sub: 'hdr-user' })}` },
  });
  const error = runHandshake(socket);
  assert.ifError(error);
  assert.strictEqual(socket.data.user.sub, 'hdr-user');
});

test('handshakeAuth rejects a missing token', () => {
  const socket = createMockSocket('sock-c');
  const error = runHandshake(socket);
  assert.ok(error instanceof Error);
  assert.strictEqual(error.message, 'unauthorized');
});

test('handshakeAuth rejects a tampered token', () => {
  const socket = createMockSocket('sock-d', {
    auth: { token: sign() + 'x' },
    headers: {},
  });
  const error = runHandshake(socket);
  assert.ok(error instanceof Error);
  assert.strictEqual(error.message, 'unauthorized');
});

test('subscribe:meter joins the meter room', () => {
  mockIo = createMockIo();
  websocket.initWebSocket(mockIo);
  const socket = createMockSocket('sock-1');
  socket.data.user = { sub: 'user-1' };
  mockIo._handlers.connection(socket);
  socket._handlers['subscribe:meter']('meter-42');
  assert.ok(mockIo._rooms.has('meter:meter-42'));
  assert.strictEqual(socket.data.currentMeterId, 'meter-42');
});

test('subscribe:meter rejects empty and oversized ids with subscribe:error', () => {
  mockIo = createMockIo();
  websocket.initWebSocket(mockIo);
  const socket = createMockSocket('sock-2');
  socket.data.user = { sub: 'user-1' };
  mockIo._handlers.connection(socket);

  for (const bad of ['', '   ', 42, null, 'x'.repeat(websocket.MAX_METER_ID_LENGTH + 1)]) {
    socket._handlers['subscribe:meter'](bad);
  }
  const errors = socket._emitted.filter((e) => e.event === 'subscribe:error');
  assert.strictEqual(errors.length, 5);
  // Nothing joined for invalid input
  assert.strictEqual(mockIo._rooms.size, 0);
});

test('broadcastMeterReading emits to the meter room and all clients', () => {
  mockIo = createMockIo();
  websocket.initWebSocket(mockIo);
  const reading = { meterId: 'meter-7', value: 123, timestamp: '2026-08-21T00:00:00Z' };
  websocket.broadcastMeterReading(reading);
  const events = mockIo._emitted.map((e) => e.event);
  assert.ok(events.includes('meter:reading'));
});

test('broadcastMeterReading is a no-op when io is not initialized', () => {
  delete require.cache[require.resolve('../src/services/websocket')];
  const fresh = require('../src/services/websocket');
  // Should not throw
  fresh.broadcastMeterReading({ meterId: 'm1' });
  assert.ok(true);
});

test('broadcastMeterReadingsBatch emits one event per meter plus a fleet batch', () => {
  mockIo = createMockIo();
  websocket.initWebSocket(mockIo);
  const readings = [
    { meterId: 'a', value: 1 },
    { meterId: 'a', value: 2 },
    { meterId: 'b', value: 3 },
  ];
  websocket.broadcastMeterReadingsBatch(readings);
  const batchEvents = mockIo._emitted.filter((e) => e.event === 'meter:readings');
  // 2 per-meter rooms + 1 fleet-wide = 3 emissions for 3 readings
  assert.strictEqual(batchEvents.length, 3);
});
