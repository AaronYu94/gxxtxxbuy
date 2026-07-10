# GOATEDBUY Production Deployment

This directory holds the production deployment, migration, and stability playbooks. Every
document here is a checklist/runbook; the executable pieces are npm
scripts in `backend/package.json`.

## Executable checks

| Command | Task | Purpose |
| --- | --- | --- |
| `npm run env:check` | Environment | Validate a production `.env` is complete and free of dev-default secrets. Exits non-zero on blocking findings. |
| `npm run db:backup` | Backup | `pg_dump -Fc` a compressed, restorable backup to `$BACKUP_DIR`. |
| `npm run migrate:dry-run` | Migration | List migrations and block destructive DDL from reaching production without review. |
| `npm run smoke` | Smoke | End-to-end smoke of client + admin critical paths against `SMOKE_BASE_URL`. |

## Feature flags

Canary/kill switches, all default `true`, flip without a deploy:

- `FEATURE_PAYMENTS_ENABLED` — `POST /shipping-payments`
- `FEATURE_SHIPPING_ENABLED` — `POST /parcels/draft`, `POST /parcels`
- `FEATURE_COUPONS_ENABLED` — `POST /coupons/redeem-code`, `POST /checkout/apply-coupon`
- `FEATURE_CREATORS_ENABLED` — `POST /creator-campaign/touch`, `GET /creator/dashboard`

A disabled route returns `503` with `error.details.code = "FEATURE_DISABLED"`.

## Documents

- [env-checklist.md](./env-checklist.md) — production environment matrix
- [backup-and-restore.md](./backup-and-restore.md) — backup and restore drill
- [migration-dry-run.md](./migration-dry-run.md) — staging migration dry-run flow
- [frontend-config.md](./frontend-config.md) — API base URL switching
- [monitoring-and-alerts.md](./monitoring-and-alerts.md) — alerts
- [rollback-runbook.md](./rollback-runbook.md) — rollback by layer
- [security-regression-checklist.md](./security-regression-checklist.md) — security regression
- [release-report-template.md](./release-report-template.md) — release report
