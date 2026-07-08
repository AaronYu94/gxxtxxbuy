# B8-02 Database Backup & Restore

## Backup

Automated daily plus pre-deploy on-demand:

```bash
DATABASE_URL=postgres://... BACKUP_DIR=/secure/backups npm run db:backup
```

- Uses `pg_dump -Fc` (custom compressed format) → restorable with `pg_restore`.
- `--no-owner --no-privileges` so dumps restore cleanly into a fresh role.
- Output: `goatedbuy-<ISO-timestamp>.dump`.

### Requirements

- Backups are written to encrypted-at-rest storage (KMS/SSE). The dump file itself must
  land only on an encrypted volume or bucket — never an unencrypted local disk on a
  shared host.
- Retention: 7 daily, 4 weekly, 6 monthly. Lifecycle-expire the rest.
- The connection string is passed as a `pg_dump` argument only and never logged.

## Restore drill (must be rehearsed before launch)

Restore into a scratch database, never straight over production:

```bash
createdb goatedbuy_restore_test
pg_restore --no-owner --no-privileges -d goatedbuy_restore_test goatedbuy-<timestamp>.dump
DATABASE_URL=postgres://.../goatedbuy_restore_test npm run migrate:status   # expect all applied
```

- [ ] Restore completes with no errors.
- [ ] `migrate:status` shows the expected migrations applied.
- [ ] Row counts on key tables (users, purchase_orders, parcels, wallets) are sane.
- [ ] A smoke login works against the restored DB.

## RPO / RTO

- RPO: ≤ 24h from daily backups; point-in-time recovery via managed Postgres WAL if enabled.
- RTO: restore drill timing documented here after each rehearsal.
