# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GOATEDBUY is a Chinese-marketplace shopping-agent ("daigou") platform. Users paste product links (Taobao, 1688, Weidian/Micro, Yupoo), the operation buys the items, receives them into a warehouse, does QC photography, then consolidates them into parcels for international shipping. The platform also handles wallets, coupons, and Trust Center policy content.

The repo has three distinct layers:

1. **`backend/`** — the real production backend (Node 22, Express 5, PostgreSQL, Redis). This is the only part with automated tests and CI.
2. **`app/`** — a static browser frontend (vanilla JS + `localStorage`) with two surfaces: a client workspace and an admin console. It can run fully offline against browser storage, or connect to the backend APIs.
3. **Current product execution line** — `PRD/GoatedBuy_开发级详细PRD_V2.0.pdf`, `PRD_V2_开发原子任务.md`, `V2-00_需求冻结与现状基线/`, `prd-v2-task-status.json`, and `prd-v2-checklist.html`.

Most engineering work happens in `backend/`.

`PRD_V2_开发原子任务.md` is the only implementation roadmap. Do not recreate or rely on removed legacy roadmaps. A task is officially complete only after its ID is recorded in `prd-v2-task-status.json` with verification notes.

## Commands

All backend commands run from `backend/`:

```bash
npm run dev            # node --watch src/server.js
npm start              # production start
npm test               # node --test tests/*.test.js
npm run lint           # syntax-only check (node --check on every .js file); NOT eslint
npm run openapi:check  # validate src/openapi/document.js against served /openapi.json
npm run build          # build-check.mjs (no bundler; validates the build)
npm run ci             # lint + openapi:check + test + build  (mirror of GitHub CI)
```

Run a single test file:

```bash
node --test tests/wallet.test.js
```

Database / seeds (require `DATABASE_URL`):

```bash
npm run migrate                 # apply SQL migrations in migrations/, checksum-guarded
npm run migrate:status
npm run seed:rbac               # idempotent RBAC roles/permissions seed
npm run shipping-lines:import [file.json]   # seed shipping lines
npm run db:ping / npm run redis:ping
npm run healthcheck             # expects a running service; override with HEALTHCHECK_URL
npm run migrate:dry-run         # preview pending migrations without applying
```

Worker and operational/deploy scripts:

```bash
npm run worker:parse            # product-parse worker (Redis consumer; scripts/parse-worker.mjs)
npm run env:check               # validate production env (scripts/check-production-env.mjs)
npm run db:backup               # DB backup helper
npm run smoke                   # production smoke tests (scripts/production-smoke.mjs)
npm run staging:smoke           # staging smoke; npm run staging:rollback to roll back a staging deploy
```

Docker (from `backend/`): `docker compose up --build`. Non-default host ports avoid conflicts — API `3001→3000`, Postgres `5433→5432`, Redis `6380→6379`. Reset volumes with `docker compose down -v`.

Frontend (from repo root): `python3 -m http.server 8080 --bind 127.0.0.1`, then open `http://127.0.0.1:8080/app/` (surface switcher), `/app/client.html`, or `/app/admin.html`. There is no build step for the frontend.

## Backend architecture

Express app is assembled in `src/app.js` via `createApp(options)`. `src/server.js` only wires lifecycle (listen + graceful shutdown). **`createApp` takes a fully overridable options bag** — every repository, service, storage adapter, and dependency check can be injected. This is the core testability seam: tests build the app with in-memory repositories from `tests/helpers/memory-*-repository.js` and never touch a real database.

Each domain follows the same three-layer shape:

- **route** (`src/routes/*.js`) — HTTP parsing, auth/permission guards, calls the service.
- **service** (`src/<domain>/<domain>-service.js`) — business logic, orchestration, audit logging.
- **repository** (`src/<domain>/<domain>-repository.js`) — a `createPg<Domain>Repository(env)` factory holding all SQL. Every repository has a matching in-memory test double.

