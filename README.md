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
- **Dashboard Analytics** — Data aggregation endpoints for daily, monthly, custom-range summaries and fleet-wide metrics.
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

**Current Phase:** MVP — Core meter monitoring endpoints are operational. The API serves project metadata and on-chain contract data, and provides dashboard analytics aggregation. Future releases will add full CRUD for meters, WebSocket event streaming, and admin management.

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

> **Note:** On first startup in development mode, the server automatically seeds ~6,480 sample meter readings across 3 meters spanning 90 days. This provides test data for the analytics endpoints immediately. Set `SKIP_SEED=1` to disable auto-seeding.

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

### Analytics

Dashboard analytics and data aggregation endpoints for meter readings. Computed in-memory from stored readings.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/analytics/daily-summary` | Daily aggregated readings within a date range | No |
| `GET` | `/api/analytics/monthly-summary` | Monthly aggregated readings within a date range | No |
| `GET` | `/api/analytics/custom-range` | Aggregated readings with configurable granularity | No |
| `GET` | `/api/analytics/fleet-summary` | Fleet-wide summary across all meters | No |

#### GET /api/analytics/daily-summary

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startDate` | string (ISO 8601) | Required | Start date (e.g., `2026-01-01`) |
| `endDate` | string (ISO 8601) | Required | End date (e.g., `2026-01-31`) |
| `meterIds` | string or string[] | All meters | Filter by one or more meter IDs |
| `timezone` | string (IANA) | `UTC` | Timezone for day boundaries |
| `aggregationType` | enum | `avg` | `count`, `sum`, `avg`, `min`, `max`, `p50`, `p95` |
| `compareWith` | enum | — | `previous_period`, `year_over_year` |

**Example Response:**

```json
GET /api/analytics/daily-summary?startDate=2026-01-01&endDate=2026-01-03&aggregationType=sum

{
  "data": [
    { "key": "2026-01-01", "value": 350, "count": 3 },
    { "key": "2026-01-02", "value": 225, "count": 2 },
    { "key": "2026-01-03", "value": 425, "count": 2 }
  ],
  "meta": {
    "startDate": "2026-01-01",
    "endDate": "2026-01-03",
    "granularity": "day",
    "aggregationType": "sum",
    "timezone": "UTC",
    "totalReadings": 7
  }
}
```

#### GET /api/analytics/monthly-summary

Same parameters as daily-summary, returns monthly rollups.

#### GET /api/analytics/custom-range

**Additional Parameter:** `granularity` — `hour`, `day`, `week`, `month`

#### GET /api/analytics/fleet-summary

**Example Response:**

```json
{
  "fleet": {
    "totalReadings": 6480,
    "totalMeters": 3,
    "value": 112.5,
    "aggregationType": "avg"
  },
  "meters": [
    { "meterId": "METER-001", "value": 150.2, "readings": 2160 },
    { "meterId": "METER-002", "value": 85.3, "readings": 2160 },
    { "meterId": "METER-003", "value": 102.0, "readings": 2160 }
  ],
  "topPerformer": { "meterId": "METER-001", "value": 150.2, "readings": 2160 },
  "bottomPerformer": { "meterId": "METER-002", "value": 85.3, "readings": 2160 }
}
```

### Admin (Planned)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/admin/users` | List all users | Admin |
| `GET` | `/admin/users/:id` | Get user details | Admin |
| `PUT` | `/admin/users/:id` | Update user role/status | Admin |
| `DELETE` | `/admin/users/:id` | Remove a user | Admin |
| `GET` | `/admin/system` | System diagnostics | Admin |

### Meters (Planned)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/meters` | List all registered meters | Yes |
| `GET` | `/meters/:id` | Get meter details by ID | Yes |
| `POST` | `/meters` | Register a new meter | Admin |
| `PUT` | `/meters/:id` | Update meter configuration | Admin |
| `DELETE` | `/meters/:id` | Remove a meter | Admin |
| `GET` | `/meters/:id/readings` | Get readings for a specific meter | Yes |

### Exports (Planned)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/exports/readings` | Export meter readings (CSV/JSON/NDJSON) | Yes |
| `GET` | `/api/exports/analytics/:summaryType` | Export analytics summaries (daily/weekly/monthly) | Yes |
| `GET` | `/api/exports/system-report` | Export system-wide report (meters, readings, alerts) | Admin |
| `GET` | `/api/exports/meters` | Export meter registry | Yes |

#### Export Query Parameters

All export endpoints support the following query parameters:

- `format` - Output format: `csv`, `json`, or `ndjson` (default: `csv`)
- `fields` - Comma-separated list of fields to include (e.g., `id,timestamp,value`)
- `startDate` - Filter by start date (ISO format: `2026-01-01` or `2026-01-01T00:00:00Z`)
- `endDate` - Filter by end date (ISO format)
- `pretty` - Set to `true` for pretty-printed JSON (default: `false`)

Additional parameters specific to endpoints:

- `/api/exports/readings`: `meterIds` (comma-separated), `status`
- `/api/exports/analytics/:summaryType`: Date range filtering for daily summaries
- `/api/exports/system-report`: `sections` (comma-separated: `meters,readings,alerts,summary`)
- `/api/exports/meters`: `status`, `location`

#### Export Examples

