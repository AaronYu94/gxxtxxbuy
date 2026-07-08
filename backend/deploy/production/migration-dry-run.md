# B8-03 Migration Dry Run

Destructive migrations must never go straight to production. The migration runner is
already checksum-guarded (an applied migration whose file changes fails), and every
migration uses `create table if not exists` / `drop trigger` idempotent recreates.

## Flow

1. **Scan** — `npm run migrate:dry-run`. Lists every migration with a short checksum and
   flags destructive DDL (`drop table`, `drop column`, `truncate`, `drop constraint`,
   `drop schema`, `alter column type`, unqualified `delete`). Exits non-zero if any are
   found. `drop trigger` / `drop index` recreations are allowed.
2. **Staging apply** — apply on staging first:
   ```bash
   DATABASE_URL=<staging> npm run migrate
   DATABASE_URL=<staging> npm run migrate:status
   ```
3. **Verify** — run `npm run smoke` against staging.
4. **Production apply** — only after staging is green:
   ```bash
   DATABASE_URL=<prod> npm run migrate
   ```

## Rules

- A destructive migration requires an explicit reviewed plan (expand/contract): ship the
  additive change, deploy code that stops using the old column, then drop it in a later
  migration.
- Never edit an already-applied migration file — add a new numbered one.
- Take a fresh `npm run db:backup` immediately before any production migration.
