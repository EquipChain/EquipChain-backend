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

**Current Phase:** MVP — Core meter monitoring endpoints are operational. The API serves project metadata and on-chain contract data, and provides dashboard analytics aggregation. WebSocket event streaming for live meter readings is implemented. Future releases will add full CRUD for meters and admin management.

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
| `GET` | `/health` | Service health + queue/scheduler stats + deploy identity (`gitSha`, `deployedAt`) | No |
| `GET` | `/health/live` | Liveness probe — dependency-free; failure means restart | No |
| `GET` | `/health/ready` | Readiness probe — checks services + cache; failure removes the instance from LB rotation | No |
| `GET` | `/metrics` | Prometheus scrape (HTTP counters/histograms, event-loop lag, build info, queue/cache gauges) | Optional bearer (`METRICS_TOKEN`) |
| `GET` | `/api/system/rate-limits` | Caller's resolved rate-limit tier, remaining budget, window reset | No |

The Docker image carries a `HEALTHCHECK` probing `/health/live`; compose uses `/health/ready`.

### Auth

Authentication is JWT-based (HS256, `Authorization: Bearer <token>`). Tokens carry a `sub` (identity), `roles` array, and a unique `jti` so they can be revoked server-side.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/api/auth/challenge` | Dev convenience: mint a JWT for a wallet address. Disabled in production unless `ENABLE_DEV_CHALLENGE=true` (the production flow is wallet-signature verification, layered onto this endpoint). Brute-force guarded (5/min per IP). | No |
| `GET` | `/api/protected` | Protected sample route | Yes (JWT) |
| `POST` | `/api/auth/logout` | Revoke the caller's own token server-side (jti denylist) | Yes (JWT) |
| `GET` | `/api/analytics/readings` | Machine access to raw readings via API key | Yes (`x-api-key`) |

> **Note:** The earlier revision of this table listed `/auth/login`,
> `/auth/register`, and `/auth/refresh` — those endpoints never existed in
> this service and the table has been corrected. There is currently no
> password-based account system; identities come from the challenge flow
> (dev) or wallet-signature verification (production), and user accounts
> are managed by admins via `/api/admin/users`.

#### API keys (machine-to-machine)

Service clients authenticate with an `x-api-key` header instead of a JWT. Keys are stored in the API-key repository with a status, an expiry, a permission scope list (`read`, `write`), and a rate-limit tier (`standard`/`premium` → premium tier, `internal` → internal tier). Lookup is timing-safe (hash-then-compare), and a key lacking the route's required permission is rejected with 403 even though it authenticates.

#### Token revocation

Every token has a `jti`. `POST /api/auth/logout` (and `POST /api/admin/logout` for admins) denylists the presented token's `jti` for its remaining TTL through the shared cache, so sign-out is real: the token stops authenticating immediately, on every instance, not just the client that dropped it.

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

### Admin

All admin routes require a JWT with the admin role. Changes to users, devices, config, and webhooks are recorded in an audit trail readable at `GET /api/admin/audit`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | List users (paginated, filterable, searchable) |
| `POST` | `/api/admin/users` | Create a user (duplicate email → 409) |
| `GET` | `/api/admin/users/:id` | Get user details |
| `PATCH` | `/api/admin/users/:id` | Update a user's roles |
| `DELETE` | `/api/admin/users/:id` | Deactivate a user |
| `GET` | `/api/admin/devices` | List registered devices |
| `POST` | `/api/admin/devices` | Register a device (duplicate deviceId → 409) |
| `PATCH` | `/api/admin/devices/:id` | Update device metadata |
| `DELETE` | `/api/admin/devices/:id` | Remove a device |
| `GET` | `/api/admin/webhooks` | List webhook endpoints (secrets omitted) |
| `POST` | `/api/admin/webhooks` | Register a webhook (returns signing secret once) |
| `GET` | `/api/admin/webhooks/:id` | Webhook details |
| `GET` | `/api/admin/webhooks/:id/deliveries` | Recent delivery attempts (newest first) |
| `PATCH` | `/api/admin/webhooks/:id` | Update webhook / pause via `status: inactive` |
| `DELETE` | `/api/admin/webhooks/:id` | Delete webhook and its delivery logs |
| `GET` | `/api/admin/config` | Get runtime config |
| `PATCH` | `/api/admin/config` | Update whitelisted config keys (`rateLimitPerMinute`, `maintenanceMode`) |
| `POST` | `/api/admin/config/reset` | Reset config to defaults |
| `GET` | `/api/admin/audit` | Admin action audit trail (filter by `action`, `admin`) |
| `GET` | `/api/admin/system/health` | System health snapshot |
| `GET` | `/api/admin/system/stats` | Resource/connection stats |
| `GET` | `/api/admin/system/ws-connections` | Active WebSocket connections |
| `POST` | `/api/admin/logout` | Revoke the admin's own token |

#### Runtime config keys

| Key | Default | Effect |
|-----|---------|--------|
| `maintenanceMode` | `false` | `true` returns 503 on all `/api/exports` and `/api/analytics` routes (admin routes and health probes stay reachable so you can turn it back off) |
| `rateLimitPerMinute` | `null` (off) | When set, caps **every** rate-limit tier at this many requests/min, live without restart |

### Meters (Planned)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/meters` | List all registered meters | Yes |
| `GET` | `/meters/:id` | Get meter details by ID | Yes |
| `POST` | `/meters` | Register a new meter | Admin |
| `PUT` | `/meters/:id` | Update meter configuration | Admin |
| `DELETE` | `/meters/:id` | Remove a meter | Admin |
| `GET` | `/meters/:id/readings` | Get readings for a specific meter | Yes |

