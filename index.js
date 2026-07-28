const express = require('express');
const app = express();

app.use(express.json());

const contractId = process.env.CONTRACT_ID || 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS';

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Auth challenge - returns a mock JWT token
app.post('/api/auth/challenge', (req, res) => {
  const { wallet } = req.body || {};
  res.json({
    token: `mock-jwt-${wallet || 'anonymous'}-${Date.now()}`,
    expiresIn: 3600,
  });
});

// Protected route - requires Authorization header
app.get('/api/protected', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    data: 'Sensitive meter data',
    contract: contractId,
  });
});

app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: contractId,
  });
});

if (require.main === module) {
  app.listen(3000, () => console.log('Equipchain API running'));
}

module.exports = app;
