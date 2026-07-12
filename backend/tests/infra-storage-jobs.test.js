import assert from "node:assert/strict";
import test from "node:test";
import { domainForKey, bucketForKey, thumbnailKey, signedTtlSeconds, lifecycleRule, DOMAINS } from "../src/storage/storage-policy.js";
import { createEnvelope, nextBackoffMs, afterFailure } from "../src/queue/job-envelope.js";
import { createJobService } from "../src/queue/job-service.js";
import { MemoryJobRepository } from "./helpers/memory-job-repository.js";

// ---- V2-12-01 storage policy ----
test("keys route to the right security domain; identity is isolated", () => {
  assert.equal(domainForKey("qc/front.jpg"), DOMAINS.PRIVATE);
  assert.equal(domainForKey("banner/spring.jpg"), DOMAINS.PUBLIC);
  assert.equal(domainForKey("identity/passport.jpg"), DOMAINS.RESTRICTED);
  assert.equal(domainForKey("bank/proof.pdf"), DOMAINS.RESTRICTED);
});

test("identity documents get a separate bucket, no thumbnail, and a short TTL", () => {
  assert.equal(bucketForKey("identity/x.jpg", { privateBucket: "gb-priv", identityBucket: "gb-id" }), "gb-id");
  assert.equal(bucketForKey("qc/x.jpg", { privateBucket: "gb-priv" }), "gb-priv");
  assert.equal(thumbnailKey("identity/x.jpg"), null); // never derived
  assert.equal(thumbnailKey("qc/front.jpg"), "qc/front_thumb.jpg");
  assert.equal(signedTtlSeconds("identity/x.jpg", { defaultTtl: 600 }), 120); // ≤ 2 min
  assert.equal(signedTtlSeconds("qc/front.jpg", { defaultTtl: 600 }), 600);
});

test("originals are never public except the public domain; restricted is backed up + encrypted", () => {
  assert.equal(lifecycleRule("qc/front.jpg").public_read, false);
  assert.equal(lifecycleRule("banner/spring.jpg").public_read, true);
  const r = lifecycleRule("identity/x.jpg");
  assert.equal(r.public_read, false);
  assert.equal(r.encrypt, true);
  assert.equal(r.cross_region_backup, true);
});

// ---- V2-12-02 job envelope + processing ----
test("backoff grows exponentially and caps; failure decides retry vs dead-letter", () => {
  assert.equal(nextBackoffMs(0), 1000);
  assert.equal(nextBackoffMs(3), 8000);
  assert.ok(nextBackoffMs(50) <= 15 * 60 * 1000); // capped
  assert.equal(afterFailure({ attempts: 0, max_attempts: 3 }).action, "retry");
  assert.equal(afterFailure({ attempts: 2, max_attempts: 3 }).action, "dead_letter");
});

function build() {
  const repository = new MemoryJobRepository();
  const svc = createJobService({ repository, handlers: {}, backlogThreshold: 2 });
  return { repository, svc };
}

test("a job is processed once; redelivery is a no-op (idempotent)", async () => {
  const { svc } = build();
  let runs = 0;
  svc.registerHandler("notify", async () => { runs += 1; });
  const env = createEnvelope("notify", { to: "a" }, { idempotencyKey: "n1" });
  assert.equal((await svc.process(env)).status, "done");
  assert.equal((await svc.process(env)).status, "skipped"); // redelivery
  assert.equal(runs, 1);
});

test("a failing job retries then dead-letters after exhausting attempts", async () => {
  const { svc } = build();
  svc.registerHandler("flaky", async () => { throw new Error("boom"); });
  let env = createEnvelope("flaky", {}, { idempotencyKey: "f1", maxAttempts: 2 });
  const first = await svc.process(env);
  assert.equal(first.status, "retry");
  env = { ...env, attempts: first.attempts };
  const second = await svc.process(env);
  assert.equal(second.status, "dead");
  assert.ok(second.dead_letter_id);
});

test("dead-letter replay requires super-admin and is audited", async () => {
  const { svc } = build();
  let replayed = 0;
  svc.registerHandler("flaky", async () => { if (replayed === 0) { replayed = -1; throw new Error("boom"); } replayed = 1; });
  let env = createEnvelope("flaky", { x: 1 }, { idempotencyKey: "f2", maxAttempts: 1 });
  const res = await svc.process(env);
  assert.equal(res.status, "dead");
  // Non-super cannot replay.
  await assert.rejects(() => svc.replay({ id: "a" }, ["config"], res.dead_letter_id), (e) => e.statusCode === 403);
  const done = await svc.replay({ id: "admin" }, ["super_admin"], res.dead_letter_id);
  assert.equal(done.replayed, true);
  assert.equal(replayed, 1);
});

test("dead-letter count drives the backlog alert", async () => {
  const { svc } = build();
  svc.registerHandler("x", async () => { throw new Error("e"); });
  await svc.process(createEnvelope("x", {}, { idempotencyKey: "a", maxAttempts: 1 }));
  let h = await svc.healthSignal();
  assert.equal(h.alert, false);
  await svc.process(createEnvelope("x", {}, { idempotencyKey: "b", maxAttempts: 1 }));
  h = await svc.healthSignal();
  assert.equal(h.dead_letter_count, 2);
  assert.equal(h.alert, true); // threshold 2
});
