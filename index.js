const express = require('express');
const app = express();
const docsRoutes = require('./src/routes/docs');
const contractId = process.env.CONTRACT_ID || 'CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS';

/**
 * @openapi
 * /:
 *   get:
 *     summary: Get project metadata
 *     description: Returns basic project status and the configured Soroban contract ID.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Project metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project:
 *                   type: string
 *                   example: Equipchain
 *                 status:
 *                   type: string
 *                   example: Monitoring Meters
 *                 contract:
 *                   type: string
 *                   example: CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS
 */
app.get('/', (req, res) => {
  res.json({
    project: 'Equipchain',
    status: 'Monitoring Meters',
    contract: contractId,
  });
});

app.use(docsRoutes);

if (require.main === module) {
  app.listen(3000, () => console.log('Equipchain API running'));
}
module.exports = app;