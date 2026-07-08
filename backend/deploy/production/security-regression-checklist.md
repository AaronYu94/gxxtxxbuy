# B8-09 P0 Security Regression Checklist

Re-run before every production release. Backed by the automated regression suite
(`npm test`) plus manual spot checks.

## Authentication & sessions

- [ ] Client and admin identities cannot be used interchangeably (`/auth/*` vs `/admin/auth/*`).
- [ ] Expired / revoked / malformed bearer tokens return `401`.
- [ ] Refresh rotation invalidates the old refresh token; logout revokes the session.
- [ ] `password_hash` never appears in any response.

## Authorization (RBAC & ownership)

- [ ] Every `/admin/*` route enforces its named permission; missing permission → `403`.
- [ ] Client resources are scoped by `user_id`; accessing another user's link/order/QC/
      parcel/wallet/story returns `404`/`403`.
- [ ] Support-only admins get finance/payment fields redacted on the parcel queue.
- [ ] Creator dashboard exposes only aggregates — no buyer address, order lines, or QC.

## Content & data exposure

- [ ] Haul Stories default to pending/private; public requires moderation.
- [ ] Creator touch endpoint never returns session_id / user_id.
- [ ] Private files are only reachable via short-lived signed URLs; bucket names are not exposed.

## Payments & money

- [ ] Payment amount is taken from backend `final_fee`, never the client.
- [ ] Webhooks verify HMAC signature and dedup by `event_id`; amount-mismatch is rejected.
- [ ] Coupon apply only locks; failed/cancelled payment rolls back exactly once.
- [ ] Wallet balance cannot go negative; admin credit requires finance permission + reason.

## Logging & secrets

- [ ] Logs redact authorization, cookies, tokens, addresses, and payment fields.
- [ ] No secrets in the repo; `npm run env:check` passes.
- [ ] CORS allowlist has no wildcard in production.

## Sign-off

- [ ] `npm run ci` green (lint + OpenAPI + tests + build).
- [ ] Manual spot checks above completed and dated.
