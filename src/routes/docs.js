const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { buildOpenApiSpec } = require('../docs/openapi');

const router = express.Router();

// Build the spec lazily so it always reflects the current annotations.
router.get('/openapi.json', (req, res) => {
  res.json(buildOpenApiSpec());
});

// Serve Swagger UI at /api/docs
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(buildOpenApiSpec(), {
    explorer: true,
    customSiteTitle: 'EquipChain API Docs',
  })
);

module.exports = router;
