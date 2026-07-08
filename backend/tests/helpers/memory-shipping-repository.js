import { randomUUID } from "node:crypto";
import {
  normalizeParcel,
  normalizeParcelItem,
  normalizeParcelWarehouseItem,
  normalizeShippingLine,
  normalizeShippingPayment,
  normalizeShippingQuote,
  normalizeTrackingEvent,
  normalizeWebhookEvent
} from "../../src/shipping/shipping-repository.js";

export class MemoryShippingRepository {
  constructor() {
    this.shippingLines = new Map();
    this.warehouseItems = new Map();
    this.parcels = new Map();
    this.parcelItems = new Map();
    this.quotes = new Map();
    this.payments = new Map();
    this.webhookEvents = new Map();
    this.trackingEvents = new Map();
  }

  seedWarehouseItem(input = {}) {
    const now = new Date().toISOString();
    const item = normalizeParcelWarehouseItem({
      id: input.id || randomUUID(),
      userId: input.userId,
      purchaseOrderId: input.purchaseOrderId || randomUUID(),
      haulItemId: input.haulItemId || randomUUID(),
      status: input.status || "ready_to_ship",
      weightGrams: input.weightGrams ?? 1000,
      title: input.title || "Warehouse item",
      spec: input.spec || "Black / M",
      priceCents: input.priceCents || 3500,
      currency: input.currency || "USD",
      quantity: input.quantity || 1,
      sourcePlatform: input.sourcePlatform || "Taobao",
      sourceDomain: input.sourceDomain || "item.taobao.com",
      receivedAt: input.receivedAt || now
    });
    this.warehouseItems.set(item.id, item);
    return clone(item);
  }

  async upsertShippingLines(lines) {
    for (const line of lines) {
      const existing = Array.from(this.shippingLines.values()).find((entry) => entry.code === line.code);
      const now = new Date().toISOString();
      const normalized = normalizeShippingLine({
        id: existing?.id || randomUUID(),
        code: line.code,
        name: line.name,
        destinationCountry: line.destinationCountry,
        serviceLevel: line.serviceLevel,
        status: line.status,
        currency: line.currency,
        billingRules: line.billingRules,
        restrictionRules: line.restrictionRules,
        deliveryMinDays: line.deliveryMinDays,
        deliveryMaxDays: line.deliveryMaxDays,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });
      this.shippingLines.set(normalized.id, normalized);
    }
    return { imported: lines.length };
  }

  async listShippingLines(country = "") {
    return Array.from(this.shippingLines.values())
      .filter((line) => !country || line.destinationCountry === country)
      .sort((a, b) => `${a.destinationCountry}-${a.serviceLevel}-${a.name}`.localeCompare(`${b.destinationCountry}-${b.serviceLevel}-${b.name}`))
      .map(clone);
  }

  async findShippingLineById(id) {
    return clone(this.shippingLines.get(id));
  }

  async findShippingLineByCode(code) {
    return clone(Array.from(this.shippingLines.values()).find((line) => line.code === code));
  }

  async findWarehouseItemsForParcel(userId, warehouseItemIds) {
    return warehouseItemIds
      .map((id) => this.warehouseItems.get(id))
      .filter((item) => item?.userId === userId)
      .map(clone);
  }

  async findActiveParcelByWarehouseItemIds(userId, warehouseItemIds) {
    const parcel = Array.from(this.parcels.values()).find((entry) => {
      if (entry.userId !== userId || entry.status === "cancelled") return false;
      const items = this.parcelItems.get(entry.id) || [];
      return items.some((item) => item.status === "active" && warehouseItemIds.includes(item.warehouseItemId));
    });
    return parcel ? { ...clone(parcel), items: await this.listParcelItems(parcel.id) } : null;
  }

  async createParcelDraft({ userId, warehouseItems }) {
    const now = new Date().toISOString();
    const parcel = normalizeParcel({
      id: randomUUID(),
      userId,
      status: "draft",
      destinationCountry: "",
      recipientName: "",
      address: {},
      currency: "USD",
      trackingNumber: "",
      createdAt: now,
      updatedAt: now
    });
    const items = warehouseItems.map((item) => normalizeParcelItem({
      id: randomUUID(),
      parcelId: parcel.id,
      userId,
      warehouseItemId: item.id,
      haulItemId: item.haulItemId,
      weightGrams: item.weightGrams,
      status: "active",
      title: item.title,
      spec: item.spec,
      priceCents: item.priceCents,
      currency: item.currency,
      quantity: item.quantity,
      sourcePlatform: item.sourcePlatform,
      sourceDomain: item.sourceDomain,
      createdAt: now
    }));
    this.parcels.set(parcel.id, parcel);
    this.parcelItems.set(parcel.id, items);
    return { ...clone(parcel), items: items.map(clone) };
  }

