const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { buildOpenApiSpec } = require('../docs/openapi');

const router = express.Router();

// Build the spec lazily so it always reflects the current annotations.
router.get('/openapi.json', (req, res) => {
  res.json(buildOpenApiSpec());
});

// Serve Swagger UI at /api/docs, pointing it at the live /api/openapi.json
// endpoint instead of a spec snapshot captured at mount time. setup() used
// to embed buildOpenApiSpec() output statically: any endpoint registered
// AFTER the docs router mounted (system rate-limits, health, admin
// sub-routers added later in the pipeline) was missing from the UI even
// though /api/openapi.json served it correctly - the two views of the API
// drifted apart. With spec discovery, the UI fetches the same JSON the
// raw endpoint serves, so what you see in /api/openapi.json is exactly
// what /api/docs renders.
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    explorer: true,
    customSiteTitle: 'EquipChain API Docs',
    swaggerOptions: { url: '/api/openapi.json' },
  })
);

module.exports = router;
