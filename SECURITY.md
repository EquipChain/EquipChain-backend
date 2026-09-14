# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub Security Advisories ("Report a vulnerability" on
the Security tab), or contact the maintainers directly. Include:

- A description of the vulnerability and its impact
- Steps to reproduce (PoC script or request sequence is ideal)
- Affected endpoints/components and the environment you tested against

You will receive an acknowledgment within 72 hours. We aim to triage severity
within one week and will keep you informed of fix progress. Once a fix is
released, we will credit reporters in the release notes unless you prefer to
remain anonymous.

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` (latest) | Yes |
| Older tags/branches | No — upgrade |

This service deploys from `main`; run the latest release or trunk.

## Security Model Notes

- **JWT secret**: `JWT_SECRET` is required in production (>= 32 chars, enforced
  at boot). Tokens are HS256 only; verification pins the algorithm to prevent
  algorithm-confusion forgeries.
- **Token revocation**: admin tokens support server-side revocation by `jti`
  (`POST /api/admin/logout`); the denylist lives in the cache with
  token-lifetime TTLs.
- **Rate limiting**: tiered per-identity limiter on all `/api` routes plus a
  dedicated 5/min brute-force guard on the token-minting endpoint.
- **Maintenance mode**: admin-configurable kill-switch that 503s the public
  API while keeping `/api/admin` and health endpoints reachable for recovery.
- **Body hardening**: prototype-pollution keys are stripped from JSON bodies
  at the boundary; request bodies are size-capped; correlation IDs are
  sanitized before echo/log.
- **Logs**: Pino redaction strips credentials (including nested and
  hyphenated header keys) from every log line.

If you find any of these guarantees violated, that is a security bug — please
report it.
