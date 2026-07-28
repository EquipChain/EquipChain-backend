/**
 * Webhook Validation Schemas
 */

const { z } = require('zod');
const { makeListQuerySchema } = require('./common.schema');
const { SUPPORTED_EVENTS } = require('../services/webhook');

const eventsSchema = z
  .union([
    z.array(z.string().min(1)),
    z.string().min(1),
  ])
  .transform((val) => (Array.isArray(val) ? val : [val]));

const createWebhookSchema = z.object({
  url: z.string().url('A valid URL is required (e.g., https://example.com/webhook)'),
  events: eventsSchema.default(['*']),
  secret: z.string().max(256).optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  description: z.string().max(500).optional(),
});

const updateWebhookSchema = z.object({
  url: z.string().url('A valid URL is required').optional(),
  events: eventsSchema.optional(),
  secret: z.string().max(256).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  description: z.string().max(500).optional(),
});

const webhookQuerySchema = makeListQuerySchema({
  sortableFields: ['url', 'event', 'status', 'createdAt', 'updatedAt'],
  filters: ['event', 'status'],
});

module.exports = {
  createWebhookSchema,
  updateWebhookSchema,
  webhookQuerySchema,
  SUPPORTED_EVENTS,
};
