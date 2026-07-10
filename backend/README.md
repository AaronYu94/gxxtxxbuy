# GOATEDBUY Backend

This folder contains the production backend foundation for GOATEDBUY.

## Current Baseline

- Node.js service foundation, environment validation, health/readiness/version endpoints, PostgreSQL migrations, Redis queues, structured errors, request logging, OpenAPI, tests, CI, Docker Compose, and staging smoke tooling.
- Separate user and employee identity systems with email/device verification, password hashing, sessions, RBAC, TOTP, audit logs, permission seeds, and regression tests.
- Versioned buyer profiles, display preferences, owner-scoped multi-address CRUD, password rotation, deletion eligibility, and asynchronous PII anonymization.
- Saved links, marketplace recognition, parsing queue, haul items, purchase orders, order history, policy content, CORS, and client API integration.
- Private storage, signed QC URLs, warehouse receiving, weight, QC upload and approval, extra-photo requests, and storage status.
- Shipping lines, parcels, quote calculation, shipping payments, signed webhooks, tracking, and admin shipment operations.
- Wallets, transactions, coupons, welcome gifts, coupon locks and rollback, and finance adjustments.
- Permission-scoped admin queues, policy management, risk cases, content moderation, creator attribution, and country shipping content.
- Production environment checks, backup and restore guidance, migration dry runs, smoke tests, monitoring, feature flags, rollback, security checks, and release reporting. See `deploy/production/`.

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

## Buyer Account And Addresses

V2 account endpoints use the `{ data, meta }` response envelope and require a user Bearer token:

- `GET /api/v2/account`
- `PATCH /api/v2/account` with `expected_version`
- `POST /api/v2/account/password`
- `GET` and `POST /api/v2/addresses`
- `PATCH` and `DELETE /api/v2/addresses/:addressId`
- `GET /api/v2/account/deletion-eligibility`
- `POST /api/v2/account/deletion-requests`

Profiles and addresses use optimistic versions. Address reads are owner-scoped, normalized fingerprints never leave the service, and one database index enforces at most one default address per buyer. Parcels retain their immutable address JSON snapshot after a saved address is changed or removed.

Deletion requests are rejected while a wallet balance, warehouse item, active order, active parcel, or active after-sales case exists. Eligible requests revoke sessions immediately and are processed asynchronously:

```bash
cd backend
npm run worker:account-deletion
```

The worker anonymizes account/address PII while preserving order, money, parcel, and immutable audit records.

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
