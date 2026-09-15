const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const app = require('../src/app');
const server = app.listen(0);

after(() => server.close());

it('GET / responds with project info', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/`);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.project, 'Equipchain');
  assert.strictEqual(data.status, 'Monitoring Meters');
  assert.ok(data.contract);
});

it('GET /health returns ok status', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/health`);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.status, 'ok');
  assert.ok(data.timestamp);
});

it('GET /non-existent returns 404 with JSON', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/non-existent`);
  assert.strictEqual(res.status, 404);

  const data = await res.json();
  assert.strictEqual(data.error, 'Not Found');
});

// Boot contract: index.js (the Docker CMD and `npm start`) destructures
// startServer, installProcessHandlers, and gracefulShutdown from this module.
// A duplicate module.exports later in the file silently overwrote the first
// and dropped installProcessHandlers, so every production container crashed
// at boot with "installProcessHandlers is not a function" while tests - which
// spawn src/server.js directly - stayed green. Asserting the export surface
// here pins the contract regardless of how many module.exports statements
// exist in the file (the last one wins).
it('src/server exports the full boot contract used by index.js', () => {
  const serverModule = require('../src/server');
  assert.strictEqual(typeof serverModule.startServer, 'function');
  assert.strictEqual(typeof serverModule.installProcessHandlers, 'function');
  assert.strictEqual(typeof serverModule.gracefulShutdown, 'function');
});
