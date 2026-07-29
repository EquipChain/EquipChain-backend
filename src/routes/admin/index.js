// src/routes/admin/index.js
const express = require('express');
const usersRouter = require('./users');
const configRouter = require('./config');
const devicesRouter = require('./devices');
const systemRouter = require('./system');

const router = express.Router();
router.use('/users', usersRouter);
router.use('/config', configRouter);
router.use('/devices', devicesRouter);
router.use('/system', systemRouter);

module.exports = router;