// V2-06-16 — storage-period rules. Free storage is 90 days from the official
// inbound time; up to two paid one-month (30-day) extensions push the deadline to
// at most 150 days, which is also when destruction becomes eligible. All maths
// are on UTC millisecond timestamps so day boundaries are unambiguous.
const DAY = 24 * 60 * 60 * 1000;

export const FREE_DAYS = 90;
export const MAX_EXTENSION_MONTHS = 2;
export const EXTENSION_DAYS_PER_MONTH = 30;
export const DESTROY_DAYS = 150;
export const EXTENSION_UNIT_MINOR = 1000; // 10 CNY per month
export const REMINDER_MILESTONES = [15, 7, 3, 0];

export function computeStorage(officialInboundAt, extensionMonths = 0, nowMs = Date.now()) {
  const base = Date.parse(officialInboundAt);
  const months = Math.min(MAX_EXTENSION_MONTHS, Math.max(0, Number(extensionMonths) || 0));
  const freeUntil = base + FREE_DAYS * DAY;
  const deadline = freeUntil + months * EXTENSION_DAYS_PER_MONTH * DAY;
  const destroyEligibleAt = base + DESTROY_DAYS * DAY;
  return {
    freeUntil: new Date(freeUntil).toISOString(),
    deadline: new Date(deadline).toISOString(),
    destroyEligibleAt: new Date(destroyEligibleAt).toISOString(),
    daysLeft: Math.ceil((deadline - nowMs) / DAY),
    expired: nowMs > deadline,
    destroyEligible: nowMs >= destroyEligibleAt
  };
}

// The reminder milestone that currently applies (smallest 15/7/3/0 the days-left
// has crossed), or null if more than 15 days remain.
export function dueMilestone(daysLeft) {
  for (const m of [0, 3, 7, 15]) {
    if (daysLeft <= m) return m;
  }
  return null;
}
