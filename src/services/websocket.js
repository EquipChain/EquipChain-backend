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

module.exports = { initWebSocket, getConnectionCount, getConnections, broadcastMeterReading };