### Exports

All export data comes from the live stores (readings store, device registry) — analytics summaries are computed from real stored readings.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/exports/readings` | Export meter readings (CSV/JSON/NDJSON) | Yes |
| `GET` | `/api/exports/analytics/:summaryType` | Export analytics summaries (daily/weekly/monthly) | Yes |
| `GET` | `/api/exports/system-report` | Export system-wide report (meters, readings, alerts, summary) | Admin |
| `GET` | `/api/exports/meters` | Export the device registry | Yes |

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

# Export system report (admin only - admin role comes from the JWT, never a header)
curl -H "Authorization: Bearer ADMIN_TOKEN" \
  "http://localhost:3000/api/exports/system-report?format=json&sections=meters,summary"
```

#### Streaming Support

All export endpoints use streaming to handle large datasets efficiently:
- Responses use `Transfer-Encoding: chunked`
- Data is streamed row-by-row for CSV and line-by-line for NDJSON
- Memory usage remains constant regardless of dataset size
- Suitable for exporting 10,000+ records

### Webhooks

Webhook endpoints are registered by admins and delivered through the job queue with SSRF guards (private/reserved targets refused), bounded redirects, retries with backoff, and HMAC-SHA256 signatures.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/api/admin/webhooks` | Register a webhook endpoint | Admin |
| `GET` | `/api/admin/webhooks` | List registered webhooks | Admin |
| `GET` | `/api/admin/webhooks/:id/deliveries` | Recent delivery attempts | Admin |
| `PATCH` | `/api/admin/webhooks/:id` | Update or pause (`status: inactive`) | Admin |
| `DELETE` | `/api/admin/webhooks/:id` | Remove a webhook | Admin |

#### Verifying deliveries

Every delivery to a registered webhook carries:

```
x-equipchain-signature: t=<unix_seconds>,v1=<hex_hmac>
```

The signature is HMAC-SHA256 over `"<t>.<raw_body>"` keyed with the secret returned at registration time. Because the timestamp is inside the signed material, a captured delivery cannot be replayed with a fresh timestamp — verify the HMAC **and** reject timestamps older than a few minutes:

```js
const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  && Math.abs(Date.now() / 1000 - t) < 300;
```

### API Documentation (Implemented)

The API is documented with OpenAPI 3 and served interactively via Swagger UI.

| Endpoint | Description |
|----------|-------------|
| `GET /api/openapi.json` | Raw OpenAPI 3 specification (generated from `@openapi` JSDoc annotations) |
| `GET /api/docs` | Interactive Swagger UI for browsing and testing the API |

The specification covers all API endpoints (system, admin, analytics, exports) and the
security scheme (`bearerAuth`). Annotations live alongside the route handlers in `src/`,
so the docs stay in sync with the code.

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
│       └── ci.yml              # CI (lint, Node 20/22 test matrix, audit, Docker gate)
├── k6/                         # Grafana k6 load-test scenarios
├── scripts/
│   ├── seed-readings.js        # Sample meter readings generator (auto-runs in dev)
│   ├── docker-build.sh         # Docker build helper
│   └── docker-run.sh           # Docker run helper
├── src/
│   ├── config/
│   │   ├── index.js            # Frozen env config, fail-fast validation
│   │   ├── logger.js           # Pino structured logger with redaction
│   │   ├── rateLimits.js       # Tier definitions for the rate limiter
│   │   └── tracing.js          # OpenTelemetry setup
│   ├── data/
│   │   └── adminStore.js       # Admin-managed stores (users/devices/config/audit)
│   ├── docs/
│   │   └── openapi.js          # OpenAPI 3 spec builder from @openapi annotations
│   ├── jobs/
│   │   ├── billing.job.js      # Period consumption billing
│   │   ├── cacheWarm.job.js    # Analytics cache warming
│   │   ├── reports.job.js      # Daily/monthly report generation
│   │   ├── sync.job.js         # Soroban contract-state sync
│   │   └── webhookRetry.job.js # Signed webhook delivery (SSRF-guarded)
│   ├── lib/
│   │   └── soroban.js          # Soroban RPC adapter (real + mock backends)
│   ├── middleware/
│   │   ├── apiKeyAuth.js       # API-key auth (timing-safe, scopes, expiry)
│   │   ├── auth.js             # JWT verify + jti revocation denylist
│   │   ├── metrics.js          # Prometheus instrumentation + /metrics render
│   │   ├── rateLimiter.js      # Tiered rate limiting with bounded store
│   │   ├── requireAdmin.js     # Admin role guard
│   │   └── validate.js         # Zod request validation
│   ├── repositories/           # Repository layer (Base + domain repos)
│   ├── routes/
│   │   ├── admin/              # /api/admin/* (users, devices, webhooks, config, audit, system)
│   │   ├── analytics.js        # /api/analytics/* aggregation + raw readings
│   │   ├── docs.js             # /api/docs (Swagger UI), /api/openapi.json
│   │   ├── exports.js          # /api/exports/* streaming exports
│   │   └── index.js            # Router composition, health probes, logout
│   ├── schemas/                # Zod request schemas
│   ├── services/
│   │   ├── aggregator.js       # In-memory readings store + aggregation engine
│   │   ├── cache.js            # Redis cache with bounded memory fallback
│   │   ├── exporter.js         # Streaming CSV/JSON/NDJSON export engine
│   │   ├── queue.js            # Durable job queue (timeouts, backpressure, recovery)
│   │   ├── scheduler.js        # Cron-style scheduler (chunked intervals)
│   │   ├── webhook.js          # Webhook delivery service
│   │   └── websocket.js        # socket.io gateway (JWT handshakes)
│   ├── utils/                  # pagination, sanitization, errors
│   ├── app.js                  # Canonical Express app (middleware pipeline)
│   └── server.js               # Server composition root (services, shutdown)
├── test/                       # node:test suites (unit + integration)
├── index.js                    # Boot entry point (npm start, Docker CMD)
├── Dockerfile                  # Multi-stage build, non-root, HEALTHCHECK
├── docker-compose.yml          # API + Redis stack
├── package.json                # Project metadata and dependencies
└── README.md                   # You are here
```

