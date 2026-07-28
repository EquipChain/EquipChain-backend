/**
 * Admin Webhook Routes
 *
 * Provides CRUD operations for managing webhook endpoint registrations
 * and viewing webhook delivery logs.
 */

const express = require('express');
const { adminAuth } = require('../../middleware/auth');
const { webhookService } = require('../../services/webhook');
const { webhookRepository } = require('../../repositories');
const {
  createWebhookSchema,
  updateWebhookSchema,
  webhookQuerySchema,
} = require('../../schemas/webhook.schema');

const router = express.Router();

// Apply admin authentication to all webhook admin endpoints
router.use(adminAuth);

/**
 * POST /api/admin/webhooks
 * Register a new webhook.
 */
router.post('/', async (req, res) => {
  try {
    const parseResult = createWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const webhook = await webhookService.registerWebhook(parseResult.data);
    res.status(201).json(webhook);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/admin/webhooks
 * List registered webhooks with optional filtering and pagination.
 */
router.get('/', async (req, res) => {
  try {
    const parseResult = webhookQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const result = await webhookService.listWebhooks(parseResult.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/admin/webhooks/:id
 * Get a webhook registration by ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const webhook = await webhookService.getWebhook(req.params.id);
    if (!webhook) {
      return res.status(404).json({ error: 'Not Found', message: 'Webhook not found' });
    }
    res.json(webhook);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * PATCH /api/admin/webhooks/:id
 * Update an existing webhook registration.
 */
router.patch('/:id', async (req, res) => {
  try {
    const parseResult = updateWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const updated = await webhookService.updateWebhook(req.params.id, parseResult.data);
    if (!updated) {
      return res.status(404).json({ error: 'Not Found', message: 'Webhook not found' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * DELETE /api/admin/webhooks/:id
 * Unregister (delete) a webhook.
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await webhookService.unregisterWebhook(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: 'Webhook not found' });
    }
    res.json({ message: 'Webhook unregistered successfully', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/admin/webhooks/:id/logs
 * Get delivery logs for a specific webhook.
 */
router.get('/:id/logs', async (req, res) => {
  try {
    const webhook = await webhookService.getWebhook(req.params.id);
    if (!webhook) {
      return res.status(404).json({ error: 'Not Found', message: 'Webhook not found' });
    }

    const logs = await webhookRepository.getDeliveryLogs(req.params.id);
    res.json({ webhookId: req.params.id, logs });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
