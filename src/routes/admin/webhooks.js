// src/routes/admin/webhooks.js
//
// Admin CRUD for webhook endpoints. The delivery pipeline (queue job with
// SSRF guards, retries, bounded latency) has existed since the webhook
// hardening batch, but nothing could ever register a webhook: the
// repository seeded none, and no route exposed it, so the whole delivery
// machinery was dead code from the API surface. These routes close that
// loop - register, list (paginated/filterable), inspect delivery logs,
// update, delete.
//
// Authorization is inherited from the mount point: the admin router is
// mounted behind `authenticate` + `requireAdmin` in routes/index.js, so
// every route here requires an admin JWT without repeating the middleware.

const express = require('express');
const { webhookRepository } = require('../../repositories/WebhookRepository');
const { validate } = require('../../middleware/validate');
const {
  adminRegisterWebhookSchema,
  adminUpdateWebhookSchema,
  adminIdParamSchema,
} = require('../../schemas/validation.schema');

const router = express.Router();

// Upper bound on delivery-log rows returned per request: logs are append-
// only per webhook, so an unbounded read of a long-lived webhook could
// materialize a huge array in one response. Most recent first.
const MAX_DELIVERY_LOG_PAGE = 100;

/**
 * @openapi
 * /api/admin/webhooks:
 *   post:
 *     summary: Register a webhook endpoint
 *     description: |
 *       Registers a URL to receive the given event. Delivery happens through
 *       the job queue with SSRF guards (private/reserved targets refused),
 *       bounded redirects, and exponential-backoff retries. Deliveries are
 *       signed with HMAC-SHA256 when a secret is provided.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, event]
 *             properties:
 *               url: { type: string, format: uri }
 *               event: { type: string }
 *               description: { type: string }
 *               secret: { type: string, description: Optional HMAC signing secret (min 16 chars) }
 *     responses:
 *       201: { description: Registered webhook }
 *       400: { description: Validation failed }
 *       409: { description: A webhook with this URL and event already exists }
 */
router.post('/', validate(adminRegisterWebhookSchema), async (req, res, next) => {
  try {
    // Same (url, event) pair twice would double-deliver every occurrence of
    // that event to the subscriber - a 409 makes the collision explicit.
    const existing = await webhookRepository.findByUrl(req.body.url);
    if (existing && existing.event === req.body.event && existing.status !== 'inactive') {
      return res.status(409).json({
        error: 'Webhook already exists',
        message: `A webhook for "${req.body.event}" at ${req.body.url} is already registered.`,
      });
    }

    const created = await webhookRepository.create({
      url: req.body.url,
      event: req.body.event,
      description: req.body.description || null,
      secret: req.body.secret || null,
      status: 'active',
    });

    // The signing secret is returned exactly once, at creation, and never
    // again - list/read responses omit it. Retain-once semantics keep a
    // leaked list response from leaking every subscriber's signing key.
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/webhooks:
 *   get:
 *     summary: List registered webhooks
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: event
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *     responses:
 *       200: { description: Paginated list of webhooks (secrets omitted) }
 */
router.get('/', async (req, res, next) => {
  try {
    const result = await webhookRepository.findAll(req.query, {
      allowedFilters: ['event', 'status'],
      sortableFields: ['url', 'event', 'status', 'createdAt'],
    });
    // Never echo signing secrets in bulk responses.
    result.data = result.data.map(({ secret, ...webhook }) => webhook);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/webhooks/{id}:
 *   get:
 *     summary: Get webhook details
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Webhook details (secret omitted) }
 *       404: { description: Webhook not found }
 */
router.get('/:id', validate(adminIdParamSchema), async (req, res, next) => {
  try {
    const webhook = await webhookRepository.findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    const { secret, ...safe } = webhook;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/webhooks/{id}/deliveries:
 *   get:
 *     summary: Recent delivery attempts for a webhook
 *     description: Most recent delivery log entries first, capped at 100 per page.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Delivery log entries }
 *       404: { description: Webhook not found }
 */
router.get('/:id/deliveries', validate(adminIdParamSchema), async (req, res, next) => {
  try {
    const webhook = await webhookRepository.findById(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const logs = await webhookRepository.getDeliveryLogs(webhook.id);
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_DELIVERY_LOG_PAGE) : 20;

    res.json({
      data: logs.slice(-limit).reverse(),
      count: logs.length,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/webhooks/{id}:
 *   patch:
 *     summary: Update a webhook (event, description, or status)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated webhook }
 *       400: { description: Validation failed }
 *       404: { description: Webhook not found }
 */
router.patch('/:id', validate({ ...adminUpdateWebhookSchema, params: adminIdParamSchema.params }), async (req, res, next) => {
  try {
    const updated = await webhookRepository.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Webhook not found' });
    const { secret, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook and its delivery logs
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Webhook not found }
 */
router.delete('/:id', validate(adminIdParamSchema), async (req, res, next) => {
  try {
    const deleted = await webhookRepository.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
