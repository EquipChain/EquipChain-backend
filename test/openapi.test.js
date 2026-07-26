const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const SwaggerParser = require('@apidevtools/swagger-parser');
const openapiSpecification = require('../src/config/swagger');
const app = require('../index');

const server = app.listen(0);
after(() => server.close());

describe('OpenAPI specification', () => {
  it('is a structurally valid OpenAPI document', async () => {
    // Validate a deep clone: SwaggerParser dereferences/mutates the object
    // it's given, and we don't want that to affect the shared spec module
    // used by the actual /api-docs route.
    const clone = JSON.parse(JSON.stringify(openapiSpecification));
    const api = await SwaggerParser.validate(clone);
    assert.strictEqual(api.info.title, 'EquipChain API');
    assert.ok(api.openapi.startsWith('3.'));
  });

  it('documents the root endpoint', () => {
    assert.ok(openapiSpecification.paths['/'], 'expected "/" to be documented');
    assert.ok(
      openapiSpecification.paths['/'].get,
      'expected a GET operation documented for "/"'
    );
  });

  it('every documented path and method exists in the running app', async () => {
    const port = server.address().port;
    const paths = Object.entries(openapiSpecification.paths || {});
    assert.ok(paths.length > 0, 'expected at least one documented path');

    for (const [path, methods] of paths) {
      for (const method of Object.keys(methods)) {
        const res = await fetch(`http://localhost:${port}${path}`, {
          method: method.toUpperCase(),
        });
        assert.notStrictEqual(
          res.status,
          404,
          `documented ${method.toUpperCase()} ${path} does not exist in the Express router`
        );
      }
    }
  });
});