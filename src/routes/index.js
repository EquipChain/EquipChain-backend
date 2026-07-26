const express = require('express');
const router = express.Router();

// Import route modules here as they are created
// const authRoutes = require('./auth');
// const adminRoutes = require('./admin');
// const analyticsRoutes = require('./analytics');

// Mount routes under their respective prefixes
// router.use('/api/auth', authRoutes);
// router.use('/api/admin', adminRoutes);
// router.use('/api/analytics', analyticsRoutes);

// Health check route
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
