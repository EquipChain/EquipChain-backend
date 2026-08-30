const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

/**
 * Build the OpenAPI specification by scanning @openapi JSDoc annotations
 * across the source tree.
 * @returns {object} OpenAPI document
 */
function buildOpenApiSpec() {
  return swaggerJsdoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'EquipChain API',
        version: '1.0.0',
        description:
          'REST + WebSocket API for EquipChain — decentralized utility meter ' +
          'monitoring and data access. Query meter status, contract data, and ' +
          'project information, and subscribe to real-time meter reading updates.',
        contact: {
          name: 'EquipChain',
          url: 'https://github.com/EquipChain/EquipChain-backend',
        },
        license: { name: 'MIT' },
      },
      servers: [
        {
          url: `http://localhost:${process.env.PORT || 3000}`,
          description: 'Local development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    apis: [path.join(__dirname, '..', '**', '*.js').replace(/\\/g, '/')],
  });
}

module.exports = { buildOpenApiSpec };
