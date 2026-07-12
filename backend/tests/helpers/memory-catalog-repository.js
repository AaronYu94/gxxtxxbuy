import { randomUUID } from "node:crypto";
import {
  normalizeParseJob,
  normalizeSnapshot,
  normalizePriceCalculation
} from "../../src/catalog/catalog-repository.js";

// In-memory double for the catalog repository. Snapshots and price calculations
// are insert-only — there is no update method, mirroring the immutability the SQL
// trigger enforces in production.
export class MemoryCatalogRepository {
  constructor() {
    this.parseJobs = new Map();
    this.parseJobsByRequest = new Map();
    this.snapshots = new Map();
    this.priceCalculations = new Map();
  }

  async findParseJobByRequestKey(userId, requestKey) {
    return clone(this.parseJobs.get(this.parseJobsByRequest.get(`${userId}:${requestKey}`)));
  }

  async findParseJobById(userId, jobId) {
    const job = this.parseJobs.get(jobId);
    return job?.userId === userId ? clone(job) : null;
  }

  async createParseJob(input) {
    const key = `${input.userId}:${input.requestKey}`;
    if (this.parseJobsByRequest.has(key)) {
      const error = new Error("duplicate parse job");
      error.code = "23505";
      throw error;
    }
    const now = new Date().toISOString();
    const job = normalizeParseJob(toRow({
      id: randomUUID(),
      user_id: input.userId,
      saved_link_id: input.savedLinkId || null,
      request_key: input.requestKey,
      platform: input.platform,
      url: input.url,
      ref: input.ref || {},
      status: "queued",
      attempt: 0,
      reason: "",
      snapshot_id: null,
      created_at: now,
      updated_at: now
    }));
    this.parseJobs.set(job.id, job);
    this.parseJobsByRequest.set(key, job.id);
    return clone(job);
  }

  async markParseJob(userId, jobId, patch) {
    const job = this.parseJobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }
    if (patch.status !== undefined && patch.status !== null) job.status = patch.status;
    if (patch.attempt !== undefined && patch.attempt !== null) job.attempt = patch.attempt;
    if (patch.reason !== undefined && patch.reason !== null) job.reason = patch.reason;
    if (patch.snapshotId !== undefined && patch.snapshotId !== null) job.snapshotId = patch.snapshotId;
    job.updatedAt = new Date().toISOString();
    return clone(job);
  }

  async listParseJobs(userId) {
    return Array.from(this.parseJobs.values())
      .filter((job) => job.userId === userId)
      .sort(sortDesc)
      .map(clone);
  }

  async createSnapshot(input) {
    const now = new Date().toISOString();
    const snapshot = normalizeSnapshot(toSnapshotRow({ id: randomUUID(), created_at: now, ...toSnapshotColumns(input) }));
    this.snapshots.set(snapshot.id, snapshot);
    return clone(snapshot);
  }

  async createSnapshotFromParse(job, product) {
    return this.createSnapshot({
      userId: job.userId,
      parseJobId: job.jobId,
      savedLinkId: job.savedLinkId,
      platform: product.platform,
      sourceUrl: product.sourceUrl || job.url,
      shop: product.shop,
      title: product.title,
      mainImage: product.mainImage,
      images: product.images,
      priceCents: product.priceCents,
      currency: product.currency,
      domesticShippingCents: product.domesticShippingCents,
      spec: product.spec,
      sizes: product.sizes,
      colors: product.colors,
      skus: product.skus,
      priceTiers: product.priceTiers,
      minOrderQuantity: product.minOrderQuantity,
      source: "scraped",
      sourceCapturedAt: product.sourceCapturedAt
    });
  }

  async findSnapshot(userId, snapshotId) {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot?.userId === userId ? clone(snapshot) : null;
  }

  async createPriceCalculation(input) {
    const now = new Date().toISOString();
    const calc = normalizePriceCalculation({
      id: randomUUID(),
      user_id: input.userId,
      snapshot_id: input.snapshotId,
      spec: input.spec || "",
      quantity: input.quantity,
      unit_price_cents: input.unitPriceCents,
      items_cents: input.itemsCents,
      domestic_shipping_cents: input.domesticShippingCents ?? null,
      total_cents: input.totalCents ?? null,
      complete: input.complete,
      reason: input.reason || "",
      currency: input.currency || "CNY",
      created_at: now
    });
    this.priceCalculations.set(calc.id, calc);
    return clone(calc);
  }
}

function toRow(row) {
  return row;
}

function toSnapshotColumns(input) {
  return {
    user_id: input.userId,
    parse_job_id: input.parseJobId || null,
    saved_link_id: input.savedLinkId || null,
    platform: input.platform,
    source_url: input.sourceUrl,
    shop: input.shop || "",
    title: input.title,
    main_image: input.mainImage || "",
    images: input.images || [],
    price_cents: input.priceCents,
    currency: input.currency || "CNY",
    domestic_shipping_cents: input.domesticShippingCents ?? null,
    spec: input.spec || "",
    sizes: input.sizes || [],
    colors: input.colors || [],
    skus: input.skus || [],
    price_tiers: input.priceTiers || [],
    min_order_quantity: input.minOrderQuantity ?? null,
    source: input.source,
    source_captured_at: input.sourceCapturedAt || null
  };
}

function toSnapshotRow(row) {
  return row;
}

function sortDesc(a, b) {
  return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
