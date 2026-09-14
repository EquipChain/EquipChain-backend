// src/routes/admin/devices.js
const express = require('express');
const { deviceStore } = require('../../data/adminStore');
const { validate } = require('../../middleware/validate');
const {
  adminRegisterDeviceSchema,
  adminUpdateDeviceSchema,
  adminIdParamSchema,
} = require('../../schemas/validation.schema');
const { paginateList } = require('../../utils/pagination');

const router = express.Router();

const DEVICE_LIST_OPTIONS = {
  allowedFilters: ['type', 'status', 'location'],
  searchableFields: ['name', 'meterId', 'location'],
  sortableFields: ['meterId', 'name', 'type', 'status', 'createdAt'],
  defaultSort: { field: 'createdAt', order: 'desc' },
  dateField: 'createdAt',
};

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
router.post('/', validate(adminRegisterDeviceSchema), (req, res) => {
  // deviceId is the device's external identity: registering the same one
  // twice would silently fork its record and make every later update/delete
  // ambiguous. Enforce uniqueness with a 409 (conflict) rather than a 400 -
  // the request is well-formed, it just collides with existing state.
  const existing = deviceStore
    .list()
    .find((d) => d.deviceId === req.body.deviceId);
  if (existing) {
    return res.status(409).json({
      error: 'Device already exists',
      message: `A device with deviceId "${req.body.deviceId}" is already registered.`,
    });
  }
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
router.get('/', (req, res, next) => {
  try {
    res.json(paginateList(deviceStore.list(), req.query, DEVICE_LIST_OPTIONS));
  } catch (err) {
    next(err);
  }
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
router.patch('/:id', validate({ ...adminUpdateDeviceSchema, params: adminIdParamSchema.params }), (req, res) => {
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
router.delete('/:id', validate(adminIdParamSchema), (req, res) => {
  const removed = deviceStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Device not found' });
  res.json({ success: true });
});

module.exports = router;