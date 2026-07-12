import assert from "node:assert/strict";
import test from "node:test";
import { backoffDelayMs, decideParseOutcome, createParseProcessor, PARSE_DEAD_LETTER_QUEUE } from "../src/catalog/parse-queue.js";
import { calculatePayable } from "../src/catalog/price-calculator.js";
import { SNAPSHOT_STATUS, ok } from "../src/parsing/adapters/product-snapshot.js";
import { MemoryCatalogRepository } from "./helpers/memory-catalog-repository.js";

test("backoffDelayMs grows exponentially and is capped", () => {
  assert.equal(backoffDelayMs(0, { baseMs: 2000, maxMs: 300000 }), 2000);
  assert.equal(backoffDelayMs(1, { baseMs: 2000, maxMs: 300000 }), 4000);
  assert.equal(backoffDelayMs(3, { baseMs: 2000, maxMs: 300000 }), 16000);
  assert.equal(backoffDelayMs(20, { baseMs: 2000, maxMs: 300000 }), 300000); // capped
});

test("decideParseOutcome routes ok, retryable, exhausted, and terminal statuses", () => {
  const okResult = ok({ title: "X", priceCents: 100 }, "Taobao");
  assert.equal(decideParseOutcome({ result: okResult, attempt: 0 }).action, "snapshot");

  const timeout = { status: SNAPSHOT_STATUS.TIMEOUT };
  assert.equal(decideParseOutcome({ result: timeout, attempt: 0, maxAttempts: 3 }).action, "retry");
  assert.equal(decideParseOutcome({ result: timeout, attempt: 2, maxAttempts: 3 }).action, "dead_letter");

  assert.equal(decideParseOutcome({ result: { status: SNAPSHOT_STATUS.NOT_CONFIGURED }, attempt: 0 }).action, "manual");
  assert.equal(decideParseOutcome({ result: { status: SNAPSHOT_STATUS.ITEM_REMOVED }, attempt: 0 }).action, "manual");
});

test("processor is idempotent and never reprocesses a terminal job", async () => {
  const repo = new MemoryCatalogRepository();
  const job = await repo.createParseJob({ userId: "u1", requestKey: "k1", platform: "Taobao", url: "https://item.taobao.com/item.htm?id=1", ref: {} });
  await repo.markParseJob("u1", job.id, { status: "snapshotted", snapshotId: "s1" });
  let fetched = 0;
  const registry = { async fetchProduct() { fetched += 1; return ok({ title: "X", priceCents: 100 }, "Taobao"); } };
  const processor = createParseProcessor({ repository: repo, registry, queueAdapter: { async enqueue() {} } });
  const result = await processor.process({ userId: "u1", jobId: job.id });
  assert.equal(result.status, "snapshotted");
  assert.equal(fetched, 0); // terminal job short-circuits before any fetch
});

test("processor snapshots an ok result and tags it scraped", async () => {
  const repo = new MemoryCatalogRepository();
  const job = await repo.createParseJob({ userId: "u1", requestKey: "k1", platform: "Taobao", url: "https://item.taobao.com/item.htm?id=1", ref: { platform: "Taobao", itemId: "1", kind: "item" } });
  const registry = { async fetchProduct() { return ok({ title: "Sneaker", priceCents: 19990, domesticShippingCents: 600 }, "Taobao"); } };
  const processor = createParseProcessor({ repository: repo, registry, queueAdapter: { async enqueue() {} } });
  const result = await processor.process({ userId: "u1", jobId: job.id });
  assert.equal(result.status, "snapshotted");
  const snapshot = await repo.findSnapshot("u1", result.snapshotId);
  assert.equal(snapshot.source, "scraped");
  assert.equal(snapshot.priceCents, 19990);
});

test("processor retries transient failures then dead-letters and alerts on exhaustion", async () => {
  const repo = new MemoryCatalogRepository();
  const job = await repo.createParseJob({ userId: "u1", requestKey: "k1", platform: "Taobao", url: "https://item.taobao.com/item.htm?id=1", ref: { platform: "Taobao", itemId: "1", kind: "item" } });
  const enqueued = [];
  const alerts = [];
  const registry = { async fetchProduct() { return { status: SNAPSHOT_STATUS.TIMEOUT }; } };
  const processor = createParseProcessor({
    repository: repo,
    registry,
    queueAdapter: { async enqueue(name, payload) { enqueued.push({ name, payload }); } },
    alerter: { async alert(event) { alerts.push(event); } },
    env: { catalogParseMaxAttempts: 3 }
  });

  let current = await processor.process({ userId: "u1", jobId: job.id });
  assert.equal(current.status, "retrying"); // attempt 0 -> retry
  current = await processor.process({ userId: "u1", jobId: job.id });
  assert.equal(current.status, "retrying"); // attempt 1 -> retry
  current = await processor.process({ userId: "u1", jobId: job.id });
  assert.equal(current.status, "dead_letter"); // attempt 2 -> exhausted

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].event, "catalog_parse_dead_letter");
  assert.ok(enqueued.some((e) => e.name === PARSE_DEAD_LETTER_QUEUE));
});

test("processor sends terminal degradations to manual without retry", async () => {
  const repo = new MemoryCatalogRepository();
  const job = await repo.createParseJob({ userId: "u1", requestKey: "k1", platform: "Taobao", url: "https://x", ref: { platform: "Taobao", itemId: "1", kind: "item" } });
  const registry = { async fetchProduct() { return { status: SNAPSHOT_STATUS.NOT_CONFIGURED }; } };
  const enqueued = [];
  const processor = createParseProcessor({ repository: repo, registry, queueAdapter: { async enqueue(n, p) { enqueued.push({ n, p }); } } });
  const result = await processor.process({ userId: "u1", jobId: job.id });
  assert.equal(result.status, "manual");
  assert.equal(result.reason, SNAPSHOT_STATUS.NOT_CONFIGURED);
  assert.equal(enqueued.length, 0); // no retry, no dead-letter
});

test("calculatePayable uses integer cents and refuses to treat unknown shipping as zero", () => {
  const known = calculatePayable({ unitPriceCents: 19990, quantity: 2, domesticShippingCents: 600 });
  assert.equal(known.complete, true);
  assert.equal(known.itemsCents, 39980);
  assert.equal(known.totalCents, 40580);

  const unknown = calculatePayable({ unitPriceCents: 19990, quantity: 2, domesticShippingCents: null });
  assert.equal(unknown.complete, false);
  assert.equal(unknown.reason, "domestic_shipping_unknown");
  assert.equal(unknown.totalCents, null); // never silently 0

  const free = calculatePayable({ unitPriceCents: 100, quantity: 1, domesticShippingCents: 0 });
  assert.equal(free.complete, true); // explicit 0 (free shipping) is fine
  assert.equal(free.totalCents, 100);

  assert.throws(() => calculatePayable({ unitPriceCents: 100.5, quantity: 1, domesticShippingCents: 0 }), /integer/);
});
