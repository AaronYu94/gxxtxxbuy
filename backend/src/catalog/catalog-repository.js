import { getDbPool } from "../db/pool.js";

// Persistence for parse jobs, immutable snapshots, and immutable price
// calculations. Snapshots and price calculations are insert-only here — there is
// deliberately no update method for them (V2-03-11); the database also rejects
// UPDATE via trigger as defense in depth.
export function createPgCatalogRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async findParseJobByRequestKey(userId, requestKey) {
      const result = await pool().query(
        "select * from catalog_parse_jobs where user_id = $1 and request_key = $2",
        [userId, requestKey]
      );
      return normalizeParseJob(result.rows[0]);
    },

    async findParseJobById(userId, jobId) {
      const result = await pool().query(
        "select * from catalog_parse_jobs where user_id = $1 and id = $2",
        [userId, jobId]
      );
      return normalizeParseJob(result.rows[0]);
    },

    async createParseJob(input) {
      const result = await pool().query(
        `insert into catalog_parse_jobs (user_id, saved_link_id, request_key, platform, url, ref, status, attempt)
         values ($1, $2, $3, $4, $5, $6, 'queued', 0)
         returning *`,
        [input.userId, input.savedLinkId || null, input.requestKey, input.platform, input.url, JSON.stringify(input.ref || {})]
      );
      return normalizeParseJob(result.rows[0]);
    },

    async markParseJob(userId, jobId, patch) {
      const result = await pool().query(
        `update catalog_parse_jobs
         set status = coalesce($3, status),
             attempt = coalesce($4, attempt),
             reason = coalesce($5, reason),
             snapshot_id = coalesce($6, snapshot_id)
         where user_id = $1 and id = $2
         returning *`,
        [userId, jobId, patch.status ?? null, patch.attempt ?? null, patch.reason ?? null, patch.snapshotId ?? null]
      );
      return normalizeParseJob(result.rows[0]);
    },

    async listParseJobs(userId) {
      const result = await pool().query(
        "select * from catalog_parse_jobs where user_id = $1 order by updated_at desc",
        [userId]
      );
      return result.rows.map(normalizeParseJob);
    },

    async createSnapshot(input) {
      const result = await pool().query(
        `insert into catalog_snapshots
           (user_id, parse_job_id, saved_link_id, platform, source_url, shop, title, main_image, images,
            price_cents, currency, domestic_shipping_cents, spec, sizes, colors, skus, price_tiers,
            min_order_quantity, source, source_captured_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         returning *`,
        [
          input.userId, input.parseJobId || null, input.savedLinkId || null, input.platform, input.sourceUrl,
          input.shop || "", input.title, input.mainImage || "", JSON.stringify(input.images || []),
          input.priceCents, input.currency || "CNY", input.domesticShippingCents ?? null, input.spec || "",
          JSON.stringify(input.sizes || []), JSON.stringify(input.colors || []), JSON.stringify(input.skus || []),
          JSON.stringify(input.priceTiers || []), input.minOrderQuantity ?? null, input.source,
          input.sourceCapturedAt || null
        ]
      );
      return normalizeSnapshot(result.rows[0]);
    },

    // Convenience used by the parse processor: create a snapshot straight from a
    // job and a resolved product, tagging it as scraped.
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
    },

    async findSnapshot(userId, snapshotId) {
      const result = await pool().query(
        "select * from catalog_snapshots where user_id = $1 and id = $2",
        [userId, snapshotId]
      );
      return normalizeSnapshot(result.rows[0]);
    },

    async createPriceCalculation(input) {
      const result = await pool().query(
        `insert into catalog_price_calculations
           (user_id, snapshot_id, spec, quantity, unit_price_cents, items_cents,
            domestic_shipping_cents, total_cents, complete, reason, currency)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning *`,
        [
          input.userId, input.snapshotId, input.spec || "", input.quantity, input.unitPriceCents,
          input.itemsCents, input.domesticShippingCents ?? null, input.totalCents ?? null,
          input.complete, input.reason || "", input.currency || "CNY"
        ]
      );
      return normalizePriceCalculation(result.rows[0]);
    }
  };
}

export function normalizeParseJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.id,
    userId: row.user_id,
    savedLinkId: row.saved_link_id,
    requestKey: row.request_key,
    platform: row.platform,
    url: row.url,
    ref: row.ref || {},
    status: row.status,
    attempt: row.attempt,
    reason: row.reason,
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    parseJobId: row.parse_job_id,
    savedLinkId: row.saved_link_id,
    platform: row.platform,
    sourceUrl: row.source_url,
    shop: row.shop,
    title: row.title,
    mainImage: row.main_image,
    images: row.images || [],
    priceCents: Number(row.price_cents),
    currency: row.currency,
    domesticShippingCents: row.domestic_shipping_cents === null ? null : Number(row.domestic_shipping_cents),
    spec: row.spec,
    sizes: row.sizes || [],
    colors: row.colors || [],
    skus: row.skus || [],
    priceTiers: row.price_tiers || [],
    minOrderQuantity: row.min_order_quantity,
    source: row.source,
    sourceCapturedAt: row.source_captured_at,
    createdAt: row.created_at
  };
}

export function normalizePriceCalculation(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    snapshotId: row.snapshot_id,
    spec: row.spec,
    quantity: row.quantity,
    unitPriceCents: Number(row.unit_price_cents),
    itemsCents: Number(row.items_cents),
    domesticShippingCents: row.domestic_shipping_cents === null ? null : Number(row.domestic_shipping_cents),
    totalCents: row.total_cents === null ? null : Number(row.total_cents),
    complete: row.complete,
    reason: row.reason,
    currency: row.currency,
    createdAt: row.created_at
  };
}
