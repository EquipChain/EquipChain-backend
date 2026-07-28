# Equipchain Backend API

Express API for Equipchain utility meter monitoring and data access.

## Overview

Provides a REST endpoint for querying Equipchain smart contract data including meter status, contract ID, and project information.

## Getting Started

```bash
npm install
npm start
```

The server runs on `http://localhost:3000`.

## Endpoints

### `GET /`

Returns project metadata:

```json
{
  "project": "Equipchain",
  "status": "Monitoring Meters",
  "contract": "CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS"
}
```

### `GET /api/health`

Health check endpoint, returns server uptime and status:

```json
{
  "status": "healthy",
  "uptime": 123.45,
  "timestamp": 1700000000000
}
```

### `POST /api/auth/challenge`

Simulates a wallet-based auth challenge and returns a mock JWT token.

**Request body:**

```json
{
  "wallet": "GANONEXISTENT123..."
}
```

**Response:**

```json
{
  "token": "mock-jwt-GANONEXISTENT123...-1700000000000",
  "expiresIn": 3600
}
```

### `GET /api/protected`

Protected endpoint requiring a valid `Authorization: Bearer <token>` header. Returns sensitive meter data.

## Load Testing with k6

Performance testing is implemented using [Grafana k6](https://k6.io), an open-source load testing tool.

### Installation

Install k6 by following the [official installation guide](https://k6.io/docs/get-started/installation/):

```bash
# macOS
brew install k6

# Ubuntu/Debian
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows (winget)
winget install k6
```

Verify installation:

```bash
k6 version
```

### Test Scenarios

All test scripts are located in the `k6/` directory and are parameterizable via environment variables.

| Test | File | Description | Command |
|------|------|-------------|---------|
| **Smoke** | `k6/smoke.js` | 1 VU performing all API operations for 30s. Verifies basic functionality under no load. | `npm run k6:smoke` |
| **Load** | `k6/load.js` | Ramp up to 50 VUs over 1 min, sustain for 3 min, ramp down over 1 min. 80% reads, 20% writes. | `npm run k6:load` |
| **Stress** | `k6/stress.js` | Gradual increase from 10 → 50 → 100 → 200 → 500 VUs to identify the breaking point. | `npm run k6:stress` |
| **Spike** | `k6/spike.js` | Sudden jump from 0 to 200 VUs in 10s, sustain for 1 min, then cool down. | `npm run k6:spike` |
| **Soak** | `k6/soak.js` | 50 VUs sustained for 30+ minutes to detect memory leaks and performance degradation. | `npm run k6:soak` |
| **Quick** | (all except soak) | Runs smoke, load, stress, and spike tests sequentially. | `npm run k6:quick` |

### Configuration

Override the base URL and other parameters via environment variables:

```bash
# Point to a different environment
k6 run k6/smoke.js -e BASE_URL=https://staging.example.com

# Override soak test duration and concurrency
k6 run k6/soak.js -e DURATION=60m -e VUS=100
```

### Metrics Collected

Each test measures and reports:

| Metric | Description |
|--------|-------------|
| **Request Rate (RPS)** | Number of requests per second |
| **Response Time Percentiles** | p50, p75, p90, p95, p99 — median and tail latency |
| **Error Rate** | Percentage of failed/non-2xx requests |
| **Checks** | Application-level assertions (e.g., status is 200, body has required fields) |

### Generating HTML Reports

Generate visual HTML reports for detailed analysis:

```bash
k6 run --out html=k6/results/load-report.html k6/load.js
```

### CI Integration

The standard CI workflow (`.github/workflows/ci.yml`) runs unit tests only (`npm test`). For load testing in CI, add a separate workflow step that installs k6 and runs the smoke test as a quick health check:

```yaml
- name: Install k6
  run: |
    curl -fsSL https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-linux-amd64.tar.gz | tar -xz
    sudo cp k6-v0.54.0-linux-amd64/k6 /usr/local/bin/

- name: Run k6 smoke test
  run: k6 run k6/smoke.js
  env:
    BASE_URL: ${{ secrets.BASE_URL }}
```

### Results

Test results (HTML reports, JSON summaries) are stored in `k6/results/`. This directory is gitignored and will not be committed to the repository.

## Related

- [Equipchain Contracts](https://github.com/EquipChain/EquipChain-contracts)
- [Equipchain Frontend](https://github.com/EquipChain/EquipChain-frontend)
