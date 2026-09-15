# Changelog

All notable changes to the EquipChain backend, organized by the five
improvement batches that took the service from a mock-data MVP to a
production-hardened API. Each entry explains the *why* alongside the *what*;
commit messages contain the full rationale and verification notes.

## Batch 5 — Completeness, correctness, and the last mock-data lies

### Fixed
- **Production boot crash**: `src/server.js` carried a duplicate
  `module.exports` whose second assignment dropped `installProcessHandlers`
  from the export surface — `node index.js` (the Docker CMD, `npm start`)
  died instantly with `TypeError` while every test stayed green, because
  tests spawned `src/server.js` directly and never exercised the entry-path
  contract. Fixed, and pinned by a boot-contract test.
- **Exports served fabricated data**: `/readings` returned three hardcoded
  rows forever, `/meters` described meters that never existed, analytics
  summaries were constants, and the system report shipped a fictional
  alert. All exports now read the live readings store and device registry,
  with analytics computed from real bucket summaries. Integration tests
  seed real stores and assert exact totals.
- **Swagger UI drift**: the UI embedded a spec snapshot captured at mount
  time, so every endpoint registered after the docs router was invisible in
  the UI while `/api/openapi.json` served it. The UI now uses spec
  discovery against the live endpoint.
- **`.env.example`** documented a fraction of the config and carried a
  bogus `[TEMPLATE]` header (invalid .env syntax). Rewritten, grouped by
  concern, every entry verified against the code that reads it.
- **`x-role` header removed** from CORS allowedHeaders — a relic of the old
  client-controlled-admin bypass, kept whitelisted as a loaded footgun for
  any future route that innocently reads it. README example corrected to
  show the real mechanism (role from the signed JWT).
- **Webhook delivery-log growth**: per-webhook logs appended without bound
  (including response bodies) — a slow memory leak nothing swept. Now
  capped (newest 100 kept), and `delete()` frees logs with the webhook.
- **CI lint gate was already broken on main**: the flat config never
  declared `setImmediate`, so the event-loop lag sampler's file failed
  `no-undef` as an error on every push.
- **`rateLimitPerMinute` ceiling made opt-in** after the first wiring
  silently throttled premium/admin/internal tiers to 60/min from boot (the
  full-suite run caught it; default is now `null` = tiers run at their own
  max).

### Added
- **API-key authentication** (`x-api-key`): the repository and rate-limiter
  halves existed but nothing authenticated a key. New middleware with
  hash-then-`timingSafeEqual` lookup, status/expiry enforcement, permission
  scopes (403 on missing scope), wired to the raw-readings endpoint and
  declared in the OpenAPI document. Machine clients finally have a real
  credential path, and premium/internal rate-limit tiers became reachable.
- **Webhook admin CRUD** (`/api/admin/webhooks`): the delivery pipeline
  (retries, SSRF guards, bounded latency) was dead code — no route could
  register a target. Registration, listing (secrets omitted), delivery-log
  inspection, pause via `status: inactive`, delete.
- **HMAC-SHA256 delivery signatures**: `x-equipchain-signature:
  t=<ts>,v1=<hex>` over `<t>.<raw_body>` (Stripe-compatible scheme), so
  receivers can verify origin and defeat capture-and-replay. Secrets never
  travel in job payloads (they persist to disk snapshots); pause flag is
  honoured at delivery time.
- **User-facing `POST /api/auth/logout`**: server-side sign-out was
  admin-only; users' tokens kept authenticating after "logout". Any
  authenticated identity can now revoke its own `jti`.
- **Admin audit trail**: role grants — the actions that actually change who
  can access what — left no record. One capped, ordered trail now covers
  user create/role-change/deactivate and device lifecycle, readable via
  `GET /api/admin/audit` with `action`/`admin` filters; config changes
  mirror into it.
- **`equipchain_build_info` gauge** in `/metrics` (git SHA, deploy time)
  plus the first direct test coverage of the scrape output, including a fix
  for orphan HELP/TYPE lines when a gauge renders zero finite values.
- **CI**: concurrency group cancels superseded runs; the Docker image build
  gate now runs on pushes to main, not just PRs (an entry-point regression
  landed on main precisely because of that gap).
- **MIT `LICENSE` file** — README, package metadata, and the OpenAPI spec
  all claimed MIT, but the repository shipped no license text, which legally
  means *no* license grant.

### Changed
- **README rewritten against reality**: removed the phantom `/auth/login`
  `/auth/register` `/auth/refresh` routes, documented the real auth model
  (challenge flow, API keys, jti revocation), the full 24-route admin
  surface, webhook signature verification recipe, health-probe semantics,
  `/metrics`, runtime config keys, and an architecture section matching the
  actual tree and pipeline.
