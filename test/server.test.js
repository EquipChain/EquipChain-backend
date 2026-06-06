const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const app = require('../index');
const server = app.listen(0);

after(() => server.close());

it('responds with project info', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/`);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.project, 'Equipchain');
  assert.strictEqual(data.status, 'Monitoring Meters');
  assert.ok(data.contract);
});
