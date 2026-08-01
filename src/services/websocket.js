const { WebSocketServer } = require('ws');
const { childLogger } = require('../config/logger');

const log = childLogger('websocket');

class WebSocketService {
  constructor(server, options = {}) {
    this.channels = new Map();
    this.clients = new Map();
    this.pingInterval = options.pingInterval || 30000;
    this.wss = new WebSocketServer({ server, path: '/ws' });
    
    this.wss.on('connection', (ws, req) => {
      const clientId = req.headers['x-correlation-id'] || Date.now().toString(36) + Math.random().toString(36).slice(2);
      this.clients.set(clientId, { ws, channels: new Set() });
      ws.clientId = clientId;
      ws.isAlive = true;
      
      ws.on('pong', () => { ws.isAlive = true; });
      
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(clientId, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(clientId);
        this.channels.forEach((subscribers, channel) => {
          subscribers.delete(clientId);
        });
        log.info({ clientId, activeClients: this.clients.size }, 'Client disconnected');
      });
      
      ws.on('error', (err) => {
        log.error({ clientId, err: err.message }, 'WebSocket error');
        this.clients.delete(clientId);
      });
      
      ws.send(JSON.stringify({ type: 'connected', clientId }));
      log.info({ clientId, activeClients: this.clients.size }, 'Client connected');
    });
    
    this.heartbeat = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          ws.terminate();
          if (ws.clientId) this.clients.delete(ws.clientId);
          return;
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, this.pingInterval);
    
    log.info({ pingInterval: this.pingInterval }, 'WebSocket service started');
  }
  
  handleMessage(clientId, msg) {
    if (!msg.type || !msg.channel) {
      return;
    }
    
    const client = this.clients.get(clientId);
    if (!client) return;
    
    switch (msg.type) {
      case 'subscribe':
        if (!this.channels.has(msg.channel)) {
          this.channels.set(msg.channel, new Set());
        }
        this.channels.get(msg.channel).add(clientId);
        client.channels.add(msg.channel);
        client.ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
        log.debug({ clientId, channel: msg.channel }, 'Subscribed');
        break;
      
      case 'unsubscribe':
        if (this.channels.has(msg.channel)) {
          this.channels.get(msg.channel).delete(clientId);
          if (this.channels.get(msg.channel).size === 0) {
            this.channels.delete(msg.channel);
          }
        }
        client.channels.delete(msg.channel);
        client.ws.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel }));
        log.debug({ clientId, channel: msg.channel }, 'Unsubscribed');
        break;
    }
  }
  
  broadcast(channel, data) {
    const subscribers = this.channels.get(channel);
    if (!subscribers || subscribers.size === 0) return 0;
    
    const message = JSON.stringify({ type: 'broadcast', channel, data, timestamp: Date.now() });
    let sent = 0;
    
    subscribers.forEach((clientId) => {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === 1) {
        client.ws.send(message);
        sent++;
      }
    });
    
    return sent;
  }
  
  getMetrics() {
    return {
      activeConnections: this.clients.size,
      activeChannels: this.channels.size,
      channelDistribution: Object.fromEntries(
        Array.from(this.channels.entries()).map(([ch, subs]) => [ch, subs.size])
      )
    };
  }
  
  close() {
    clearInterval(this.heartbeat);
    this.wss.close();
    this.clients.clear();
    this.channels.clear();
    log.info('WebSocket service closed');
  }
}

module.exports = { WebSocketService };
