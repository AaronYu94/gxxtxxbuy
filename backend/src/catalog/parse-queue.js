// V2-03-06 — parse job orchestration: idempotency, exponential backoff, retry,
// dead-letter, and alerting. A saved link is never lost: transient upstream
// failures back off and retry; exhausted or terminal failures move to manual
// handling (and a dead-letter record for retryable exhaustion) rather than
// silently dropping.
import { SNAPSHOT_STATUS, isRetryableStatus } from "../parsing/adapters/product-snapshot.js";
import { dequeue } from "../queue/queue.js";

export const PARSE_QUEUE = "catalog:parse";
export const PARSE_DEAD_LETTER_QUEUE = "catalog:parse:dead";

// Exponential backoff with a hard ceiling. Deterministic (no jitter) so retries
// are testable and predictable under load.
export function backoffDelayMs(attempt, { baseMs = 2000, maxMs = 300000 } = {}) {
  const raw = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(maxMs, raw);
}

// Pure decision: given a fetch result and the current attempt, decide what the
// worker should do next. Never mutates anything.
//   ok               -> snapshot
//   retryable + tries -> retry (with backoff)
//   retryable + spent -> dead_letter (retryable exhaustion, needs an operator)
//   terminal degraded -> manual (user completes details; no retry, no alert)
export function decideParseOutcome({ result, attempt, maxAttempts = 5, baseMs, maxMs }) {
  if (result.status === SNAPSHOT_STATUS.OK) {
    return { action: "snapshot", product: result.product };
  }
  if (isRetryableStatus(result.status)) {
    if (attempt + 1 < maxAttempts) {
      return { action: "retry", delayMs: backoffDelayMs(attempt, { baseMs, maxMs }), reason: result.status };
    }
    return { action: "dead_letter", reason: result.status };
  }
  // not_configured / unsupported / item_removed / login_wall / missing_fields.
  return { action: "manual", reason: result.status };
}

// Applies a decision against the injected repository/queue/alerter. Returns the
// updated parse job for the caller. Idempotent by construction: a job whose
// request already produced a snapshot short-circuits before any fetch.
export function createParseProcessor({ repository, registry, queueAdapter, alerter = null, env = {} }) {
  const maxAttempts = env.catalogParseMaxAttempts || 5;
  const baseMs = env.catalogParseBackoffBaseMs || 2000;
  const maxMs = env.catalogParseBackoffMaxMs || 300000;

  return {
    async process(job) {
      const existing = await repository.findParseJobById(job.userId, job.jobId);
      if (!existing) {
        return null;
      }
      // Idempotency: a terminal job is never reprocessed.
      if (existing.status === "snapshotted" || existing.status === "manual" || existing.status === "dead_letter") {
        return existing;
      }

      const result = await registry.fetchProduct(existing.ref);
      const decision = decideParseOutcome({ result, attempt: existing.attempt, maxAttempts, baseMs, maxMs });

      if (decision.action === "snapshot") {
        const snapshot = await repository.createSnapshotFromParse(existing, decision.product);
        return repository.markParseJob(existing.userId, existing.jobId, {
          status: "snapshotted",
          snapshotId: snapshot.id,
          reason: ""
        });
      }

      if (decision.action === "retry") {
        const updated = await repository.markParseJob(existing.userId, existing.jobId, {
          status: "retrying",
          attempt: existing.attempt + 1,
          reason: decision.reason
        });
        await queueAdapter.enqueue(PARSE_QUEUE, {
          user_id: existing.userId,
          job_id: existing.jobId,
          delay_ms: decision.delayMs
        });
        return updated;
      }

      if (decision.action === "dead_letter") {
        const updated = await repository.markParseJob(existing.userId, existing.jobId, {
          status: "dead_letter",
          reason: decision.reason
        });
        await queueAdapter.enqueue(PARSE_DEAD_LETTER_QUEUE, {
          user_id: existing.userId,
          job_id: existing.jobId,
          reason: decision.reason,
          attempts: existing.attempt + 1
        });
        await alerter?.alert?.({
          event: "catalog_parse_dead_letter",
          jobId: existing.jobId,
          platform: existing.ref?.platform,
          reason: decision.reason
        });
        return updated;
      }

      // manual
      return repository.markParseJob(existing.userId, existing.jobId, {
        status: "manual",
        reason: decision.reason
      });
    }
  };
}

// Standalone worker: drains the catalog:parse queue and processes one job per
// tick through the catalog service (which owns the processor). Runs as its own
// process once Redis is configured; in demo/dev use inline parsing instead.
export function createCatalogParseWorker({ env, service, dequeueFn = dequeue }) {
  return {
    async runOnce() {
      const job = await dequeueFn(env, PARSE_QUEUE);
      if (!job) return null;
      const payload = job.payload || job;
      return service.processJob({ userId: payload.user_id, jobId: payload.job_id });
    }
  };
}
