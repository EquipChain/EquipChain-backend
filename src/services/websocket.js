'use strict';

// src/services/websocket.js
//
// Real-time gateway on socket.io.
//
// Security model:
//  - Every handshake is authenticated with a JWT (same secret/claims as the
//    HTTP API) supplied as the socket.io `auth.token` option or an
//    `Authorization: Bearer` header. Unauthenticated sockets are rejected
//    before any event handler can run - previously the gateway accepted
//    anonymous connections that could subscribe to any meter's live data.
//  - `subscribe:meter` input is validated: must be a non-empty string of at
//    most 128 characters. Room names are derived from it, so an unbounded
//    value would let a client create unbounded rooms (memory growth) or
//    forge malformed room names.
//
// Efficiency note: broadcasts are batched per meter room plus one fleet-wide
// event, so bulk ingest (e.g. the 6,480-reading dev seed) costs O(meters)
// packets instead of O(readings).

const jwt = require('jsonwebtoken');
const { childLogger } = require('../config/logger');
const config = require('../config');

const log = childLogger('websocket');

const MAX_METER_ID_LENGTH = 128;

let io;
const connections = new Map();

/** Extract a bearer token from handshake headers, if present. */
function bearerTokenFrom(headers) {
  const header = headers && headers.authorization;
  if (typeof header !== 'string') return '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' ? token || '' : '';
}

/**
 * socket.io connection middleware: verifies the handshake JWT and attaches
 * the decoded payload to socket.data.user. Call next(Error) to reject the
 * connection with reason 'unauthorized'.
 */
function handshakeAuth(socket, next) {
  const token =
    (socket.handshake && socket.handshake.auth && socket.handshake.auth.token) ||
    bearerTokenFrom(socket.handshake && socket.handshake.headers);

  if (!token) {
    return next(new Error('unauthorized'));
  }
  try {
    socket.data.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch {
    return next(new Error('unauthorized'));
  }
}

/**
 * Wire up WebSocket connection handling on an already-created socket.io Server.
 * @param {import('socket.io').Server} ioServer - The socket.io server instance
 * @returns {import('socket.io').Server}
 */
function initWebSocket(ioServer) {
  io = ioServer;
  io.use(handshakeAuth);

  io.on('connection', (socket) => {
    const connectionId = socket.id;
    connections.set(connectionId, { id: connectionId, socket, user: socket.data.user });
    log.debug({ connectionId, user: socket.data.user && socket.data.user.sub }, 'client connected');

    socket.on('subscribe:meter', (meterId) => {
      const id = typeof meterId === 'string' ? meterId.trim() : '';
      if (!id || id.length > MAX_METER_ID_LENGTH) {
        socket.emit('subscribe:error', {
          error: 'Invalid meter id: must be a non-empty string of at most 128 characters.',
        });
        return;
      }
      socket.data.currentMeterId = id;
      socket.join(`meter:${id}`);
    });

    socket.on('disconnect', () => {
      connections.delete(connectionId);
    });
  });

  return io;
}

function getConnectionCount() {
  return io ? io.engine.clientsCount : 0;
}

function getConnections() {
  return Array.from(connections.values());
}

/**
 * Broadcast a new meter reading to all subscribed clients.
 * @param {object} reading - The meter reading payload
 */
function broadcastMeterReading(reading) {
  if (!io) return;
  const { meterId } = reading || {};
  if (meterId) {
    io.to(`meter:${meterId}`).emit('meter:reading', reading);
  }
  io.emit('meter:reading', reading);
}

/**
 * Broadcast a batch of readings efficiently: one batch event per meter
 * room plus a single fleet-wide batch event. Clients subscribed to a meter
 * receive 'meter:readings' (array); everyone receives the fleet batch.
 *
 * @param {object[]} readings - Array of meter reading payloads
 */
function broadcastMeterReadingsBatch(readings) {
  if (!io || !Array.isArray(readings) || readings.length === 0) return;

  const byMeter = new Map();
  for (const reading of readings) {
    if (!reading || !reading.meterId) continue;
    if (!byMeter.has(reading.meterId)) {
      byMeter.set(reading.meterId, []);
    }
    byMeter.get(reading.meterId).push(reading);
  }

  for (const [meterId, meterReadings] of byMeter) {
    io.to(`meter:${meterId}`).emit('meter:readings', meterReadings);
  }
  io.emit('meter:readings', readings);
}

module.exports = {
  initWebSocket,
  handshakeAuth,
  getConnectionCount,
  getConnections,
  broadcastMeterReading,
  broadcastMeterReadingsBatch,
  MAX_METER_ID_LENGTH,
};
