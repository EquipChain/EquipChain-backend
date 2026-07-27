const express = require('express');
const router = express.Router();
const { services } = require('../services');

// Import route modules here as they are created
// const authRoutes = require('./auth');
// const adminRoutes = require('./admin');
// const analyticsRoutes = require('./analytics');
const exportRoutes = require('./exports');

// Mount routes under their respective prefixes
// router.use('/api/auth', authRoutes);
// router.use('/api/admin', adminRoutes);
// router.use('/api/analytics', analyticsRoutes);
router.use('/api/exports', exportRoutes);

// Health check route
router.get('/health', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  // Add queue stats if queue service is available
  if (services.queue) {
    healthData.queue = services.queue.getStats();
  }

  // Add scheduler stats if scheduler service is available
  if (services.scheduler) {
    healthData.scheduler = {
      schedules: services.scheduler.getAllSchedules().length,
      isRunning: services.scheduler.isRunning,
    };
  }

  res.json(healthData);
});

module.exports = router;
