// src/routes/docs.js
//
// Mounts Swagger UI at /api-docs and the raw OpenAPI spec at
// /api-docs.json.
//
// This codebase does not yet have a JWT-based auth system (that's
// tracked in separate issues), so in production this uses a simple
// HTTP Basic Auth gate on DOCS_USERNAME/DOCS_PASSWORD as a stopgap.
// If those aren't configured in production, docs are denied entirely
// (fail closed) rather than served unprotected. Swap this for real
// session/JWT auth once that system exists.

const express = require('express');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');
const openapiSpecification = require('../config/swagger');

const router = express.Router();

const timingSafeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const requireDocsAuth = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const expectedUser = process.env.DOCS_USERNAME;
  const expectedPass = process.env.DOCS_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return res.status(503).json({
      error:
        'API documentation is not available: DOCS_USERNAME/DOCS_PASSWORD are not configured.',
    });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="EquipChain API Docs"');
    return res.status(401).json({ error: 'Authentication required to view API documentation.' });
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const user = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex);
  const pass = separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1);

  if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass)) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="EquipChain API Docs"');
  return res.status(401).json({ error: 'Invalid credentials.' });
};

router.get('/api-docs.json', requireDocsAuth, (req, res) => {
  res.json(openapiSpecification);
});

router.use('/api-docs', requireDocsAuth, swaggerUi.serve, swaggerUi.setup(openapiSpecification));

module.exports = router;