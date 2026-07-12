// V2-12-02 — the unified job envelope (pure). Every queued job is wrapped in this
// standard shape so retry, dead-lettering, and replay are uniform. Idempotency is
// carried on the envelope so a redelivered message is processed at most once.
import { randomUUID } from "node:crypto";

const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000; // cap at 15 minutes

export function createEnvelope(type, payload, { idempotencyKey = null, maxAttempts = DEFAULT_MAX_ATTEMPTS, enqueuedAt = null } = {}) {
  return {
    id: randomUUID(),
    type,
    payload: payload || {},
    idempotency_key: idempotencyKey || `${type}:${randomUUID()}`,
    attempts: 0,
    max_attempts: maxAttempts,
    enqueued_at: enqueuedAt || null // stamped by the enqueuer (clock-free here)
  };
}

// Exponential backoff with a cap (deterministic — no jitter here so it's testable;
// the worker may add jitter). attempts is the number already made.
export function nextBackoffMs(attempts) {
  const n = Math.max(0, Number(attempts) || 0);
  return Math.min(BASE_BACKOFF_MS * 2 ** n, MAX_BACKOFF_MS);
}

// After a failure, decide whether to retry or dead-letter.
export function afterFailure(envelope) {
  const attempts = (Number(envelope.attempts) || 0) + 1;
  if (attempts >= (envelope.max_attempts || DEFAULT_MAX_ATTEMPTS)) {
    return { action: "dead_letter", attempts };
  }
  return { action: "retry", attempts, backoff_ms: nextBackoffMs(attempts) };
}

export { DEFAULT_MAX_ATTEMPTS };
