# EquipChain Backend

<p align="center">
  <a href="https://github.com/EquipChain/EquipChain-backend/actions"><img src="https://github.com/EquipChain/EquipChain-backend/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-20%2B-brightgreen" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/express-5-blue" alt="Express 5">
</p>

Express 5 REST API for EquipChain — a decentralized utility meter monitoring and data access platform powered by Soroban smart contracts on Stellar.

## Table of Contents

- [Project Overview](#project-overview)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Architecture Overview](#architecture-overview)
- [Configuration Reference](#configuration-reference)
- [Development Guide](#development-guide)
- [Load Testing with k6](#load-testing-with-k6)
- [Deployment Guide](#deployment-guide)
- [Contributing](#contributing)
- [Related](#related)
- [License](#license)

## Project Overview

EquipChain is a blockchain-powered platform for monitoring, managing, and analyzing utility meter data. This backend service provides:

- **REST API** — Query meter status, contract data, and project information via a clean JSON API.
- **Soroban Integration** — Reads on-chain data from Stellar Soroban smart contracts for transparent, immutable meter records.
- **Real-time Capabilities** — Built on Express 5 with WebSocket support for live meter updates.
- **Redis Caching** — High-performance data caching for frequently accessed meter readings.
- **Docker Support** — Containerized deployment for consistent environments.

### Tech Stack

| Technology | Purpose |
|-----------|---------|
| **Express 5** | HTTP framework |
| **Node.js 20+** | Runtime |
| **Soroban (Stellar)** | Smart contract integration |
| **Redis** | Caching layer |
| **WebSockets** | Real-time meter data |
| **Docker** | Containerization |

### Project Status

**Current Phase:** MVP — Core meter monitoring endpoints are operational. The API serves project metadata and on-chain contract data. Future releases will add full CRUD for meters, analytics aggregation, WebSocket event streaming, and admin management.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- [npm](https://www.npmjs.com/) (ships with Node.js)
- [Docker](https://www.docker.com/) (optional — for containerized development)

### 1. Clone the Repository

```bash
git clone https://github.com/EquipChain/EquipChain-backend.git
cd EquipChain-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Server listen port |
| `CONTRACT_ID` | `CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS` | No | Stellar Soroban contract ID |
| `REDIS_URL` | — | No | Redis connection string for caching |
| `WS_ENABLED` | `false` | No | Enable WebSocket support |
| `NODE_ENV` | `development` | No | Environment mode |
| `LOG_LEVEL` | `info` | No | Logging verbosity |

### 4. Start the Development Server

```bash
npm start
```

The server starts at `http://localhost:3000`.

```bash
curl http://localhost:3000
# {"project":"Equipchain","status":"Monitoring Meters","contract":"CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS"}
```

---

## API Reference

All endpoints return JSON. Base URL: `http://localhost:3000` (development) or your deployed URL.

### System

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/` | Project metadata (name, status, contract ID) | No |
| `GET` | `/api/health` | Health check (uptime, status, timestamp) | No |

### Auth

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/api/auth/challenge` | Mock wallet-based auth challenge (returns JWT) | No |
| `GET` | `/api/protected` | Protected route requiring Bearer token | Yes |
| `POST` | `/auth/login` | Authenticate and receive a JWT | No |
| `POST` | `/auth/register` | Create a new user account | No |
| `POST` | `/auth/refresh` | Refresh an expired token | Yes |
| `POST` | `/auth/logout` | Invalidate current session | Yes |

### Admin

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/admin/users` | List all users | Admin |
| `GET` | `/admin/users/:id` | Get user details | Admin |
| `PUT` | `/admin/users/:id` | Update user role/status | Admin |
| `DELETE` | `/admin/users/:id` | Remove a user | Admin |
| `GET` | `/admin/system` | System diagnostics | Admin |

### Meters

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/meters` | List all registered meters | Yes |
| `GET` | `/meters/:id` | Get meter details by ID | Yes |
| `POST` | `/meters` | Register a new meter | Admin |
| `PUT` | `/meters/:id` | Update meter configuration | Admin |
| `DELETE` | `/meters/:id` | Remove a meter | Admin |
| `GET` | `/meters/:id/readings` | Get readings for a specific meter | Yes |

### Analytics

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/analytics/summary` | Aggregate consumption summary | Yes |
| `GET` | `/analytics/trends` | Consumption trends over time | Yes |
| `GET` | `/analytics/alerts` | Active alerts and anomalies | Yes |

### Exports

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/exports/meters` | Export meter data (CSV/JSON) | Yes |
| `GET` | `/exports/readings` | Export readings report | Yes |

### Webhooks

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/webhooks` | Register a webhook endpoint | Admin |
| `GET` | `/webhooks` | List registered webhooks | Yes |
| `DELETE` | `/webhooks/:id` | Remove a webhook | Admin |

### WebSocket

| Event | Direction | Description |
|-------|-----------|-------------|
| `meter:reading` | Server → Client | Real-time meter reading update |
| `meter:alert` | Server → Client | Meter anomaly or alert notification |
| `meter:status` | Server → Client | Meter online/offline status change |
| `subscribe:meters` | Client → Server | Subscribe to specific meter IDs |
| `unsubscribe:meters` | Client → Server | Unsubscribe from specific meter IDs |

Connect to `ws://localhost:3000/ws`.

### Example Responses

```json
GET /
{
  "project": "Equipchain",
  "status": "Monitoring Meters",
  "contract": "CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS"
}
```

```json
GET /api/health
{
  "status": "healthy",
  "uptime": 123.45,
  "timestamp": 1700000000000
}
```

```json
POST /api/auth/challenge
Request: { "wallet": "GANONEXISTENT123..." }
Response: { "token": "mock-jwt-...", "expiresIn": 3600 }
```

---

## Architecture Overview

### Directory Structure

```
EquipChain-backend/
├── .github/
│   └── workflows/
│       └── ci.yml              # CI pipeline (test on push/PR to main)
├── k6/
│   ├── shared.js               # k6 shared configuration and helpers
│   ├── smoke.js                # Smoke test (1 VU, 30s)
│   ├── load.js                 # Load test (50 VUs, 5min)
│   ├── stress.js               # Stress test (500 VUs)
│   ├── spike.js                # Spike test (200 VUs sudden)
│   ├── soak.js                 # Soak test (50 VUs, 30min+)
│   └── results/                # Generated reports (gitignored)
├── src/
│   ├── config/
│   │   ├── logger.js           # Pino structured logger
│   │   └── tracing.js          # OpenTelemetry setup
│   ├── schemas/
│   │   └── common.schema.js    # Shared Zod query schemas
│   └── utils/
│       ├── errors.js           # ValidationError (HTTP 400)
│       └── pagination.js       # Pagination, filtering, sorting, search
├── test/
│   ├── common.schema.test.js   # Query schema tests
│   ├── logger.test.js          # Logger unit tests
│   ├── pagination.test.js      # Pagination utility tests
│   └── server.test.js          # Server integration tests
├── index.js                    # Express app entry point
├── package.json                # Project metadata and dependencies
└── README.md                   # You are here
```

### Middleware Pipeline (Planned)

```
Request
  │
  ▼
[Logger]           → HTTP request logging (Pino + Correlation ID)
[Rate Limiter]     → Rate limiting per IP/user
[CORS]             → Cross-origin resource sharing
[Auth]             → JWT verification for protected routes
[Validator]        → Request body/param validation
  │
  ▼
[Router]           → Dispatches to the appropriate controller
  │
  ▼
[Controller]       → Handles business logic orchestration
[Service Layer]    → Encapsulates domain logic
[Repository]       → Data access (Redis / Soroban / DB)
  │
  ▼
[Response]         → JSON serialization and response
```

### Service Layer

Services encapsulate business logic and are injected into controllers:

- **MeterService** — CRUD operations for meters, reading aggregation
- **AuthService** — User authentication, JWT management, session handling
- **AnalyticsService** — Trend computation, anomaly detection, alert generation
- **ExportService** — Data formatting and file generation (CSV/JSON)

### Data Access (Repository Pattern)

| Repository | Backend | Purpose |
|------------|---------|---------|
| `MeterRepository` | Soroban / Redis | On-chain meter state and cached readings |
| `UserRepository` | PostgreSQL / in-memory | User accounts and roles |
| `AnalyticsRepository` | Redis | Cached aggregations and computed metrics |
| `WebhookRepository` | Redis | Webhook endpoint storage and event dispatch |

---

## Configuration Reference

All configuration is via environment variables. Create a `.env` file in the project root.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Port the HTTP server binds to |
| `HOST` | `0.0.0.0` | No | Host address to bind |
| `CONTRACT_ID` | *(see below)* | No | Stellar Soroban contract ID for meter data |
| `REDIS_URL` | — | No | Redis connection string (`redis://...`) |
| `WS_ENABLED` | `false` | No | Set to `true` to enable WebSocket server |
| `WS_PATH` | `/ws` | No | WebSocket endpoint path |
| `NODE_ENV` | `development` | No | `development`, `test`, or `production` |
| `LOG_LEVEL` | `info` | No | `debug`, `info`, `warn`, `error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | No | OTLP collector endpoint for trace export (e.g. `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | `equipchain-api` | No | Service name reported in traces |
| `JWT_SECRET` | — | Yes (in production) | Secret key for signing JWTs |
| `JWT_EXPIRY` | `1h` | No | JWT expiration duration |
| `RATE_LIMIT_WINDOW` | `900000` | No | Rate limit window in ms (default 15 min) |
| `RATE_LIMIT_MAX` | `100` | No | Max requests per window |
| `CORS_ORIGIN` | `*` | No | Allowed CORS origins |

Default `CONTRACT_ID`: `CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS`

---

## Development Guide

### Running Tests

```bash
npm test
```

Tests use Node's built-in `node:test` and `node:assert` modules. No additional test framework is required.

### Linting

```bash
# Lint all JavaScript files
npx eslint .
```

### Building for Production

```bash
npm ci --production
```

### Docker

```bash
# Build the image
docker build -t equipchain-backend .

# Run the container
docker run -p 3000:3000 --env-file .env equipchain-backend
```

### Environment

Copy the example env file and customize:

```bash
cp .env.example .env
```

---

## Load Testing with k6

Performance testing is implemented using [Grafana k6](https://k6.io), an open-source load testing tool to identify performance bottlenecks under stress.

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

---

## Deployment Guide

### Docker (Recommended)

```bash
docker build -t equipchain-backend .
docker run -d \
  --name equipchain-api \
  -p 3000:3000 \
  --env-file .env \
  equipchain-backend
```

### Cloud Platforms

| Platform | Instructions |
|----------|-------------|
| **Railway** | Connect repo, set build command `npm install`, start command `npm start` |
| **Render** | Use Web Service, set runtime to Node, start command `npm start` |
| **Fly.io** | Run `fly launch`, configure `internal_port = 3000` |
| **AWS ECS** | Push Docker image to ECR, configure task definition with env vars |

### CI/CD Pipeline

The included GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

1. **Checkout** — Clone the repository
2. **Setup Node** — Install Node.js 22 with npm cache
3. **Install** — `npm ci`
4. **Test** — `npm test`

### Production Considerations

- Set `NODE_ENV=production` to disable debug logging
- Always configure `JWT_SECRET` with a strong random value
- Enable rate limiting to protect endpoints
- Use Redis for session caching and meter data
- Run behind a reverse proxy (nginx, Caddy) for SSL termination
- Configure health check monitoring on `/api/health`

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure tests pass before submitting.

---

## Related

- [EquipChain Contracts](https://github.com/EquipChain/EquipChain-contracts) — Soroban smart contracts on Stellar
- [EquipChain Frontend](https://github.com/EquipChain/EquipChain-frontend) — Web dashboard and client app

## License

[MIT](LICENSE) © EquipChain
