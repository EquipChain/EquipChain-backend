// src/routes/admin/index.js
const express = require('express');
const usersRouter = require('./users');
const configRouter = require('./config');
const devicesRouter = require('./devices');
const webhooksRouter = require('./webhooks');
const systemRouter = require('./system');
const { revokeToken } = require('../../middleware/auth');

const router = express.Router();
router.use('/users', usersRouter);
router.use('/config', configRouter);
router.use('/devices', devicesRouter);
router.use('/webhooks', webhooksRouter);
router.use('/system', systemRouter);

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