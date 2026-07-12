import { badRequest } from "../errors/app-error.js";
import { requiredText } from "../core/core-input.js";
import { NOTIFICATION_CATALOG, CRON_CATALOG, shouldDispatch } from "./notification-catalog.js";

// V2-10-18 — unified notification dispatch + catalog. Transactional events always
// notify; marketing events honour the user's preference. Dispatch is idempotent
// per event_key; exhausted retries dead-letter for alerting.
export function createNotificationService({ repository, maxAttempts = 3 } = {}) {
  if (!repository) throw new Error("Notification repository is required.");

  return {
    catalog() {
      return {
        notifications: Object.entries(NOTIFICATION_CATALOG).map(([type, e]) => ({ type, category: e.category, channels: e.channels })),
        cron: CRON_CATALOG
      };
    },

    // Dispatch a notification for a business event. Idempotent (event_key).
    async notify({ eventKey, type, userId, marketingOptIn = true, detail = {} }) {
      const key = requiredText(eventKey, "event_key", 200);
      if (!NOTIFICATION_CATALOG[type]) throw badRequest("Unknown notification type.", { field: "type" });
      const decision = shouldDispatch(type, { marketingOptIn });
      if (!decision.dispatch) {
        // Suppressed by preference — still logged (idempotently) so we never re-evaluate.
        const res = await repository.dispatch({ eventKey: key, type, userId, channel: "email", category: decision.category || "marketing", status: "suppressed", detail });
        return { dispatched: false, suppressed: true, replay: !res.created };
      }
      const res = await repository.dispatch({ eventKey: key, type, userId, channel: decision.channels[0], category: decision.category, status: "sent", detail });
      return { dispatched: res.created, replay: !res.created, category: decision.category };
    },

    // Record a delivery failure; dead-letter once attempts exceed the max.
    async recordFailure(eventKey) {
      const failed = await repository.markFailed(eventKey);
      if (failed && failed.attempts >= maxAttempts) {
        const dead = await repository.markDead(eventKey);
        return { status: dead.status, attempts: dead.attempts };
      }
      return { status: failed ? failed.status : null, attempts: failed ? failed.attempts : 0 };
    },
    async listDeadLetters() { return { dead_letters: await repository.listDeadLetters() }; }
  };
}