Domains: `auth`, `admin` (admin console queues + policy CMS), `core` (saved links, marketplace recognition, My Haul, purchase orders, policies), `warehouse` (receiving, QC photos, storage), `shipping` (lines, parcels, quotes, payments, tracking), `wallet` (wallets, coupons, welcome gift), `parsing` (marketplace URL recognition + async product-parse worker), `content` (haul-story CMS + moderation), `creators` (creator/affiliate campaigns), `risk` (risk cases + review queue), `country` (country config + shipping hub). Cross-cutting: `middleware/` (cors, auth, error-handler, request-logger), `security/` (password hashing, tokens), `audit/`, `rbac/`, `storage/` (private storage + signed URLs), `queue/` (Redis abstraction), `errors/app-error.js`.

Note: `parsing/` follows a slightly different shape from the route→service→repository domains — it holds `product-ref.js`/`product-source.js` (recognition + data source) and `parse-worker.js`. Its HTTP surface is folded into `core` (saved links / marketplace recognition) rather than a dedicated route file.

Key conventions:

- **Config** flows through a single `env` object from `src/config/env.js` (`createEnv`/`parseEnv`). Do not read `process.env` directly in domain code — thread `env` through. See `.env.example` for the full variable list (storage, shipping webhook secret, welcome gift, DB/Redis timeouts, `READY_REQUIRES_*`).
- **Auth**: client users and admin users are separate identity systems (`/auth/*` vs `/admin/auth/*`, separate DB tables). Bearer access tokens; refresh/logout endpoints. Admin routes gate on named permissions (e.g. `orders:write`, `warehouse:write`, `shipping:write`, `support:write`) seeded by migration `000004_rbac.sql`.
- **Data scoping**: client APIs are strictly scoped to the current user. Admin queue responses are **redacted by permission** — e.g. support-only admins get parcel data with finance/payment fields stripped.
- **Errors**: throw `AppError` (`src/errors/app-error.js`); `middleware/error-handler.js` renders the standard response shape. `notFoundHandler` and `errorHandler` are the last middleware in `app.js`.
- **OpenAPI is hand-maintained** in `src/openapi/document.js` and served at `/openapi.json`. `npm run openapi:check` fails CI if the served doc drifts — update the document when you add/change routes.
- **Degraded startup**: the service starts even without Postgres/Redis. `/health` returns 200 (process alive); `/ready` returns 503 with explicit per-dependency failure reasons.
- **Migrations** are checksum-guarded: editing an already-applied migration file fails the runner. Add a new numbered migration instead of editing an old one.
- **Money** is handled in cents (`*_cents`) in wallet/coupon paths.
- **Async parsing**: pasted marketplace links are recognized in `src/parsing/` and enqueued to Redis; the parse worker (`npm run worker:parse`) consumes jobs and fills product details. The data source is currently `createPlaceholderProductSource()` in `src/parsing/product-source.js` — a deterministic stub that must be replaced under `V2-03` with a real, licensed marketplace provider before real transactions.
- Coupon locks and shipping payments are idempotent: `POST /checkout/apply-coupon` only locks; a signed webhook (`SHIPPING_WEBHOOK_SECRET`, deduped by `event_id`) reporting `failed`/`cancelled` rolls the lock back.

`npm run lint` is intentionally a syntax check, not a style linter — there is no eslint/prettier config. Match the existing code style (ES modules, `createX` factory functions, no default exports for factories).

## Frontend architecture

`app/app.js` (client) and `app/admin.js` (admin) are single-file vanilla-JS apps that render into `client.html`/`admin.html` and share `styles.css`. State lives in `localStorage` under versioned keys (e.g. `goatedbuy-workspace-v1`, `goatedbuy-client-api-v1`). Each app can run purely on local storage as a demo, or point at the backend by configuring an API base URL and logging in. The client stores only user session/API state; the admin console stores only admin session state and pulls operational data from role-gated backend APIs. CORS for the frontend origin is controlled by `CORS_ALLOWED_ORIGINS`.

The root `index.html` redirects to the current PRD V2.0 checklist (unrelated to the `app/` build).

## CI

`.github/workflows/backend-ci.yml` runs only on changes under `backend/`. It runs `lint → openapi:check → test → build` on Node 22. Run `npm run ci` locally before pushing backend changes to reproduce it exactly.
