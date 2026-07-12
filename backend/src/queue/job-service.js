import { conflict, forbidden, notFound } from "../errors/app-error.js";
import { afterFailure } from "./job-envelope.js";

// V2-12-02 — job processing with idempotency, retry/backoff, dead-letter, and a
// permissioned + audited replay. Handlers are registered by job type.
export function createJobService({ repository, handlers = {}, auditLogger = null, backlogThreshold = 100 } = {}) {
  if (!repository) throw new Error("Job repository is required.");

  return {
    registerHandler(type, fn) { handlers[type] = fn; },

    // Process one envelope. Returns { status: 'done'|'retry'|'dead'|'skipped' }.
    async process(envelope) {
      const handler = handlers[envelope.type];
      if (!handler) {
        const dlq = await repository.deadLetter({ jobType: envelope.type, idempotencyKey: envelope.idempotency_key, envelope, error: "no handler registered", attempts: envelope.attempts });
        return { status: "dead", dead_letter_id: dlq.id };
      }
      // Idempotency: a redelivered, already-processed message is a no-op.
      if (await repository.isProcessed(envelope.idempotency_key)) return { status: "skipped", reason: "already_processed" };
      try {
        await handler(envelope.payload, envelope);
        await repository.markProcessed(envelope.idempotency_key, envelope.type);
        return { status: "done" };
      } catch (error) {
        const decision = afterFailure(envelope);
        if (decision.action === "dead_letter") {
          const dlq = await repository.deadLetter({ jobType: envelope.type, idempotencyKey: envelope.idempotency_key, envelope: { ...envelope, attempts: decision.attempts }, error: error.message, attempts: decision.attempts });
          return { status: "dead", dead_letter_id: dlq.id, attempts: decision.attempts };
        }
        return { status: "retry", attempts: decision.attempts, backoff_ms: decision.backoff_ms, error: error.message };
      }
    },

    async listDeadLetters(query = {}) { return { dead_letters: await repository.listDeadLetters({ status: query.status || "dead" }) }; },

    // Replay a dead-lettered job — requires permission + audit (route gates the
    // permission; this records who + why). Replay clears the idempotency mark so the
    // handler runs again.
    async replay(adminUser, adminRoles, id, requestMeta = {}) {
      if (!Array.isArray(adminRoles) || !adminRoles.includes("super_admin")) throw forbidden("Only a super admin can replay a dead-lettered job.");
      const dlq = await repository.findDeadLetter(id);
      if (!dlq) throw notFound("Dead-lettered job not found.");
      if (dlq.status !== "dead") throw conflict("Job is not in the dead-letter state.", { code: "not_dead" });
      const handler = handlers[dlq.jobType];
      if (!handler) throw conflict("No handler registered for this job type.", { code: "no_handler" });
      await handler(dlq.envelope.payload, dlq.envelope);
      await repository.markProcessed(dlq.idempotencyKey, dlq.jobType);
      const updated = await repository.markDeadLetter(id, { status: "replayed", adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "job.replay", resourceType: "dead_letter_job", resourceId: id, metadata: { job_type: dlq.jobType }, requestId: requestMeta.requestId }, { critical: true });
      return { replayed: true, job: updated };
    },

    // Backlog / dead-letter alert signal (a monitor polls this).
    async healthSignal() {
      const dead = await repository.deadLetterCount();
      return { dead_letter_count: dead, alert: dead >= backlogThreshold };
    }
  };
}
