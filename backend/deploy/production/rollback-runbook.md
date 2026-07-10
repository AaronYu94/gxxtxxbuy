# Rollback Runbook

Roll back by layer. Prefer a feature-flag disable (seconds, no deploy) before a full
rollback when the blast radius is a single surface.

## 0. Fast mitigation first

- Disable the affected surface with a feature flag (`FEATURE_PAYMENTS_ENABLED=false`,
  etc.) and restart/redeploy config only. Returns `503 FEATURE_DISABLED`, no data loss.

## 1. API / application

- Redeploy the previous known-good image tag (staging rollback path documented in
  `deploy/staging/README.md`; production uses the same image-tag pin).
- Verify with `npm run smoke` against the rolled-back API.
- Trigger: sustained 5xx spike, failed smoke, or a correctness regression.

## 2. Frontend

- Swap `app/config.js` and/or redeploy the previous static bundle. Independent of the API
  rollback (see frontend-config.md).

## 3. Database

- **Do not** blindly restore over production. Migrations follow expand/contract, so the
  previous app version is compatible with the current schema in almost all cases — roll
  the app back first.
- If a migration itself is the problem: apply the reviewed reverse migration, or restore
  the pre-migration backup (`backup-and-restore.md`) into a new database and cut over.
  Always take a fresh backup before any corrective action.

## 4. Payments / webhooks

- Coupon locks auto-roll-back idempotently on `failed`/`cancelled` webhooks; no manual
  reversal needed for those.
- If the provider secret rotated incorrectly, restore the previous `SHIPPING_WEBHOOK_SECRET`
  and re-drive any missed webhooks from the provider dashboard (dedup by `event_id` makes
  replay safe).

## 5. Shipping / logistics

- Disable affected shipping lines via admin (`status`), or `FEATURE_SHIPPING_ENABLED=false`
  to stop new parcel submissions while keeping the rest of the app up.

## Post-rollback

- Confirm `/ready` is green and error rate normalized.
- Open a release report capturing cause, timeline, and follow-ups.
