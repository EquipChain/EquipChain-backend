// src/routes/admin/config.js
const express = require('express');
const { configStore } = require('../../data/adminStore');
const { validate } = require('../../middleware/validate');
const { configUpdateSchema } = require('../../schemas/admin.schema');

const router = express.Router();

const adminIdOf = (req) => req.user?.sub || req.user?.id || 'unknown';

/**
 * @openapi
 * /api/admin/config:
 *   get:
 *     summary: Get protocol configuration
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Current configuration }
 */
router.get('/', (req, res) => {
  res.json(configStore.get());
});

/**
 * @openapi
 * /api/admin/config:
 *   patch:
 *     summary: Update configuration values
 *     description: Changes are logged with the admin identity and timestamp for audit purposes.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [values]
 *             properties:
 *               values: { type: object }
 *     responses:
 *       200: { description: Updated configuration }
 *       400: { description: Validation failed }
 */
router.patch('/', validate(configUpdateSchema), (req, res) => {
  res.json(configStore.update(req.body.values, adminIdOf(req)));
});

/**
 * @openapi
 * /api/admin/config/reset:
 *   post:
 *     summary: Reset configuration to defaults
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Configuration reset to defaults }
 */
router.post('/reset', (req, res) => {
  res.json(configStore.reset(adminIdOf(req)));
});

module.exports = router;