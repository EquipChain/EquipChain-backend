const express = require('express');
const app = express();

const contractId = process.env.CONTRACT_ID || 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS';

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
