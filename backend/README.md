# GOATEDBUY Backend

This folder contains the production backend foundation for GOATEDBUY.

## Completed Scope

- B0-01: backend project skeleton, scripts, and README.
- B0-02: environment loader and schema validation.
- B0-03: `/health`, `/ready`, and `/version`.
- B0-04: PostgreSQL pool client with timeout and redaction.
- B0-05: SQL migration runner.
- B0-06: base schema migration and migration metadata.
- B0-07: local Docker Compose for app, PostgreSQL, and Redis.
- B0-08: Redis client and queue abstraction.
- B0-09: standard error response middleware.
- B0-10: request logger with request id and sensitive header redaction.
- B0-11: OpenAPI document served at `/openapi.json` and validated in CI.
- B0-12: Node test runner with system, env, error, and OpenAPI tests.
- B0-13: backend CI workflow for lint, OpenAPI check, tests, and build check.
- B0-14: minimal staging smoke deploy script and Docker staging rollback path.
- B1-01 to B1-16: user/admin identity, password hashing, sessions, auth APIs, RBAC, audit logs, permission seed, and auth/RBAC regression tests.
- B2-01 to B2-15: saved links, marketplace recognition, parse queue handoff, My Haul, purchase orders, order history, Trust Center policies, CORS, and client API adapter.
- B3-01 to B3-13: private storage adapter, signed QC photo URLs, warehouse receiving, item weight, 3-5 QC photo upload, user QC approval, extra-photo requests, 90-day storage status, and client QC/storage API adapter.
- B4-01 to B4-15: shipping lines/import, parcel draft/submit, quote preview, shipping payments, signed payment webhook, tracking events, admin shipment status, and client Shipping API adapter.
- B5-01 to B5-13: wallets, wallet transactions, coupon definitions, user coupons, code redemption, Welcome Gift, checkout coupon locks, payment failure rollback, admin coupon creation, admin credit adjustment, and client Wallet API adapter.
- B6-01 to B6-10: permission-scoped Admin Console overview, order queue/status/exception APIs, warehouse queue, parcel queue with finance redaction, Policy CMS list/update APIs, admin frontend API adapter, and admin permission regression tests.
- B7-01 to B7-15: creators/campaigns/attribution with a public touch endpoint and aggregate-only creator dashboard, Haul Stories with a content moderation queue and author withdraw, risk cases with legal transitions and a disabled-by-default coupon-abuse scan, a public Country Shipping Hub with expiry flagging, and the creator/content/risk frontends.
- B8-01 to B8-10: production env checklist (`env:check`), database backup (`db:backup`) and restore drill, migration dry-run (`migrate:dry-run`), frontend API base URL switching, production smoke test (`smoke`), monitoring/alerts, feature-flag kill switches, rollback runbook, P0 security regression checklist, and release report template. See `deploy/production/`.

## Local Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

The service starts even when PostgreSQL or Redis is not configured. In that state:

- `GET /health` returns `200` because the process is alive.
- `GET /ready` returns `503` with explicit dependency failure reasons.

## Docker Compose

```bash
cd backend
docker compose up --build
```

Default local ports are chosen to avoid common conflicts:

- API: `3001 -> 3000`
- PostgreSQL: `5433 -> 5432`
- Redis: `6380 -> 6379`

Override them when needed:

```bash
APP_PORT=3011 POSTGRES_PORT=5441 REDIS_PORT=6391 docker compose up --build
```

Reset local data volumes:

```bash
docker compose down -v
```

## Health Checks

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
curl http://127.0.0.1:3000/version
curl http://127.0.0.1:3000/openapi.json
```

## OpenAPI

```bash
cd backend
npm run openapi:check
```

The OpenAPI document is maintained in `src/openapi/document.js` and served from `GET /openapi.json`.

## Auth And RBAC

Client auth:

```bash
curl -X POST http://127.0.0.1:3000/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"buyer@example.com","password":"CorrectHorse123"}'

