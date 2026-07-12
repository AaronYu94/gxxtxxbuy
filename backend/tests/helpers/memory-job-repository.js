import { randomUUID } from "node:crypto";

// In-memory double for the job repository (V2-12-02).
export class MemoryJobRepository {
  constructor() { this.processed = new Set(); this.dlq = new Map(); }

  async isProcessed(key) { return this.processed.has(key); }
  async markProcessed(key) { this.processed.add(key); return true; }
  async deadLetter({ jobType, idempotencyKey, envelope, error, attempts }) {
    const d = { id: randomUUID(), jobType, idempotencyKey, envelope: envelope || {}, error: String(error || ""), attempts: attempts || 0, status: "dead", createdAt: new Date().toISOString() };
    this.dlq.set(d.id, d);
    return { ...d };
  }
  async findDeadLetter(id) { const d = this.dlq.get(id); return d ? { ...d } : null; }
  async listDeadLetters({ status = "dead" } = {}) { return [...this.dlq.values()].filter((d) => !status || d.status === status).map((d) => ({ ...d })); }
  async markDeadLetter(id, { status, adminId }) { const d = this.dlq.get(id); if (!d || d.status !== "dead") return null; d.status = status; d.replayedByAdminId = adminId; return { ...d }; }
  async deadLetterCount() { return [...this.dlq.values()].filter((d) => d.status === "dead").length; }
}
