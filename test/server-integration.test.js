const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');

describe('server integration', () => {
  let serverProcess;
  let serverPort = 3001; // Use different port to avoid conflicts

  before(async () => {
    // Start server in a separate process
    serverProcess = spawn('node', ['src/server.js'], {
      env: { ...process.env, PORT: serverPort.toString() },
      stdio: 'pipe',
    });

    // Wait for server to start
    await new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 10;
      
      const checkServer = () => {
        attempts++;
        const req = http.get(`http://localhost:${serverPort}/`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Server responded with status ${res.statusCode}`));
          }
        });

        req.on('error', (err) => {
          if (attempts < maxAttempts) {
            setTimeout(checkServer, 500);
          } else {
            reject(new Error('Server failed to start after multiple attempts'));
          }
        });
      };

      checkServer();
    });
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('server starts and responds to HTTP requests', async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.strictEqual(data.project, 'Equipchain');
    assert.strictEqual(data.status, 'Monitoring Meters');
  });

  it('server handles health check endpoint', async () => {
    const response = await fetch(`http://localhost:${serverPort}/health`);
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.timestamp);
  });

  it('server includes correlation ID in responses', async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    assert.ok(response.headers.get('x-correlation-id'));
  });

  it('server returns 404 for non-existent routes', async () => {
    const response = await fetch(`http://localhost:${serverPort}/non-existent`);
    assert.strictEqual(response.status, 404);
  });
});
