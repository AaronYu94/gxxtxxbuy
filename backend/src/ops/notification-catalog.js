// V2-10-18 — the unified notification + scheduled-task catalog (pure).
//
// Every notifiable business event maps to a catalog entry declaring its category
// (transactional vs marketing) and default channels. Transactional notifications
// always send; marketing notifications honour the user's preference. The cron
// catalog lists scheduled jobs with the idempotency scope that makes a rerun safe.

export const NOTIFICATION_CATALOG = Object.freeze({
  topup_succeeded: { category: "transactional", channels: ["email"] },
  purchase_confirmed: { category: "transactional", channels: ["email"] },
  inbound_arrived: { category: "transactional", channels: ["email"] },
  qc_completed: { category: "transactional", channels: ["email"] },
  storage_reminder: { category: "transactional", channels: ["email"] },
  packing_done: { category: "transactional", channels: ["email"] },
  outbound_shipped: { category: "transactional", channels: ["email"] },
  refund_completed: { category: "transactional", channels: ["email"] },
  login_alert: { category: "transactional", channels: ["email"] },
  commission_earned: { category: "transactional", channels: ["email"] },
  promo_announcement: { category: "marketing", channels: ["email"] }
});

// The scheduled-task catalog. `idempotencyScope` documents what makes a rerun a
// no-op (a day bucket, a milestone, a status guard), so a duplicate cron fire is safe.
export const CRON_CATALOG = Object.freeze([
  { key: "storage_sweep", schedule: "hourly", idempotencyScope: "reminder-milestone + destroy-status guard" },
  { key: "distill_worker", schedule: "hourly", idempotencyScope: "per-turn cursor" },
  { key: "daily_backup", schedule: "daily", idempotencyScope: "date bucket" },
  { key: "email_batch_worker", schedule: "minute", idempotencyScope: "batch status guard" },
  { key: "orphan_reclaim", schedule: "minute", idempotencyScope: "lease expiry" }
]);

export function catalogEntry(type) { return NOTIFICATION_CATALOG[type] || null; }

// Decide whether an event should send, given the catalog + the user's marketing
// preference. Transactional always sends; marketing honours the preference.
export function shouldDispatch(type, { marketingOptIn = true } = {}) {
  const entry = NOTIFICATION_CATALOG[type];
  if (!entry) return { dispatch: false, reason: "unknown_type" };
  if (entry.category === "marketing" && !marketingOptIn) return { dispatch: false, reason: "opted_out", category: "marketing" };
  return { dispatch: true, category: entry.category, channels: entry.channels };
}