curl -X POST http://127.0.0.1:3000/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"buyer@example.com","password":"CorrectHorse123"}'
```

Admin auth:

```bash
curl -X POST http://127.0.0.1:3000/admin/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"ops@example.com","password":"AdminPass123"}'
```

Session endpoints:

- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `POST /admin/auth/refresh`
- `POST /admin/auth/logout`
- `GET /admin/me`

RBAC roles and permissions are seeded by migration `000004_rbac.sql`. To re-run the idempotent seed against an existing database:

```bash
cd backend
npm run seed:rbac
```

## Client Core APIs

All client core APIs except `GET /policies` require a user Bearer token.

```bash
curl -X POST http://127.0.0.1:3000/links \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"url":"https://item.taobao.com/item.htm?id=1"}'

curl -X PATCH http://127.0.0.1:3000/links/$LINK_ID \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"title":"Sneaker","spec":"Black / 42","price":38.5,"quantity":1}'

curl -X POST http://127.0.0.1:3000/links/$LINK_ID/add-to-haul \
  -H "authorization: Bearer $ACCESS_TOKEN"

curl -X POST http://127.0.0.1:3000/purchase-orders \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"haul_item_id":"'$HAUL_ITEM_ID'"}'
```

Published policies are public and return fallback policy copy if the CMS table is empty or unavailable:

```bash
curl http://127.0.0.1:3000/policies
```

The static client at `app/client.html` can connect to these APIs from `http://127.0.0.1:8080` via the configured CORS allowlist.

## Warehouse And QC APIs

Admin warehouse/QC APIs require an admin Bearer token with `warehouse:write`.

```bash
curl -X POST http://127.0.0.1:3000/admin/warehouse/items/$PURCHASE_ORDER_ID/receive \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"storage_location":"A1-02"}'

curl -X PATCH http://127.0.0.1:3000/admin/warehouse/items/$WAREHOUSE_ITEM_ID/weight \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"weight_kg":1.25}'
```

QC photo upload expects 3-5 base64-encoded JPEG, PNG, or WebP photos. Files are stored privately and returned through short-lived signed URLs.

```bash
curl -X POST http://127.0.0.1:3000/admin/qc/items/$WAREHOUSE_ITEM_ID/photos \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"photos":[{"file_name":"front.jpg","content_type":"image/jpeg","size_bytes":10,"data_base64":"dGlueSBpbWFnZQ=="},{"file_name":"back.jpg","content_type":"image/jpeg","size_bytes":10,"data_base64":"dGlueSBpbWFnZQ=="},{"file_name":"tag.jpg","content_type":"image/jpeg","size_bytes":10,"data_base64":"dGlueSBpbWFnZQ=="}]}'
```

Client QC/storage APIs require the user Bearer token and are scoped to the current user:

- `GET /qc/items`
- `POST /qc/items/:id/approve`
- `POST /qc/items/:id/extra-photo`
- `GET /warehouse/items/:id/storage`

Private photo bytes are served only through signed URLs at `GET /storage/private/:key?expires=...&signature=...`.

## Shipping And Parcels

After migrations, seed default shipping lines or import a JSON array of lines:

```bash
cd backend
npm run shipping-lines:import
npm run shipping-lines:import ./my-150-lines.json
```

Client shipping APIs require a user Bearer token:

```bash
curl http://127.0.0.1:3000/shipping-lines

curl -X POST http://127.0.0.1:3000/parcels/draft \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"warehouse_item_ids":["'$WAREHOUSE_ITEM_ID'"]}'

curl -X POST http://127.0.0.1:3000/shipping/preview \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"parcel_id":"'$PARCEL_ID'","country":"United States","dimensions_cm":{"length_cm":30,"width_cm":20,"height_cm":12}}'

curl -X POST http://127.0.0.1:3000/parcels \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"parcel_id":"'$PARCEL_ID'","quote_id":"'$QUOTE_ID'","address":{"recipient_name":"Buyer One","line1":"100 Market Street","city":"San Francisco","region":"CA","postal_code":"94105","country":"United States","phone":"+14155550123"}}'

curl -X POST http://127.0.0.1:3000/shipping-payments \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "idempotency-key: ship-pay-001" \
  -d '{"parcel_id":"'$PARCEL_ID'"}'
```

Payment webhooks are signed with `SHIPPING_WEBHOOK_SECRET` and deduped by `event_id`.

Tracking and admin shipment operations:

- `GET /parcels`
- `GET /parcels/:id/tracking`
- `PATCH /admin/parcels/:id/status` with admin `shipping:write`

## Wallet And Coupons

Client wallet/coupon APIs require a user Bearer token:

```bash
curl http://127.0.0.1:3000/wallet \
  -H "authorization: Bearer $ACCESS_TOKEN"

curl -X POST http://127.0.0.1:3000/coupons/redeem-code \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"code":"SHIP8"}'

curl -X POST http://127.0.0.1:3000/welcome-gift/claim \
  -H "authorization: Bearer $ACCESS_TOKEN"

curl -X POST http://127.0.0.1:3000/checkout/apply-coupon \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"parcel_id":"'$PARCEL_ID'","user_coupon_id":"'$USER_COUPON_ID'"}'
```

`POST /checkout/apply-coupon` only locks the coupon and updates the backend parcel final fee. If a signed shipping payment webhook reports `failed` or `cancelled`, the coupon lock is rolled back idempotently and the parcel returns to the original final fee.

Admin coupon and credit APIs:

```bash
curl -X POST http://127.0.0.1:3000/admin/coupons \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"code":"SHIP8","title":"Shipping $8","amount":8,"eligible_shipping_line_codes":["US-BALANCED-AIR"]}'

curl -X PATCH http://127.0.0.1:3000/admin/wallets/$USER_ID/credit \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"amount_cents":500,"reason":"Support credit"}'
```

Welcome Gift is controlled by `WELCOME_GIFT_ENABLED`, `WELCOME_GIFT_CODE`, and `WELCOME_GIFT_AMOUNT_CENTS`.

## Admin Console APIs

Admin Console APIs require an admin Bearer token and return only data visible to that admin's permissions.

```bash
curl http://127.0.0.1:3000/admin/overview \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN"

curl "http://127.0.0.1:3000/admin/orders?status=submitted&limit=25&offset=0" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN"

curl -X PATCH http://127.0.0.1:3000/admin/orders/$ORDER_ID/status \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"status":"purchasing","external_order_no":"TB123","reason":"buyer paid"}'

curl -X PATCH http://127.0.0.1:3000/admin/orders/$ORDER_ID/exception \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"reason":"seller refund pending"}'

curl "http://127.0.0.1:3000/admin/warehouse/items?status=qc_ready" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN"

curl "http://127.0.0.1:3000/admin/parcels?status=shipping_due" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN"

curl http://127.0.0.1:3000/admin/policies \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN"

curl -X PATCH http://127.0.0.1:3000/admin/policies/$POLICY_ID \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -d '{"title":"Storage policy","body":"90 days free storage after warehouse arrival.","status":"published"}'
```

Order status updates require `orders:write` and write both `order_status_history` and audit logs. Order exceptions require `orders:write` or `support:write`. Parcel queue responses are redacted for support-only admins and do not expose final fee or payment fields.

## Migrations

```bash
cd backend
npm run migrate
npm run migrate:status
```

`npm run migrate` requires `DATABASE_URL`. The runner creates `schema_migrations`, checks file checksums, and fails if an already-applied migration changes.

## Verification

```bash
cd backend
npm test
npm run lint
npm run build
npm run ci
npm run healthcheck
```

`npm run healthcheck` expects the service to be running. Use `HEALTHCHECK_URL` to point it at another host.

## Staging

Minimal B0 staging smoke deploy:

```bash
cd backend
npm run staging:smoke
```

Default staging URL:

```text
http://127.0.0.1:3091
```

The smoke command starts a staging-mode service, verifies `/health` and `/version`, writes a deployment report, then stops the temporary process.

Docker staging deploy and rollback are documented in `deploy/staging/README.md`.
