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
- **Dashboard Analytics** — Data aggregation endpoints for daily, monthly, and custom-range summaries with fleet-wide metrics.

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

**Current Phase:** MVP — Core meter monitoring endpoints are operational. The API serves project metadata, on-chain contract data, and provides dashboard analytics aggregation. Future releases will add full CRUD for meters, WebSocket event streaming, and admin management.

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

> **Note:** On first startup in development mode, the server automatically seeds ~6,480 sample meter readings across 3 meters spanning 90 days. This provides data for testing the analytics endpoints immediately. Set `SKIP_SEED=1` to disable auto-seeding.

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

### Analytics

Dashboard analytics and data aggregation endpoints for meter readings. Results are computed in-memory from stored readings.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/analytics/daily-summary` | Daily aggregated readings within a date range | No |
| `GET` | `/api/analytics/monthly-summary` | Monthly aggregated readings within a date range | No |
| `GET` | `/api/analytics/custom-range` | Aggregated readings with configurable granularity | No |
| `GET` | `/api/analytics/fleet-summary` | Fleet-wide summary across all meters | No |

#### GET /api/analytics/daily-summary

Returns daily aggregated meter readings within a date range.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startDate` | string (ISO 8601) | Required | Start date (e.g., `2026-01-01`) |
| `endDate` | string (ISO 8601) | Required | End date (e.g., `2026-01-31`) |
| `meterIds` | string or string[] | All meters | Filter by one or more meter IDs |
| `timezone` | string (IANA) | `UTC` | Timezone for day boundaries (e.g., `America/New_York`) |
| `aggregationType` | enum | `avg` | Aggregation function: `count`, `sum`, `avg`, `min`, `max`, `p50`, `p95` |
| `compareWith` | enum | — | Period comparison: `previous_period`, `year_over_year` |

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

**With Period Comparison:**

```json
GET /api/analytics/daily-summary?startDate=2026-01-01&endDate=2026-01-31&aggregationType=sum&compareWith=previous_period

{
  "data": [ ... ],
  "meta": { ... },
  "comparison": {
    "current": [ ... ],
    "previous": [ ... ],
    "comparison": {
      "delta": 5200,
      "percentageChange": 12.5
    },
    "mode": "previous_period"
  }
}
```

#### GET /api/analytics/monthly-summary

Same parameters as `daily-summary` but returns monthly rollups.

#### GET /api/analytics/custom-range

Returns aggregated readings with a configurable granularity.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startDate` | string (ISO 8601) | Required | Start date |
| `endDate` | string (ISO 8601) | Required | End date |
| `granularity` | enum | `day` | Time bucket: `hour`, `day`, `week`, `month` |
| `meterIds` | string or string[] | All meters | Filter by meter IDs |
| `timezone` | string (IANA) | `UTC` | Timezone for boundaries |
| `aggregationType` | enum | `avg` | Aggregation function |

**Example:**

```
GET /api/analytics/custom-range?startDate=2026-01-01&endDate=2026-01-01&granularity=hour&aggregationType=avg
```

#### GET /api/analytics/fleet-summary

Returns fleet-wide aggregated summary across all meters.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startDate` | string (ISO 8601) | — | Optional start date filter |
| `endDate` | string (ISO 8601) | — | Optional end date filter |
| `aggregationType` | enum | `avg` | Aggregation function |

**Example Response:**

```json
GET /api/analytics/fleet-summary

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
│       └── pagination.js       # Pagination, filtering, sorting, search
├── test/
│   ├── aggregator.test.js      # Aggregation service unit tests
│   ├── analytics.test.js       # Analytics endpoint integration tests
│   ├── common.schema.test.js   # Query schema tests
│   ├── logger.test.js          # Logger unit tests
│   ├── pagination.test.js      # Pagination utility tests
│   └── server.test.js          # Server integration tests
├── index.js                    # Express app entry point
├── package.json                # Project metadata and dependencies
└── README.md                   # You are here
```

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

---

## Development Guide

### Running Tests

```bash
npm test
```

Tests use Node's built-in `node:test` and `node:assert` modules. No additional test framework is required.

### Seed Data

Sample meter reading data spanning 90 days across 3 meters is auto-generated on server start in development mode. The seed data powers the analytics endpoints with realistic consumption patterns including morning ramp, peak hours, evening decline, and night lows.

To manually seed or re-seed data:

```bash
node scripts/seed-readings.js
```

### Linting

```bash
npx eslint .
```

### Docker

```bash
docker build -t equipchain-backend .
docker run -p 3000:3000 --env-file .env equipchain-backend
```

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
4. **Test** — `npm test` (runs all 133+ tests)

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