```bash
# Export all readings as CSV
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/exports/readings?format=csv"

# Export specific fields as JSON
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/exports/readings?format=json&fields=id,timestamp,value"

# Export readings for specific meters and date range
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/exports/readings?format=csv&meterIds=meter-001,meter-002&startDate=2026-01-01&endDate=2026-06-01"

# Export daily analytics as NDJSON (streaming)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/exports/analytics/daily?format=ndjson"

# Export system report (admin only)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-role: admin" \
  "http://localhost:3000/api/exports/system-report?format=json&sections=meters,summary"
```

#### Streaming Support

All export endpoints use streaming to handle large datasets efficiently:
- Responses use `Transfer-Encoding: chunked`
- Data is streamed row-by-row for CSV and line-by-line for NDJSON
- Memory usage remains constant regardless of dataset size
- Suitable for exporting 10,000+ records

### Webhooks (Planned)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/webhooks` | Register a webhook endpoint | Admin |
| `GET` | `/webhooks` | List registered webhooks | Yes |
| `DELETE` | `/webhooks/:id` | Remove a webhook | Admin |

### WebSocket (Planned)

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

### Pagination Modes

List endpoints select a strategy with `?paginate=offset` (default) or `?paginate=cursor`.

**Offset** — `?page=2&limit=20`. Familiar, supports jumping to an arbitrary page, and reports
`total`/`totalPages`. Best for small to medium result sets.

**Cursor (keyset)** — `?cursor=<opaque>&limit=20` forward, `?before=<opaque>&limit=20` backward.
Position is anchored to a value rather than a row count, which gives it two properties offset
paging cannot have: performance independent of how deep you are, and no page drift — rows
inserted or deleted between requests never cause a client to skip or repeat items. Use it for
large, append-heavy data such as meter readings, audit logs and webhook delivery logs.

| Parameter | Mode | Description |
|-----------|------|-------------|
| `paginate` | both | `offset` (default) or `cursor` |
| `limit` | both | Items per page, 1–100 (default 20) |
| `page` | offset | 1-based page number (default 1) |
| `cursor` | cursor | Page forward from this position |
| `before` | cursor | Page backward from this position |
| `sortBy` / `sortOrder` | both | Sort field and `asc`/`desc` |

```json
GET /meters?paginate=cursor&limit=2
{
  "data": [ { "id": 1 }, { "id": 2 } ],
  "pagination": {
    "limit": 2,
    "cursor": null,
    "nextCursor": "eyJ2IjoxLCJmIjoiaWQiLCJvIjoiYXNjIiwiayI6MiwiaWQiOjJ9",
    "prevCursor": null,
    "hasNext": true,
    "hasPrev": false
  }
}
```

`total` and `totalPages` are absent in cursor mode: counting the full result set is the exact
cost cursor pagination exists to avoid. Endpoints that need a count can opt in via the
`includeTotal` option.

**Cursors are opaque.** Pass them back exactly as received — do not construct, parse or edit
them. A cursor records the sort it was issued for, so replaying one against a different
`sortBy`/`sortOrder` is rejected with a 400 rather than silently returning the wrong rows.

---

## Architecture Overview

### Directory Structure

```
EquipChain-backend/
├── .github/
│   └── workflows/
│       └── ci.yml              # CI pipeline (test on push/PR to main)
├── scripts/
│   └── seed-readings.js        # Sample meter readings generator (auto-runs in dev)
├── src/
│   ├── config/
│   │   ├── logger.js           # Pino structured logger
│   │   └── tracing.js          # OpenTelemetry setup
│   ├── routes/
│   │   └── analytics.js        # Analytics aggregation endpoints
│   ├── schemas/
│   │   ├── analytics.schema.js # Analytics query validation schemas
│   │   └── common.schema.js    # Shared Zod query schemas
│   ├── services/
│   │   └── aggregator.js       # In-memory aggregation engine
│   └── utils/
│       ├── errors.js           # ValidationError (HTTP 400)
│       └── pagination.js       # Offset + cursor pagination, filtering, sorting, search
├── test/
│   ├── aggregator.test.js      # Aggregation service unit tests
│   ├── analytics.test.js       # Analytics endpoint integration tests
│   ├── common.schema.test.js   # Query schema tests
│   ├── cursorPagination.test.js # Cursor (keyset) pagination tests
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
| `SKIP_SEED` | — | No | Set to `1` to skip auto-seeding sample data |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | No | OTLP collector endpoint for trace export |
| `OTEL_SERVICE_NAME` | `equipchain-api` | No | Service name reported in traces |

Default `CONTRACT_ID`: `CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS`

---

## Development Guide

### Running Tests

```bash
npm test
```

Tests use Node's built-in `node:test` and `node:assert` modules. No additional test framework is required.

### Seed Data

Sample meter reading data spanning 90 days across 3 meters is auto-generated on server start in development mode. The seed data powers the analytics endpoints with realistic consumption patterns (morning ramp, peak hours, evening decline, night lows). To manually seed or re-seed:

```bash
node scripts/seed-readings.js
```

### Linting

```bash
npx eslint .
```

### Building for Production

```bash
npm ci --production
```

### Docker

```bash
docker build -t equipchain-backend .
docker run -p 3000:3000 --env-file .env equipchain-backend
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

- Set `NODE_ENV=production` to disable debug logging and auto-seeding
- Use a reverse proxy (nginx, Caddy) for SSL termination
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
