# GOATEDBUY V2 Engineering Handoff

Generated: 2026-07-09 21:00 PDT

## 1. Source Of Truth

- Product baseline: `PRD/GoatedBuy_开发级详细PRD_V2.0.pdf`
- Atomic roadmap: `PRD_V2_开发原子任务.md`
- Official completion state: `prd-v2-task-status.json`
- Interactive checklist: `prd-v2-checklist.html`
- Frozen V2 baseline and decisions: `V2-00_需求冻结与现状基线/`

Do not recreate or use removed V1/P0-P4 roadmaps. A task is complete only after implementation, verification, and an evidence note are added to `prd-v2-task-status.json`.

## 2. Current State

- Branch: `main`
- HEAD: `a9757fd` (`Add engineering handoff`)
- Official V2 progress: **35/214**, blocked: **0**
- Completed phases: **V2-00 (10/10), V2-01 (15/15), V2-02 (10/10)**
- Next phase: **V2-03 - Link parsing and product snapshots**
- Worktree: intentionally dirty with the current V2 implementation and deletion of the obsolete execution line. Do not reset, restore, or checkout deleted legacy files.

The repository has not been committed after V2-00 through V2-02. Before any future commit, inspect `git status --short` and stage only the intended current-line files.

## 3. V2-02 Delivered

### Frontend foundation

- Validated public runtime configuration in `app/config.js` and `app/runtime-config.js`.
- Restorable hash routes and guarded session shell in `app/app.js`.
- Registration, email verification, login, device verification, account settings, password, address, and deletion flows.
- Eight-locale framework with English fallback and missing-key diagnostics in `app/i18n.js`.
- Exact integer-minor-unit display formatting in `app/currency.js`.
- Responsive loading, empty, error, and conflict states in `app/styles.css`.
- Tokens are kept in `sessionStorage`; profile and address PII is not persisted by the frontend.

Only `en-US` is enabled. The eight locale slots exist, but `GB-DEC-P1-001` is still pending and other languages must not be described as launched.

### Backend account foundation

- Migration `000015_user_accounts_addresses.sql` adds versioned profiles, owner-scoped addresses, one-default uniqueness, parcel address references, and deletion requests.
- `/api/v2/account` profile/preferences/password/deletion APIs.
- `/api/v2/addresses` ownership-scoped CRUD with optimistic locking and soft deletion.
- Address fingerprints are HMAC-derived and never returned to the client.
- Parcel address JSON remains an immutable historical snapshot after a saved address changes or is deleted.
- Deletion eligibility checks wallet, warehouse, active orders, parcels, and after-sales cases when that future table exists.
- `npm run worker:account-deletion` asynchronously anonymizes PII while retaining business and immutable audit records.
- Stale address writes return `409` without changing the existing default address.

Key implementation files:

- `backend/src/account/account-service.js`
- `backend/src/account/account-repository.js`
- `backend/src/routes/account.js`
- `backend/scripts/account-deletion-worker.mjs`
- `backend/migrations/000015_user_accounts_addresses.sql`
- `backend/src/openapi/document.js`

## 4. Verification Evidence

Latest full verification:

- Syntax lint: **121 files passed**
- OpenAPI: **3.1.0, 79 paths passed**
- Automated tests: **68/68 passed**
- Build check: passed
- PostgreSQL: migrations `000001` through `000015` applied to `goatedbuy_local_v2`
- Real PostgreSQL regression: stale address update returned `409`; exactly one original default remained
- Real PostgreSQL regression: parcel address snapshot survived saved-address soft deletion
- Deletion worker regression: PII anonymized, request completed, sessions revoked, audit preserved
- Browser regression: registration -> email verification -> login -> profile -> address -> reload passed
- Responsive browser checks: `390x844`, `820x1024`, and `1440x900` had no horizontal overflow, overlap, clipped controls, or console errors

Run the full gate:

```bash
npm --prefix backend run ci
DATABASE_URL=postgresql://127.0.0.1/goatedbuy_local_v2 npm --prefix backend run migrate:status
git diff --check
```

## 5. Local Runtime

Frontend:

- Client: <http://127.0.0.1:8080/app/client.html>
- Account login: <http://127.0.0.1:8080/app/client.html#/account/login>
- Checklist: <http://127.0.0.1:8080/prd-v2-checklist.html>

Backend:

- API: <http://127.0.0.1:3000>
- Health: <http://127.0.0.1:3000/health>
- Readiness: <http://127.0.0.1:3000/ready>
- Database: `postgresql://127.0.0.1/goatedbuy_local_v2`
- Redis is intentionally optional in the current local process.

Current backend launch command:

```bash
cd backend
DATABASE_URL=postgresql://127.0.0.1/goatedbuy_local_v2 \
PORT=3000 NODE_ENV=development READY_REQUIRES_REDIS=false npm start
```

Static frontend launch command if the existing server stops:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

The local database contains development/test users only. Do not treat it as production data.

## 6. Pending Decisions

All decision records remain in `V2-00_需求冻结与现状基线/`.

Most urgent:

- `GB-DEC-P0-004`: legal link-parsing source, supported Taobao/1688/Weidian fields, SLA, cost, rate limits, login/anti-bot risk, and manual fallback. Status: `pending_business_decision`.
- `GB-DEC-P1-001`: final eight locale codes and translation delivery ownership. Status: `pending_business_decision`.

The V2-03 phase cannot claim production-ready marketplace parsing until `GB-DEC-P0-004` is approved. Existing placeholder parsing is development-only and must never be presented as supplier data.

## 7. Recommended Next Actions

1. Complete `V2-03-01` by obtaining and recording the `GB-DEC-P0-004` decision and evidence.
2. After approval, implement `V2-03-02` URL normalization/platform identification with short-link, tracking-parameter, protocol, length, and deduplication tests.
3. Build Taobao, 1688, and Weidian adapters behind a shared contract; do not embed provider-specific behavior in routes.
4. Add retry/dead-letter behavior before creating immutable catalog snapshots and APIs.
5. Complete each atomic task independently, run its focused tests plus `npm run ci`, then add its ID and evidence to `prd-v2-task-status.json`.

If the P0 parsing decision is not available, implementation may only add contracts, test fixtures, explicit `not_configured` degradation, and decision documentation. It must not check off `V2-03-01` or simulate a real provider.

## 8. Safety Notes

- Preserve all user changes and intentional legacy-file deletions in the dirty worktree.
- Never put API credentials, HMAC keys, encryption keys, verification tokens, or provider cookies in frontend/static files.
- Keep buyer and employee identities and sessions separate.
- Preserve integer-minor-unit money and immutable business snapshots.
- Use ownership checks, optimistic versions, idempotency, and immutable audit records on every new V2 capability.
