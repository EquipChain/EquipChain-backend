let io;
const connections = new Map();

/**
 * Wire up WebSocket connection handling on an already-created socket.io Server.
 * @param {import('socket.io').Server} ioServer - The socket.io server instance
 * @returns {import('socket.io').Server}
 */
function initWebSocket(ioServer) {
  io = ioServer;

  io.on('connection', (socket) => {
    const connectionId = socket.id;
    connections.set(connectionId, { id: connectionId, socket });

    socket.on('subscribe:meter', (meterId) => {
      socket.data.currentMeterId = meterId;
      socket.join(`meter:${meterId}`);
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
 * Why: addReadings() is called with large arrays (the dev seed emits 6,480
 * readings at boot; production ingest is batched). Emitting per reading
 * produced one socket.io packet per item - thousands of broadcasts where
 * one will do - pinning CPU and flooding subscribers at startup.
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

module.exports = { initWebSocket, getConnectionCount, getConnections, broadcastMeterReading, broadcastMeterReadingsBatch };