const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.json({ 
    project: 'Equipchain', 
    status: 'Monitoring Meters', 
    contract: 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS' 
  });
});

app.listen(port, () => console.log('Equipchain API running'));
