'use strict';

// scripts/openapi-paths.js
// Dev utility: prints every path documented in the generated OpenAPI spec.
// Usage: node scripts/openapi-paths.js

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { buildOpenApiSpec } = require('../src/docs/openapi');

const spec = buildOpenApiSpec();
const paths = Object.keys(spec.paths || {}).sort();

console.log(`documented paths: ${paths.length}`);
for (const p of paths) {
  const methods = Object.keys(spec.paths[p])
    .filter((m) => m !== 'parameters')
    .map((m) => m.toUpperCase())
    .join(', ');
  console.log(`  ${methods.padEnd(20)} ${p}`);
}
