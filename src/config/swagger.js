// src/config/swagger.js
//
// Builds the OpenAPI 3.1 specification from JSDoc/YAML annotations on
// route files, using swagger-jsdoc. Only annotate routes that actually
// exist in the codebase - this MVP currently only implements GET /, so
// that's the only path documented for now. As routes land from other
// issues (auth, admin, meters, etc.), annotate them in place and they'll
// be picked up automatically via the `apis` glob below.

const swaggerJsdoc = require('swagger-jsdoc');

const PORT = process.env.PORT || 3000;

const definition = {
  openapi: '3.1.0',
  info: {
    title: 'EquipChain API',
    version: '1.0.0',
    description:
      'Express API for Equipchain utility meter monitoring and data access, ' +
      'backed by Soroban smart contracts on Stellar.',
    contact: {
      name: 'EquipChain',
      url: 'https://github.com/EquipChain/EquipChain-backend',
    },
    license: {
      name: 'MIT',
      url: 'https://github.com/EquipChain/EquipChain-backend/blob/main/LICENSE',
    },
  },
  servers: [
    {
      url: `http://localhost:${PORT}`,
      description: 'Development',
    },
    {
      url: 'https://api.equipchain.example.com',
      description: 'Production (placeholder - update once a production URL exists)',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT bearer token issued by the (planned) auth endpoints.',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for external integrator access.',
      },
    },
  },
  tags: [
    { name: 'System', description: 'Health and project metadata endpoints' },
    { name: 'Auth', description: 'Authentication and session management (planned)' },
    { name: 'Admin', description: 'Administrative user and system management (planned)' },
    { name: 'Meters', description: 'Meter registration and readings (planned)' },
    { name: 'Webhooks', description: 'Webhook endpoint management (planned)' },
  ],
};

const options = {
  definition,
  // Glob relative to this file's cwd (project root, since npm scripts run
  // from there). Picks up annotations from index.js and any future route
  // files under src/routes/.
  apis: ['./index.js', './src/routes/*.js'],
  failOnErrors: true,
};

const openapiSpecification = swaggerJsdoc(options);

module.exports = openapiSpecification;