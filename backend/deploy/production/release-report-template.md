# Release Report — <version> (<date>)

## Summary

- Release: `<version / image tag>`
- Window: `<start> – <end>` (`<duration>`)
- Owner: `<name>` · Approver: `<name>`
- Outcome: ✅ success / ⚠️ partial / ❌ rolled back

## Scope

- Migrations applied: `<000xxx_*>` (dry-run: pass/fail)
- Feature flags changed: `<FEATURE_* → value>`
- Notable changes: `<bullets>`

## Pre-flight

- [ ] `npm run ci` green
- [ ] `npm run env:check` pass
- [ ] `npm run migrate:dry-run` clean
- [ ] Fresh DB backup taken (`<file>`)
- [ ] Staging smoke pass (`npm run smoke`)

## Metrics (first 24h)

| Metric | Baseline | Post-release |
| --- | --- | --- |
| 5xx error rate | | |
| p95 latency | | |
| Payment success rate | | |
| Webhook processing errors | | |
| Readiness incidents | | |

## Incidents / anomalies

- `<timestamp>` — `<what happened>` — `<mitigation>`

## Rollback (if any)

- Trigger: `<reason>`
- Layer(s): API / frontend / DB / payments / shipping
- Result: `<outcome>`

## Follow-ups

- [ ] `<owner>` — `<action>` — `<due>`

## Learnings

- What went well:
- What to improve:
