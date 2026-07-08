# GOATEDBUY Production Deployment (B8)

This directory holds the production deployment, migration, and stability playbooks for
the B8 phase. Every document here is a checklist/runbook; the executable pieces are npm
scripts in `backend/package.json`.

## Executable checks

| Command | Task | Purpose |
| --- | --- | --- |
| `npm run env:check` | B8-01 | Validate a production `.env` is complete and free of dev-default secrets. Exits non-zero on blocking findings. |
| `npm run db:backup` | B8-02 | `pg_dump -Fc` a compressed, restorable backup to `$BACKUP_DIR`. |
| `npm run migrate:dry-run` | B8-03 | List migrations and block destructive DDL from reaching production without review. |
| `npm run smoke` | B8-05 | End-to-end smoke of client + admin critical paths against `SMOKE_BASE_URL`. |

## Feature flags (B8-07)

Canary/kill switches, all default `true`, flip without a deploy:

- `FEATURE_PAYMENTS_ENABLED` — `POST /shipping-payments`
- `FEATURE_SHIPPING_ENABLED` — `POST /parcels/draft`, `POST /parcels`
- `FEATURE_COUPONS_ENABLED` — `POST /coupons/redeem-code`, `POST /checkout/apply-coupon`
- `FEATURE_CREATORS_ENABLED` — `POST /creator-campaign/touch`, `GET /creator/dashboard`

A disabled route returns `503` with `error.details.code = "FEATURE_DISABLED"`.

## Documents

- [env-checklist.md](./env-checklist.md) — B8-01 production env matrix
- [backup-and-restore.md](./backup-and-restore.md) — B8-02 backup + restore drill
- [migration-dry-run.md](./migration-dry-run.md) — B8-03 staging dry-run flow
- [frontend-config.md](./frontend-config.md) — B8-04 API base URL switching
- [monitoring-and-alerts.md](./monitoring-and-alerts.md) — B8-06 alerts
- [rollback-runbook.md](./rollback-runbook.md) — B8-08 rollback by layer
- [security-regression-checklist.md](./security-regression-checklist.md) — B8-09 P0 security
- [release-report-template.md](./release-report-template.md) — B8-10 release retro
