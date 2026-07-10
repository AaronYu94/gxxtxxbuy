# Monitoring & Alerts

Signals are emitted as structured JSON logs (request logger + `request_error` events) and
health endpoints. Wire the following into the platform monitor (Datadog/Grafana/CloudWatch).

## Golden signals

| Signal | Source | Alert threshold |
| --- | --- | --- |
| Availability | `GET /health` (liveness), `GET /ready` (readiness) | `/ready` failing > 1 min → page |
| Error rate | `request_error` logs with `code` / 5xx status | 5xx rate > 2% over 5 min → page |
| Latency | request logger `latency` field | p95 > 800 ms over 10 min → warn |
| Saturation | DB pool (`DB_POOL_MAX`), Redis | pool exhaustion / connection errors → warn |

## Domain-critical alerts (must page)

- **Payments** — spike in `shipping-payment` failures, or webhook signature-verification
  failures (`SHIPPING_WEBHOOK_SECRET` mismatch), or `amount mismatch` rejections.
- **Webhooks** — payment webhook processing errors or a drop to zero received webhooks
  during business hours (provider connectivity).
- **Queue** — link-parse queue enqueue/dequeue failures or Redis unavailability
  (`/ready` dependency failure).
- **Coupon rollback** — `coupon.apply` locks without a matching settle/rollback.

## Dashboards

- Request volume + error rate by route.
- Payment success/failure funnel.
- Readiness dependency status (DB, Redis) over time.
- Feature-flag state (surface which `FEATURE_*` are off).

## Redaction

Logs already redact auth headers, tokens, addresses, and payment fields. Confirm the log
sink does not re-introduce PII via other integrations.
