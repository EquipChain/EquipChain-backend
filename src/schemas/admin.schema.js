// src/schemas/admin.schema.js
//
// Zod validation schemas for the admin API (issue #11). Issue #8's
// broader Zod validation work has not landed separately, so these
// schemas live here, scoped to what the admin routes need.

const { z } = require('zod');

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  roles: z.array(z.enum(['admin', 'user'])).default(['user']),
});

const updateUserRolesSchema = z.object({
  roles: z.array(z.enum(['admin', 'user'])).min(1),
});

const configUpdateSchema = z.object({
  values: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .refine((v) => Object.keys(v).length > 0, {
      message: 'At least one configuration value must be provided.',
    }),
});

const registerDeviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  location: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const updateDeviceSchema = z
  .object({
    name: z.string().min(1).optional(),
    location: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided.',
  });

module.exports = {
  createUserSchema,
  updateUserRolesSchema,
  configUpdateSchema,
  registerDeviceSchema,
  updateDeviceSchema,
};