- **Dependencies**: in-range updates applied deliberately (zod 4.6.5,
  helmet 8.3.0, dotenv 17.4.2, csv-stringify, swagger-jsdoc,
  jsonwebtoken); the ESLint 10 / security-plugin 4 majors and OTel 0.x
  bumps stay pinned pending reviewed migration. Closes the intent of the
  four Dependabot PRs (#60–#63) without unreviewed merges.
- **Admin config store** accepts only whitelisted keys (unknown keys are
  ignored and reported in the audit entry), and `rateLimitPerMinute` is
  genuinely enforced as a live ceiling.

## Batch 4 — Revocation, real integrations, and kill-switches

- jti-based token revocation with a cache-backed denylist; server-side
  admin logout.
- Real billing from actual period consumption; real contract-state sync via
  a Soroban RPC adapter (mock fallback preserved for dev/test).
- Admin maintenance-mode kill-switch enforced on the public API surface
  (admin routes and health probes stay reachable).
- Brute-force guard on the token-minting endpoint (5/min per IP).
- Cache fail-fast to memory during Redis blips instead of hanging;
  `DependencyUnavailableError` maps outages to retryable 503s with
  `Retry-After`.
- Client-supplied correlation IDs sanitized and bounded (header-injection
  vector).
- Global cap on stored readings (stops unbounded heap growth beyond the
  retention sweeper); deploy identity (git SHA, deploy time) in the health
  payload; device-uniqueness 409; cache-aside for daily/monthly
  aggregations; cursor-paginated raw readings endpoint; event-loop lag
  gauge and RSS in the scrape output; security disclosure policy.
- Duplicate-email 409 on admin user creation (case-insensitive).

## Batch 3 — Hardening the request path and the queue

- Queue: per-job wall-clock timeouts with `AbortSignal`, backpressure cap
  with loud rejection, terminal-job eviction, file-backed persistence with
  atomic snapshots and crash recovery.
- Security: HS256 pinned on JWT verification (algorithm-confusion),
  prototype-pollution keys stripped post-parse, wildcard log-redaction
  paths (nested credential leaks), explicit Helmet policy, bounded request
  lifecycle timeouts, configurable trust proxy.
- Auth: real JWTs minted in the challenge flow and verified on protected
  routes (previously any Bearer string worked).
- Gzip compression for analytics payloads and exports; business gauges for
  queue depth/schedules/cache pressure; file-backed queue durability in
  container deployments; WebSocket JWT handshakes and subscription
  validation; readiness flips to 503 the moment shutdown begins; CI
  hardened (SHA-pinned Actions, least-privilege permissions, Node matrix,
  lint gate, dependency audit, Docker image check); Dependabot enabled;
  bounded in-memory cache fallback; `.nvmrc` + engines pin; Docker
  `HEALTHCHECK`; single-flight `getOrSet` (stampede protection); `SCAN`
  replaces `KEYS`.

## Batch 2 — Correctness under failure

- Strict analytics query validation (invalid dates no longer silently
  coerced); standardized error envelope with no internal message leakage;
  liveness/readiness split with dependency checks; OpenAPI spec poisoning
  fixed and all system endpoints documented; graceful shutdown that
  actually completes (signal-handler TDZ bug, hung keep-alive sockets,
  tracing shutdown re-entry).
- Memory safety: capped rate-limit counter store, capped config audit log,
  hourly retention sweeper for readings, chunked scheduler intervals
  (Node's 2^31-1ms timer clamp), queue history eviction, oversized/malformed
  reading batches rejected at ingest.
- ESLint 9 flat-config migration (zero errors); CI workflow with lint gate
  and dependency audit; cache-aside warming for fleet-summary; real
  daily/monthly reports from actual readings.

## Batch 1 — Foundation: real auth, real docs, real tests

- Consolidated two divergent Express apps into one canonical `src/app.js`;
  real JWT auth and role checks on export endpoints (previously any Bearer
  token — including the admin-only system report); real HTTP webhook
  delivery replacing a simulated placeholder.
- Streaming exports (CSV/JSON/NDJSON) with field whitelisting; cursor +
  offset pagination utility with sort/filter/search whitelists; offset and
  keyset pagination across list endpoints.
- Zod request validation schemas; Redis caching layer; OpenAPI 3 spec +
  Swagger UI; repository layer restored after the unfinished TypeScript
  migration; missing dependencies declared; missing test files repaired;
  all pre-existing test failures resolved; k6 load-test scenarios aligned
  with the actual auth behavior.

## Housekeeping (across batches)

- The legacy `index.js` entry point routes through the full server path
  (`src/server.js`) instead of a degraded `app.listen()` that skipped every
  background service; process handlers install on start, not at require
  time; OTel shutdown folded into the ordered exit path.
- Test suite: 548 → 605+ tests across unit, integration, and
  end-to-end-boot coverage; every improvement ships with the test that pins
  it.
