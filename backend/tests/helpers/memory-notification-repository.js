import { randomUUID } from "node:crypto";

// In-memory double for the notification repository (V2-10-18).
export class MemoryNotificationRepository {
  constructor() { this.byKey = new Map(); }

  async dispatch({ eventKey, type, userId, channel, category, status, detail }) {
    if (this.byKey.has(eventKey)) return { dispatch: { ...this.byKey.get(eventKey) }, created: false };
    const d = { id: randomUUID(), eventKey, type, userId: userId || null, channel: channel || "email", category: category || "transactional", status: status || "sent", attempts: 1, createdAt: new Date().toISOString() };
    this.byKey.set(eventKey, d);
    return { dispatch: { ...d }, created: true };
  }
  async markFailed(eventKey) { const d = this.byKey.get(eventKey); if (!d) return null; d.status = "failed"; d.attempts += 1; return { ...d }; }
  async markDead(eventKey) { const d = this.byKey.get(eventKey); if (!d) return null; d.status = "dead"; return { ...d }; }
  async listDeadLetters() { return [...this.byKey.values()].filter((d) => d.status === "dead").map((d) => ({ ...d })); }
  async find(eventKey) { const d = this.byKey.get(eventKey); return d ? { ...d } : null; }
}
