const express = require('express');
const app = express();
const adminRouter = require('./src/routes/admin');
const { authenticate } = require('./src/middleware/auth');
const { requireAdmin } = require('./src/middleware/requireAdmin');
const contractId = process.env.CONTRACT_ID || 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS';

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: contractId,
  });
});

app.use('/api/admin', authenticate, requireAdmin, adminRouter);

if (require.main === module) {
  app.listen(3000, () => console.log('Equipchain API running'));
}
module.exports = app;