### Middleware Pipeline

The pipeline as actually mounted in `src/app.js`:

```
Request
  │
  ▼
[Metrics]          → Request counter + duration histogram (bounded route labels)
[/metrics]         → Prometheus scrape endpoint (optional bearer token)
[Helmet]           → Security headers (strict CSP, HSTS, no framing)
[CORS]             → Origin allowlist (CORS_ORIGINS)
[Body parsing]     → JSON/urlencoded with size limit + prototype-pollution strip
[Rate limiter]     → Tiered per identity (free/premium/admin/internal + API keys)
[Auth guard]       → Stricter limiter on /api/auth/challenge (brute force)
[Correlation ID]   → Sanitized x-correlation-id + structured request logging
  │
  ▼
[Router]           → System routes, analytics, exports, docs, admin (JWT + role)
[Maintenance gate] → 503 kill-switch on public analytics/exports when enabled
  │
  ▼
[Handlers]         → Route handlers → services → repositories
  │
  ▼
[404] → [Error handler] → Standard error envelope, correlation-ID reference for 500s
```

### Services

- **Cache** — Redis with a bounded in-memory fallback; single-flight `getOrSet` prevents stampedes
- **Queue** — Durable job queue: per-job timeouts, backpressure cap, crash recovery, retry ladder
- **Scheduler** — Cron-style recurring jobs (billing, reports, sync, cache warm)
- **Webhook** — Signed HTTP delivery through the queue
- **WebSocket** — socket.io gateway broadcasting meter readings (batched per meter)

### Data Access (Repository Pattern)

| Repository | Backend | Purpose |
|------------|---------|---------|
| `MeterReadingRepository` | In-memory / future DB | Meter readings |
| `UserRepository` | In-memory / future PostgreSQL | User accounts and roles |
| `DeviceRepository` | In-memory / future DB | Device registry |
| `ApiKeyRepository` | In-memory / future DB | API keys (scopes, expiry, tiers) |
| `WebhookRepository` | In-memory / future DB | Webhook endpoints + capped delivery logs |
| `ConfigRepository` | In-memory / future DB | Runtime config |

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

### Server Entry Points

The project has two entry files with distinct roles - keep them that way:

| File | Role | Used by |
|------|------|---------|
| `index.js` | Full boot path: seeds dev data, installs process handlers, starts the server with all background services | `npm start`, the Docker `CMD` |
| `src/server.js` | Library module: exports `startServer`, `installProcessHandlers`, `gracefulShutdown`; also runs standalone when executed directly | `index.js`, tests, tooling |

> **Historical note:** `src/server.js` exports the boot contract `index.js`
> consumes. Requiring the module (as tests do) must never mutate global
> process state - handlers are installed only via `installProcessHandlers()`.

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
docker build -t equipchain-backend:local .
docker run --rm -p 3000:3000 --env-file .env equipchain-backend:local
```

Run the full local stack (API + Redis) with Docker Compose:

```bash
docker compose up --build
```

Helper scripts:

```bash
sh scripts/docker-build.sh
sh scripts/docker-run.sh
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
docker build -t equipchain-backend:local .
docker run -d \
  --name equipchain-api \
  -p 3000:3000 \
  --env-file .env \
  equipchain-backend:local
```

Docker Compose (API + Redis):

```bash
docker compose up -d --build
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
