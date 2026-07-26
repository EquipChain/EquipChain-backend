// src/routes/admin/devices.js
const express = require('express');
const { deviceStore } = require('../../data/adminStore');
const { validate } = require('../../middleware/validate');
const { registerDeviceSchema, updateDeviceSchema } = require('../../schemas/admin.schema');
const { paginate } = require('../../lib/pagination');

const router = express.Router();

/**
 * @openapi
 * /api/admin/devices:
 *   post:
 *     summary: Register a new device
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceId, name]
 *             properties:
 *               deviceId: { type: string }
 *               name: { type: string }
 *               location: { type: string }
 *     responses:
 *       201: { description: Registered device }
 *       400: { description: Validation failed }
 */
router.post('/', validate(registerDeviceSchema), (req, res) => {
  res.status(201).json(deviceStore.create(req.body));
});

/**
 * @openapi
 * /api/admin/devices:
 *   get:
 *     summary: List devices
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated list of devices }
 */
router.get('/', (req, res) => {
  res.json(paginate(deviceStore.list(), req));
});

/**
 * @openapi
 * /api/admin/devices/{id}:
 *   patch:
 *     summary: Update device metadata
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated device }
 *       400: { description: Validation failed }
 *       404: { description: Device not found }
 */
router.patch('/:id', validate(updateDeviceSchema), (req, res) => {
  const device = deviceStore.update(req.params.id, req.body);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json(device);
});

/**
 * @openapi
 * /api/admin/devices/{id}:
 *   delete:
 *     summary: Remove a device
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device removed }
 *       404: { description: Device not found }
 */
router.delete('/:id', (req, res) => {
  const removed = deviceStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Device not found' });
  res.json({ success: true });
});

module.exports = router;