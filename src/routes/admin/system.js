// src/routes/admin/system.js
const express = require('express');
const { userStore, deviceStore } = require('../../data/adminStore');
const { getConnectionCount } = require('../../services/websocket');

const router = express.Router();

/**
 * @openapi
 * /api/admin/system/health:
 *   get:
 *     summary: View system health
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: System health status }
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * @openapi
 * /api/admin/system/stats:
 *   get:
 *     summary: View resource / connection stats
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: System stats }
 */
router.get('/stats', (req, res) => {
  res.json({
    users: userStore.list().length,
    devices: deviceStore.list().length,
    memory: process.memoryUsage(),
  });
});

/**
 * @openapi
 * /api/admin/system/ws-connections:
 *   get:
 *     summary: View active WebSocket connections
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Active WebSocket connection info }
 */
router.get('/ws-connections', (req, res) => {
  res.json({ count: getConnectionCount(), note: 'WebSocket server active' });
});

module.exports = router;