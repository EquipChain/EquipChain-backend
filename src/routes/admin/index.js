// src/routes/admin/index.js
const express = require('express');
const usersRouter = require('./users');
const configRouter = require('./config');
const devicesRouter = require('./devices');
const webhooksRouter = require('./webhooks');
const systemRouter = require('./system');
const { revokeToken } = require('../../middleware/auth');
const { adminAuditLog } = require('../../data/adminStore');

const router = express.Router();
router.use('/users', usersRouter);
router.use('/config', configRouter);
router.use('/devices', devicesRouter);
router.use('/webhooks', webhooksRouter);
router.use('/system', systemRouter);

/**
 * GET /api/admin/audit
 *
 * The single ordered trail of every privileged admin mutation: user
 * create/role-change/deactivate, device register/update/delete, config
 * update/reset, webhook lifecycle. Previously config changes had their own
 * log while role grants - the actions that actually change who can access
 * what - left no record beyond ephemeral HTTP logs, so investigating a
 * compromised admin account meant guesswork.
 *
 * Most recent first; `action`/`admin` filters; capped at the store's
 * retention (oldest entries age out at MAX_AUDIT_ENTRIES).
 */
/**
 * @openapi
 * /api/admin/audit:
 *   get:
 *     summary: Admin action audit trail
 *     description: |
 *       Ordered record of privileged admin mutations (users, devices,
 *       config, webhooks), most recent first.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 100 }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: admin
 *         schema: { type: string }
 *     responses:
 *       200: { description: Audit entries, most recent first }
 */
router.get('/audit', (req, res, next) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    let entries = adminAuditLog();
    if (typeof req.query.action === 'string' && req.query.action) {
      entries = entries.filter((e) => e.action === req.query.action);
    }
    if (typeof req.query.admin === 'string' && req.query.admin) {
      entries = entries.filter((e) => e.admin === req.query.admin);
    }

    res.json({
      data: entries.slice(-limit).reverse(),
      count: entries.length,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/logout
 *
 * Revokes the caller's own token (jti) for its remaining TTL. The admin
 * surface is where credential compromise hurts most, so admin sessions get
 * an explicit server-side sign-out: "log out" that only deletes a client
 * cookie while the token keeps authenticating is not sign-out.
 */
router.post('/logout', async (req, res, next) => {
  try {
    if (req.user && req.user.jti) {
      await revokeToken(req.user.jti, req.user.exp);
    }
    res.json({ success: true, message: 'Token revoked.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;