  async listParcels(userId) {
    const parcels = Array.from(this.parcels.values())
      .filter((parcel) => parcel.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return Promise.all(parcels.map(async (parcel) => ({ ...clone(parcel), items: await this.listParcelItems(parcel.id) })));
  }

  async findParcelForUser(userId, parcelId) {
    const parcel = this.parcels.get(parcelId);
    return parcel?.userId === userId ? { ...clone(parcel), items: await this.listParcelItems(parcel.id) } : null;
  }

  async findParcelById(parcelId) {
    const parcel = this.parcels.get(parcelId);
    return parcel ? { ...clone(parcel), items: await this.listParcelItems(parcel.id) } : null;
  }

  async listParcelItems(parcelId) {
    return (this.parcelItems.get(parcelId) || []).filter((item) => item.status === "active").map(clone);
  }

  async createQuote(input) {
    const quote = normalizeShippingQuote({
      id: randomUUID(),
      userId: input.userId,
      parcelId: input.parcelId,
      shippingLineId: input.shippingLineId,
      destinationCountry: input.destinationCountry,
      status: "quoted",
      amountCents: input.amountCents,
      currency: input.currency,
      actualWeightGrams: input.actualWeightGrams,
      volumetricWeightGrams: input.volumetricWeightGrams,
      chargeableWeightGrams: input.chargeableWeightGrams,
      lineSnapshot: input.lineSnapshot,
      itemSnapshot: input.itemSnapshot,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString()
    });
    this.quotes.set(quote.id, quote);
    return clone(quote);
  }

  async findQuoteForUser(userId, quoteId) {
    const quote = this.quotes.get(quoteId);
    return quote?.userId === userId ? clone(quote) : null;
  }

  async submitParcel(input) {
    const parcel = this.parcels.get(input.parcelId);
    if (!parcel || parcel.userId !== input.userId) return null;
    parcel.status = "shipping_due";
    parcel.shippingLineId = input.shippingLineId;
    parcel.quoteId = input.quoteId;
    parcel.destinationCountry = input.destinationCountry;
    parcel.recipientName = input.recipientName;
    parcel.address = input.address;
    parcel.chargeableWeightGrams = input.chargeableWeightGrams;
    parcel.finalFeeCents = input.finalFeeCents;
    parcel.finalFee = input.finalFeeCents / 100;
    parcel.currency = input.currency;
    parcel.submittedAt = parcel.submittedAt || new Date().toISOString();
    parcel.updatedAt = new Date().toISOString();
    const quote = this.quotes.get(input.quoteId);
    if (quote) quote.status = "used";
    return { ...clone(parcel), items: await this.listParcelItems(parcel.id) };
  }

  async findPaymentByIdempotency(userId, idempotencyKey) {
    const payment = Array.from(this.payments.values())
      .find((entry) => entry.userId === userId && entry.idempotencyKey === idempotencyKey);
    return clone(payment);
  }

  async createPayment(input) {
    const payment = normalizeShippingPayment({
      id: randomUUID(),
      userId: input.userId,
      parcelId: input.parcelId,
      idempotencyKey: input.idempotencyKey,
      paymentIntentId: input.paymentIntentId,
      provider: "mock",
      status: "requires_payment",
      amountCents: input.amountCents,
      currency: input.currency,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.payments.set(payment.id, payment);
    const parcel = this.parcels.get(input.parcelId);
    if (parcel?.status === "shipping_due") parcel.status = "payment_pending";
    return clone(payment);
  }

  async findPaymentByIntent(paymentIntentId) {
    return clone(Array.from(this.payments.values()).find((payment) => payment.paymentIntentId === paymentIntentId));
  }

  async findWebhookEvent(eventId) {
    return clone(this.webhookEvents.get(eventId));
  }

  async applyPaymentWebhook(input) {
    const existing = this.webhookEvents.get(input.eventId);
    if (existing) return { event: clone(existing), duplicate: true };
    const event = normalizeWebhookEvent({
      id: randomUUID(),
      eventId: input.eventId,
      paymentIntentId: input.paymentIntentId,
      status: input.status,
      payload: input.payload,
      createdAt: new Date().toISOString()
    });
    this.webhookEvents.set(event.eventId, event);
    const payment = Array.from(this.payments.values()).find((entry) => entry.paymentIntentId === input.paymentIntentId);
    if (payment) {
      payment.status = input.status;
      payment.updatedAt = new Date().toISOString();
      if (input.status === "succeeded") {
        const parcel = this.parcels.get(payment.parcelId);
        if (parcel) {
          parcel.status = "paid";
          parcel.paidAt = parcel.paidAt || new Date().toISOString();
        }
      } else if (["failed", "cancelled"].includes(input.status)) {
        const parcel = this.parcels.get(payment.parcelId);
        if (parcel?.status === "payment_pending") {
          parcel.status = "shipping_due";
        }
      }
    }
    return { event: clone(event), payment: clone(payment), duplicate: false };
  }

  async updateParcelStatus(input) {
    const parcel = this.parcels.get(input.parcelId);
    if (!parcel) return null;
    parcel.status = input.status;
    if (input.trackingNumber) parcel.trackingNumber = input.trackingNumber;
    if (["dispatched", "in_transit"].includes(input.status)) parcel.shippedAt = parcel.shippedAt || new Date().toISOString();
    if (input.status === "delivered") parcel.deliveredAt = parcel.deliveredAt || new Date().toISOString();
    if (input.status === "cancelled") {
      const items = this.parcelItems.get(parcel.id) || [];
      items.forEach((item) => {
        item.status = "removed";
      });
    }
    parcel.updatedAt = new Date().toISOString();
    return { ...clone(parcel), items: await this.listParcelItems(parcel.id) };
  }

  async addTrackingEvent(input) {
    const event = normalizeTrackingEvent({
      id: randomUUID(),
      parcelId: input.parcelId,
      userId: input.userId,
      status: input.status,
      location: input.location || "",
      message: input.message || "",
      occurredAt: input.occurredAt || new Date().toISOString(),
      createdByAdminUserId: input.createdByAdminUserId || null,
      createdAt: new Date().toISOString()
    });
    const events = this.trackingEvents.get(input.parcelId) || [];
    events.push(event);
    this.trackingEvents.set(input.parcelId, events);
    return clone(event);
  }

  async listTrackingEvents(userId, parcelId) {
    return (this.trackingEvents.get(parcelId) || [])
      .filter((event) => event.userId === userId)
      .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)))
      .map(clone);
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
