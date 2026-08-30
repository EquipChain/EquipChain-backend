const assert = require('node:assert');
const test = require('node:test');
const websocket = require('../src/services/websocket');

function createMockIo() {
  const handlers = {};
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
    emit: (event, payload) => emitted.push({ event, payload }),
    to: () => toMock,
    _handlers: handlers,
    _emitted: emitted,
    _rooms: rooms,
  };
  return io;
}

function createMockSocket(id, meterId) {
  const socketHandlers = {};
  const socket = {
    id,
    data: { currentMeterId: meterId },
    on: (event, fn) => {
      socketHandlers[event] = fn;
    },
    join: (room) => mockIo._rooms.add(room),
    _handlers: socketHandlers,
  };
  return socket;
}

let mockIo;

test('initWebSocket registers a connection handler and returns io', () => {
  mockIo = createMockIo();
  const result = websocket.initWebSocket(mockIo);
  assert.strictEqual(result, mockIo);
  assert.strictEqual(typeof mockIo._handlers.connection, 'function');
});

test('getConnectionCount returns 0 before io is initialized', () => {
  // Re-require to reset module state
  delete require.cache[require.resolve('../src/services/websocket')];
  const fresh = require('../src/services/websocket');
  assert.strictEqual(fresh.getConnectionCount(), 0);
});

test('subscribe:meter joins the meter room', () => {
  mockIo = createMockIo();
  websocket.initWebSocket(mockIo);
  const socket = createMockSocket('sock-1');
  mockIo._handlers.connection(socket);
  socket._handlers['subscribe:meter']('meter-42');
  assert.ok(mockIo._rooms.has('meter:meter-42'));
  assert.strictEqual(socket.data.currentMeterId, 'meter-42');
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
