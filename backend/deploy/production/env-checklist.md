# Production Environment Checklist

Run `npm run env:check` against the production `.env` before every deploy. It fails the
build when any blocking item below is unmet. Secrets are never committed; store them in
the platform secret manager and inject at deploy time.

## Blocking (deploy fails)

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Present, points at the production Postgres, TLS enforced. |
| `REDIS_URL` | Present, points at the production Redis. |
| `CORS_ALLOWED_ORIGINS` | Explicit production origins only. No `*`. |
| `STORAGE_SIGNING_SECRET` | Strong random value, NOT the dev default. |
| `SHIPPING_WEBHOOK_SECRET` | Strong random value, NOT the dev default. Matches the value configured at the payment provider. |

## Recommended (warnings)

- `STORAGE_SIGNING_SECRET` / `SHIPPING_WEBHOOK_SECRET` ≥ 24 chars.
- `READY_REQUIRES_DATABASE` and `READY_REQUIRES_REDIS` left `true` so `/ready` reflects real outages to the load balancer.
- `CORS_ALLOWED_ORIGINS` contains no `localhost` / `127.0.0.1`.
- Feature flags (`FEATURE_*`) set intentionally for the launch (default `true`).
- `RISK_COUPON_ABUSE_ENABLED` decided explicitly (default `false`).

## Storage & payments

- `STORAGE_DRIVER` set to the production object-store driver; `STORAGE_BUCKET` is a real private bucket with no public ACL.
- `STORAGE_PUBLIC_BASE_URL` is the production host so signed URLs resolve.
- `SHIPPING_QUOTE_TTL_SECONDS` and `STORAGE_SIGNED_URL_TTL_SECONDS` reviewed for production.

## Sign-off

- [ ] `npm run env:check` passes with zero errors.
- [ ] Warnings reviewed and accepted.
- [ ] Secrets sourced from the secret manager, not the repo.
