import { randomUUID } from "node:crypto";
import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText } from "../core/core-input.js";
import { quoteShippingLine } from "./quote-calculator.js";
import { verifyPaymentWebhookSignature } from "./payment-webhook.js";

const MAX_PARCEL_ITEMS = 30;
const ADMIN_TRANSITIONS = Object.freeze({
  draft: ["cancelled"],
  shipping_due: ["cancelled"],
  payment_pending: ["cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["dispatched", "cancelled"],
  dispatched: ["in_transit"],
  in_transit: ["delivered"],
  delivered: [],
  cancelled: []
});

export function createShippingService({
  repository,
  env,
  couponService = null,
  auditLogger = null,
  clock = () => new Date()
} = {}) {
  if (!repository) throw new Error("Shipping repository is required.");
  if (!env) throw new Error("Shipping service env is required.");

  return {
    async listShippingLines(country = "") {
      const lines = await repository.listShippingLines(optionalText(country, "country", 80));
      return { lines: lines.map(publicShippingLine) };
    },

    async listParcels(user) {
      const parcels = await repository.listParcels(user.id);
      return { parcels: parcels.map(publicParcel) };
    },

    async createParcelDraft(user, input = {}, requestMeta = {}) {
      const warehouseItemIds = normalizeIdList(input.warehouse_item_ids ?? input.warehouseItemIds, "warehouse_item_ids");
      const existing = await repository.findActiveParcelByWarehouseItemIds(user.id, warehouseItemIds);
      if (existing) {
        if (sameSet(existing.items.map((item) => item.warehouseItemId), warehouseItemIds)) {
          return { parcel: publicParcel(existing), existing: true };
        }
        throw conflict("At least one item is already reserved in another parcel.");
      }

      const items = await requireReadyWarehouseItems(repository, user.id, warehouseItemIds);
      const parcel = await repository.createParcelDraft({ userId: user.id, warehouseItems: items });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "parcel.draft.create",
        resourceType: "parcel",
        resourceId: parcel.id,
        metadata: { warehouse_item_ids: warehouseItemIds },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { parcel: publicParcel(parcel), existing: false };
    },

    async previewShipping(user, input = {}) {
      const destinationCountry = requiredText(input.country ?? input.destination_country, "country", 80);
      const { parcel, items } = await resolvePreviewItems(repository, user.id, input);
      const lines = await repository.listShippingLines(destinationCountry);
      const expiresAt = new Date(clock().getTime() + env.shippingQuoteTtlSeconds * 1000).toISOString();
      const quotes = [];

      for (const line of lines) {
        const quoted = quoteShippingLine(line, items, input.dimensions_cm || input.dimensionsCm || {});
        if (!quoted.available) {
          quotes.push({
            available: false,
            line: publicShippingLine(line),
            reasons: quoted.reasons
          });
          continue;
        }

        const quote = await repository.createQuote({
          userId: user.id,
          parcelId: parcel?.id || null,
          shippingLineId: line.id,
          destinationCountry,
          amountCents: quoted.amountCents,
          currency: quoted.currency,
          actualWeightGrams: quoted.actualWeightGrams,
          volumetricWeightGrams: quoted.volumetricWeightGrams,
          chargeableWeightGrams: quoted.chargeableWeightGrams,
          lineSnapshot: publicShippingLine(line),
          itemSnapshot: items.map(publicQuoteItem),
          expiresAt
        });
        quotes.push(publicShippingQuote(quote, line));
      }

      return {
        parcel_id: parcel?.id || null,
        destination_country: destinationCountry,
        quotes
      };
    },

    async submitParcel(user, input = {}, requestMeta = {}) {
      const parcelId = requiredText(input.parcel_id ?? input.parcelId, "parcel_id", 80);
      const quoteId = requiredText(input.quote_id ?? input.quoteId, "quote_id", 80);
      const parcel = await repository.findParcelForUser(user.id, parcelId);
      if (!parcel) throw notFound("Parcel not found.");
      if (parcel.status === "shipping_due" && parcel.quoteId === quoteId) {
        return { parcel: publicParcel(parcel), existing: true };
      }
      if (parcel.status !== "draft") {
        throw conflict("Only draft parcels can be submitted.");
      }

      const quote = await repository.findQuoteForUser(user.id, quoteId);
      if (!quote) throw notFound("Shipping quote not found.");
      if (quote.status !== "quoted" || new Date(quote.expiresAt).getTime() <= clock().getTime()) {
        throw conflict("Shipping quote expired. Please preview shipping again.");
      }
      if (quote.parcelId && quote.parcelId !== parcel.id) {
        throw conflict("Shipping quote does not belong to this parcel.");
      }
      if (!sameSet(quote.itemSnapshot.map((item) => item.warehouse_item_id), parcel.items.map((item) => item.warehouseItemId))) {
        throw conflict("Shipping quote no longer matches parcel items.");
      }

      const address = normalizeAddress(input.address || {});
      if (address.country !== quote.destinationCountry) {
        throw badRequest("Shipping address country must match the selected quote.", { field: "address.country" });
      }

      const submitted = await repository.submitParcel({
        userId: user.id,
        parcelId: parcel.id,
        shippingLineId: quote.shippingLineId,
        quoteId: quote.id,
        destinationCountry: address.country,
        recipientName: address.recipient_name,
        address,
        chargeableWeightGrams: quote.chargeableWeightGrams,
        finalFeeCents: quote.amountCents,
        currency: quote.currency
      });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "parcel.submit",
        resourceType: "parcel",
        resourceId: submitted.id,
        metadata: { quote_id: quote.id, final_fee_cents: quote.amountCents },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { parcel: publicParcel(submitted), existing: false };
    },

    async createShippingPayment(user, input = {}, requestMeta = {}) {
      const parcelId = requiredText(input.parcel_id ?? input.parcelId, "parcel_id", 80);
      const idempotencyKey = requiredText(input.idempotency_key ?? input.idempotencyKey, "idempotency_key", 120);
      const existing = await repository.findPaymentByIdempotency(user.id, idempotencyKey);
      if (existing) {
        return { payment: publicShippingPayment(existing), existing: true };
      }

      const parcel = await repository.findParcelForUser(user.id, parcelId);
      if (!parcel) throw notFound("Parcel not found.");
      if (parcel.status === "payment_pending") {
        throw conflict("Shipping payment is already pending. Retry with the same idempotency key.");
      }
      if (parcel.status !== "shipping_due") {
        throw conflict("Only parcels with shipping_due status can be paid.");
      }
      if (!Number.isInteger(parcel.finalFeeCents) || parcel.finalFeeCents < 0) {
        throw conflict("Parcel final shipping fee is not ready.");
      }

      const payment = await repository.createPayment({
        userId: user.id,
        parcelId: parcel.id,
        idempotencyKey,
        paymentIntentId: `pi_${randomUUID()}`,
        amountCents: parcel.finalFeeCents,
        currency: parcel.currency
      });
      await auditLogger?.write({
        actorType: "user",
        actorUserId: user.id,
        action: "shipping_payment.create",
        resourceType: "shipping_payment",
        resourceId: payment.id,
        metadata: { parcel_id: parcel.id, amount_cents: payment.amountCents },
        requestId: requestMeta.requestId
      }, { critical: false });
      return { payment: publicShippingPayment(payment), existing: false };
    },

    async handlePaymentWebhook(input = {}, signature = "") {
      if (!verifyPaymentWebhookSignature(input, signature, env.shippingWebhookSecret)) {
        throw forbidden("Shipping payment webhook signature is invalid.");
      }

      const eventId = requiredText(input.event_id ?? input.eventId, "event_id", 160);
      const paymentIntentId = requiredText(input.payment_intent_id ?? input.paymentIntentId, "payment_intent_id", 160);
      const status = normalizePaymentStatus(input.status);
      const amountCents = optionalNonNegativeInteger(input.amount_cents ?? input.amountCents, "amount_cents");
      const payment = await repository.findPaymentByIntent(paymentIntentId);
      if (!payment) throw notFound("Shipping payment not found.");
      if (amountCents !== null && amountCents !== payment.amountCents) {
        throw conflict("Webhook amount does not match payment intent.");
      }

      const result = await repository.applyPaymentWebhook({
        eventId,
        paymentIntentId,
        status,
        payload: input
      });
      if (!result.duplicate && result.payment) {
        await couponService?.syncCouponForPayment(result.payment);
      }
      return {
        event: publicWebhookEvent(result.event),
        payment: result.payment ? publicShippingPayment(result.payment) : publicShippingPayment(payment),
        existing: result.duplicate
      };
    },

    async getTracking(user, parcelId) {
      const parcel = await repository.findParcelForUser(user.id, parcelId);
      if (!parcel) throw notFound("Parcel not found.");
      const events = await repository.listTrackingEvents(user.id, parcel.id);
      return {
        tracking: {
          parcel_id: parcel.id,
          status: events.length ? events[events.length - 1].status : "pending",
          tracking_number: parcel.trackingNumber || null,
          events: events.map(publicTrackingEvent)
        }
      };
    },

    async updateAdminParcelStatus(adminUser, parcelId, input = {}, requestMeta = {}) {
      const parcel = await repository.findParcelById(parcelId);
      if (!parcel) throw notFound("Parcel not found.");
      const nextStatus = normalizeParcelStatus(input.status);
      if (nextStatus === parcel.status) {
        return { parcel: publicParcel(parcel), existing: true };
      }
      if (!ADMIN_TRANSITIONS[parcel.status]?.includes(nextStatus)) {
        throw conflict(`Cannot move parcel from ${parcel.status} to ${nextStatus}.`);
      }
      const trackingNumber = optionalText(input.tracking_number ?? input.trackingNumber, "tracking_number", 120);
      if (nextStatus === "dispatched" && !trackingNumber && !parcel.trackingNumber) {
        throw badRequest("tracking_number is required when dispatching a parcel.", { field: "tracking_number" });
      }

      const updated = await repository.updateParcelStatus({
        parcelId: parcel.id,
        status: nextStatus,
        trackingNumber
      });
      if (["processing", "dispatched", "in_transit", "delivered"].includes(nextStatus)) {
        await repository.addTrackingEvent({
          parcelId: parcel.id,
          userId: parcel.userId,
          status: nextStatus,
          location: optionalText(input.location, "location", 160),
          message: optionalText(input.message, "message", 500) || statusMessage(nextStatus),
          occurredAt: input.occurred_at || null,
          createdByAdminUserId: adminUser.id
        });
      }
      await auditLogger?.write({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "parcel.status.update",
        resourceType: "parcel",
        resourceId: parcel.id,
        metadata: { from_status: parcel.status, to_status: nextStatus },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { parcel: publicParcel(updated), existing: false };
    }
  };
}

export function publicShippingLine(line) {
  return {
    id: line.id,
    code: line.code,
    name: line.name,
    destination_country: line.destinationCountry,
    service_level: line.serviceLevel,
    status: line.status,
    currency: line.currency,
    billing_rules: line.billingRules,
    restriction_rules: line.restrictionRules,
    delivery_min_days: line.deliveryMinDays,
    delivery_max_days: line.deliveryMaxDays,
    created_at: line.createdAt,
    updated_at: line.updatedAt
  };
}

export function publicParcel(parcel) {
  return {
    id: parcel.id,
    status: parcel.status,
    shipping_line_id: parcel.shippingLineId,
    quote_id: parcel.quoteId,
    destination_country: parcel.destinationCountry,
    recipient_name: parcel.recipientName,
    address: parcel.address,
    chargeable_weight_grams: parcel.chargeableWeightGrams,
    final_fee_cents: parcel.finalFeeCents,
    final_fee: parcel.finalFee,
    currency: parcel.currency,
    tracking_number: parcel.trackingNumber,
    submitted_at: parcel.submittedAt,
    paid_at: parcel.paidAt,
    shipped_at: parcel.shippedAt,
    delivered_at: parcel.deliveredAt,
    created_at: parcel.createdAt,
    updated_at: parcel.updatedAt,
    items: (parcel.items || []).map(publicParcelItem)
  };
}

export function publicParcelItem(item) {
  return {
    warehouse_item_id: item.warehouseItemId,
    haul_item_id: item.haulItemId,
    title: item.title,
    spec: item.spec,
    price: item.price,
    currency: item.currency,
    quantity: item.quantity,
    weight_grams: item.weightGrams,
    weight_kg: item.weightGrams / 1000,
    source_platform: item.sourcePlatform,
    source_domain: item.sourceDomain
  };
}

export function publicShippingQuote(quote, line = null) {
  return {
    available: true,
    quote_id: quote.id,
    line: line ? publicShippingLine(line) : quote.lineSnapshot,
    amount_cents: quote.amountCents,
    amount: quote.amount,
    currency: quote.currency,
    actual_weight_grams: quote.actualWeightGrams,
    volumetric_weight_grams: quote.volumetricWeightGrams,
    chargeable_weight_grams: quote.chargeableWeightGrams,
    expires_at: quote.expiresAt,
    reasons: []
  };
}

export function publicShippingPayment(payment) {
  return {
    id: payment.id,
    parcel_id: payment.parcelId,
    payment_intent_id: payment.paymentIntentId,
    provider: payment.provider,
    status: payment.status,
    amount_cents: payment.amountCents,
    amount: payment.amount,
    currency: payment.currency,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt
  };
}

function publicWebhookEvent(event) {
  return {
    id: event.id,
    event_id: event.eventId,
    payment_intent_id: event.paymentIntentId,
    status: event.status,
    created_at: event.createdAt
  };
}

function publicTrackingEvent(event) {
  return {
    id: event.id,
    status: event.status,
    location: event.location,
    message: event.message,
    occurred_at: event.occurredAt
  };
}

function publicQuoteItem(item) {
  return {
    warehouse_item_id: item.id,
    haul_item_id: item.haulItemId,
    title: item.title,
    weight_grams: item.weightGrams
  };
}

async function resolvePreviewItems(repository, userId, input) {
  const parcelId = input.parcel_id ?? input.parcelId;
  if (parcelId) {
    const parcel = await repository.findParcelForUser(userId, String(parcelId));
    if (!parcel) throw notFound("Parcel not found.");
    if (!["draft", "shipping_due"].includes(parcel.status)) {
      throw conflict("Only draft parcels can be previewed.");
    }
    return {
      parcel,
      items: parcel.items.map((item) => ({
        id: item.warehouseItemId,
        userId: item.userId,
        haulItemId: item.haulItemId,
        status: "ready_to_ship",
        weightGrams: item.weightGrams,
        title: item.title,
        spec: item.spec,
        price: item.price,
        currency: item.currency,
        quantity: item.quantity,
        sourcePlatform: item.sourcePlatform,
        sourceDomain: item.sourceDomain
      }))
    };
  }

  const warehouseItemIds = normalizeIdList(input.warehouse_item_ids ?? input.warehouseItemIds, "warehouse_item_ids");
  return {
    parcel: null,
    items: await requireReadyWarehouseItems(repository, userId, warehouseItemIds)
  };
}

async function requireReadyWarehouseItems(repository, userId, warehouseItemIds) {
  const items = await repository.findWarehouseItemsForParcel(userId, warehouseItemIds);
  if (items.length !== warehouseItemIds.length) {
    throw notFound("One or more warehouse items were not found.");
  }
  const badItem = items.find((item) => item.status !== "ready_to_ship" || !item.weightGrams);
  if (badItem) {
    throw conflict("Only ready_to_ship warehouse items with weight can be packed.");
  }
  return warehouseItemIds.map((id) => items.find((item) => item.id === id));
}

function normalizeIdList(value, field) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PARCEL_ITEMS) {
    throw badRequest(`${field} must include 1-${MAX_PARCEL_ITEMS} ids.`, { field });
  }
  const ids = value.map((id) => requiredText(id, field, 80));
  return Array.from(new Set(ids));
}

function normalizeAddress(input) {
  return {
    recipient_name: requiredText(input.recipient_name ?? input.recipientName ?? input.name, "address.recipient_name", 120),
    line1: requiredText(input.line1, "address.line1", 240),
    line2: optionalText(input.line2, "address.line2", 240),
    city: requiredText(input.city, "address.city", 120),
    region: optionalText(input.region ?? input.state, "address.region", 120),
    postal_code: requiredText(input.postal_code ?? input.postalCode, "address.postal_code", 40),
    country: requiredText(input.country, "address.country", 80),
    phone: requiredText(input.phone, "address.phone", 60)
  };
}

function normalizePaymentStatus(status) {
  if (!["processing", "succeeded", "failed", "cancelled"].includes(status)) {
    throw badRequest("Unsupported payment webhook status.", { field: "status" });
  }
  return status;
}

function normalizeParcelStatus(status) {
  if (!Object.hasOwn(ADMIN_TRANSITIONS, status)) {
    throw badRequest("Unsupported parcel status.", { field: "status" });
  }
  return status;
}

function requiredText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw badRequest(`${field} is required.`, { field });
  if (text.length > maxLength) throw badRequest(`${field} is too long.`, { field, maxLength });
  return text;
}

function optionalNonNegativeInteger(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw badRequest(`${field} must be a non-negative integer.`, { field });
  }
  return number;
}

function sameSet(left, right) {
  return left.length === right.length && left.map(String).sort().join("|") === right.map(String).sort().join("|");
}

function statusMessage(status) {
  const messages = {
    processing: "Parcel is being prepared for international dispatch.",
    dispatched: "Parcel has been dispatched to the carrier.",
    in_transit: "Parcel is in transit.",
    delivered: "Parcel has been delivered."
  };
  return messages[status] || status;
}
