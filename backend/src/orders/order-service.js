import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { calculatePayable } from "../catalog/price-calculator.js";
import { optionalText, requiredPositiveInteger, requiredText } from "../core/core-input.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";
import { FULFILLMENT_STATUSES, FULFILLMENT_TERMINAL, isAllowedTransition } from "./order-status.js";

// V2-04-03 — parent/child order creation. Every item is re-priced from its own
// immutable snapshot server-side (never trusting client totals), all items
// commit in one transaction, and a repeated submit key is idempotent.
const MAX_ITEMS = 50;

export function createOrderService({ repository, catalogRepository, auditLogger = null, accountPicker = null, clock = () => Date.now() } = {}) {
  if (!repository) {
    throw new Error("Order repository is required.");
  }
  if (!catalogRepository) {
    throw new Error("Catalog repository is required.");
  }

  return {
    async createOrder(user, input, requestMeta = {}) {
      const submitKey = requiredText(input?.submit_key, "submit_key", 120);
      const rawItems = Array.isArray(input?.items) ? input.items : null;
      if (!rawItems || rawItems.length === 0) {
        throw badRequest("At least one item is required.", { field: "items" });
      }
      if (rawItems.length > MAX_ITEMS) {
        throw badRequest(`An order can contain at most ${MAX_ITEMS} items.`, { field: "items" });
      }

      // Idempotent: a repeated submit key returns the same parent order rather
      // than creating a second one.
      const existing = await repository.findParentBySubmitKey(user.id, submitKey);
      if (existing) {
        const items = await repository.listItemsByParent(existing.id);
        return { order: publicParent(existing, items), existing: true };
      }

      const priced = [];
      for (let index = 0; index < rawItems.length; index += 1) {
        priced.push(await priceItem(catalogRepository, user, rawItems[index], index));
      }
      let currency = null;
      for (const item of priced) {
        currency = currency || item.currency;
        if (item.currency !== currency) {
          throw badRequest("All items in one order must share a currency.", { field: "items" });
        }
      }
      const itemsTotalCents = priced.reduce((sum, item) => sum + item.totalCents, 0);

      const parent = {
        orderNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.parentOrder),
        userId: user.id,
        submitKey,
        itemCount: priced.length,
        itemsTotalCents,
        currency
      };
      const items = priced.map((item) => ({
        itemNo: generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.itemOrder),
        snapshotId: item.snapshotId,
        platform: item.platform,
        spec: item.spec,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        itemsCents: item.itemsCents,
        domesticShippingCents: item.domesticShippingCents,
        totalCents: item.totalCents,
        currency: item.currency
      }));

      let created;
      try {
        created = await repository.createOrderWithItems({ parent, items });
      } catch (error) {
        // Lost a race on the same submit key — return the winner's order.
        if (error?.code === "23505") {
          const race = await repository.findParentBySubmitKey(user.id, submitKey);
          if (race) {
            const raceItems = await repository.listItemsByParent(race.id);
            return { order: publicParent(race, raceItems), existing: true };
          }
        }
        throw error;
      }

      await auditLogger?.write?.({
        actorType: "user",
        actorUserId: user.id,
        action: "order.create",
        resourceType: "order_parent",
        resourceId: created.parent.id,
        metadata: { item_count: created.items.length, items_total_cents: itemsTotalCents },
        requestId: requestMeta.requestId
      }, { critical: false });

      return { order: publicParent(created.parent, created.items), existing: false };
    },

    async getOrder(user, parentId) {
      const parent = await repository.findParentById(user.id, parentId);
      if (!parent) {
        throw notFound("Order not found.");
      }
      const items = await repository.listItemsByParent(parent.id);
      return { order: publicParent(parent, items) };
    },

    async listOrders(user) {
      const parents = await repository.listParents(user.id);
      const orders = [];
      for (const parent of parents) {
        const items = await repository.listItemsByParent(parent.id);
        orders.push(publicParent(parent, items));
      }
      return { orders };
    },

    // V2-04-05 — post-payment processor. Idempotently marks the parent paid,
    // moves each pending item to agent_ordering, and assigns a purchase account.
    // A platform with no enabled account routes the item to the exception queue
    // (manual_review) instead of silently stalling. Safe to replay per eventId.
    async markPaidAndAssign(actor, parentId, { eventId } = {}) {
      const parent = await repository.findParentByIdAny(parentId);
      if (!parent) {
        throw notFound("Order not found.");
      }
      await repository.markParentPaid(parentId); // idempotent: null if already paid
      const items = await repository.listItemsByParent(parentId);
      const assignments = [];
      for (const item of items) {
        if (item.fulfillmentStatus === "pending_payment") {
          await applyTransition(repository, actor || { type: "system" }, item.id, "fulfillment", {
            to: "agent_ordering",
            action: "payment_settled",
            idempotency_key: `paid:${eventId || parentId}:${item.id}`
          });
        }
        const fresh = await repository.findItemById(item.id);
        if (fresh.fulfillmentStatus !== "agent_ordering" || fresh.purchaseAccountId) {
          assignments.push({ item_id: fresh.id, assigned: Boolean(fresh.purchaseAccountId), replay: true });
          continue;
        }
        const account = accountPicker ? await accountPicker(fresh.platform) : null;
        if (account) {
          await repository.assignItemAccount(fresh.id, account.id);
          assignments.push({ item_id: fresh.id, assigned: true, account_id: account.id });
        } else {
          await applyTransition(repository, { type: "system" }, fresh.id, "exception", {
            to: "manual_review",
            action: "no_purchase_account",
            idempotency_key: `noacct:${fresh.id}`
          });
          assignments.push({ item_id: fresh.id, assigned: false, reason: "no_purchase_account" });
        }
      }
      const updated = await repository.findParentByIdAny(parentId);
      const finalItems = await repository.listItemsByParent(parentId);
      return { order: publicParent(updated, finalItems), assignments };
    },

    // V2-04-06 — advance one item sub-order's fulfillment or exception field.
    // Illegal crossings are 409; a repeated idempotency key is a no-op replay.
    async transitionFulfillment(actor, itemId, input = {}) {
      return applyTransition(repository, actor, itemId, "fulfillment", input);
    },

    async transitionException(actor, itemId, input = {}) {
      return applyTransition(repository, actor, itemId, "exception", input);
    },

    async getItemHistory(itemId) {
      const item = await repository.findItemById(itemId);
      if (!item) {
        throw notFound("Item order not found.");
      }
      const history = await repository.listItemHistory(itemId);
      return { item: publicItem(item), history: history.map(publicHistory) };
    },

    // V2-04-10 — buyer raises a price-increase exception. The surcharge is
    // computed server-side ((new − ordered) × quantity); one open exception per
    // item; default 24h deadline.
    async raisePriceIncrease(adminUser, itemId, input = {}, requestMeta = {}) {
      const item = await repository.findItemById(itemId);
      if (!item) {
        throw notFound("Item order not found.");
      }
      if (item.fulfillmentStatus !== "purchasing") {
        throw conflict("A price increase can only be raised while 采购处理中.");
      }
      const newUnitPriceCents = Number(input?.new_unit_price_cents);
      if (!Number.isInteger(newUnitPriceCents) || newUnitPriceCents <= item.unitPriceCents) {
        throw badRequest("new_unit_price_cents must be an integer greater than the ordered unit price.", {
          field: "new_unit_price_cents", current_unit_price_cents: item.unitPriceCents
        });
      }
      const surchargeCents = (newUnitPriceCents - item.unitPriceCents) * item.quantity;
      const result = await createItemException(repository, {
        item,
        type: "price_increase",
        exceptionStatus: "price_change_pending",
        surchargeCents,
        detail: { old_unit_price_cents: item.unitPriceCents, new_unit_price_cents: newUnitPriceCents, quantity: item.quantity },
        deadlineAt: deadlineFrom(clock, input?.deadline_hours),
        adminUser,
        requestMeta
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "order.exception.price_increase",
        resourceType: "item_order", resourceId: itemId, metadata: { surcharge_cents: surchargeCents },
        requestId: requestMeta.requestId
      }, { critical: true });
      return result;
    },

    // V2-04-11 — buyer raises an availability (stockout / spec-unpurchasable)
    // exception; the user later chooses wait / change spec / change link / cancel.
    async raiseAvailability(adminUser, itemId, input = {}, requestMeta = {}) {
      const item = await repository.findItemById(itemId);
      if (!item) {
        throw notFound("Item order not found.");
      }
      if (item.fulfillmentStatus !== "purchasing") {
        throw conflict("An availability exception can only be raised while 采购处理中.");
      }
      const result = await createItemException(repository, {
        item,
        type: "availability",
        exceptionStatus: "availability_pending",
        surchargeCents: null,
        detail: { reason: optionalText(input?.reason, "reason", 500), options: ["wait", "change_spec", "change_link", "cancel"] },
        deadlineAt: deadlineFrom(clock, input?.deadline_hours),
        adminUser,
        requestMeta
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "order.exception.availability",
        resourceType: "item_order", resourceId: itemId, requestId: requestMeta.requestId
      }, { critical: true });
      return result;
    },

    async getItemException(user, itemId) {
      const item = await repository.findItemById(itemId);
      if (!item || item.userId !== user.id) {
        throw notFound("Item order not found.");
      }
      const exception = await repository.findOpenExceptionByItem(itemId);
      if (!exception) {
        return { exception: null, events: [] };
      }
      const events = await repository.listExceptionEvents(exception.id);
      return { exception: publicException(exception), events: events.map(publicExceptionEvent) };
    },

    // V2-04-12 — the user resolves an open exception. Choices are mutually
    // exclusive; a past-deadline exception refuses the action (409); repeat
    // clicks are idempotent (a closed exception is a 409, never a second effect).
    async respondException(user, itemId, input = {}, requestMeta = {}) {
      const item = await repository.findItemById(itemId);
      if (!item || item.userId !== user.id) {
        throw notFound("Item order not found.");
      }
      const exception = await repository.findOpenExceptionByItem(itemId);
      if (!exception) {
        throw notFound("No open exception for this item.");
      }
      if (clock() > Date.parse(exception.deadlineAt)) {
        throw conflict("This exception has passed its deadline and is being cancelled automatically.");
      }
      const choice = requiredText(input?.choice, "choice", 40);
      const allowed = exception.type === "price_increase"
        ? ["pay_surcharge", "cancel"]
        : ["wait", "change_spec", "change_link", "cancel"];
      if (!allowed.includes(choice)) {
        throw badRequest("Invalid choice for this exception.", { field: "choice", allowed });
      }

      let params;
      if (choice === "cancel") {
        params = { newStatus: "cancelled", itemExceptionStatus: "none", cancelItem: true, resolution: "cancel", eventAction: "user_cancel", eventDetail: {} };
      } else if (choice === "pay_surcharge") {
        // Wallet settlement is V2-05; here we accept and clear so the buyer continues.
        params = { newStatus: "resolved", itemExceptionStatus: "none", cancelItem: false, resolution: "surcharge_accepted", eventAction: "pay_surcharge", eventDetail: { surcharge_cents: exception.surchargeCents } };
      } else {
        const detail = {};
        if (choice === "change_spec") detail.spec = optionalText(input?.spec, "spec", 240);
        if (choice === "change_link") detail.link = optionalText(input?.link, "link", 1024);
        params = { newStatus: "resolved", itemExceptionStatus: "none", cancelItem: false, resolution: choice, eventAction: choice, eventDetail: detail };
      }

      let result;
      try {
        result = await repository.resolveException({
          exceptionId: exception.id, ...params, actorType: "user", actorId: user.id, requestId: requestMeta.requestId
        });
      } catch (error) {
        if (error?.code === "ORDER_EXCEPTION_CLOSED") {
          throw conflict("This exception has already been handled.");
        }
        throw error;
      }
      await auditLogger?.write?.({
        actorType: "user", actorUserId: user.id, action: `order.exception.${choice}`,
        resourceType: "item_order", resourceId: itemId, requestId: requestMeta.requestId
      }, { critical: false });
      return { exception: publicException(result.exception), item: publicItem(result.item) };
    },

    // V2-04-13 — cancel exceptions whose 24h deadline lapsed with no response.
    // Idempotent (a re-run finds nothing open past deadline); already-handled
    // exceptions are skipped, never re-cancelled.
    async autoCancelExpiredExceptions({ nowIso = null, limit = 100 } = {}) {
      const iso = nowIso || new Date(clock()).toISOString();
      const expired = await repository.listExpiredOpenExceptions(iso, limit);
      const ids = [];
      for (const exception of expired) {
        try {
          const result = await repository.resolveException({
            exceptionId: exception.id, newStatus: "expired", itemExceptionStatus: "none", cancelItem: true,
            resolution: "auto_cancel", eventAction: "auto_cancel_expired",
            eventDetail: { deadline_at: exception.deadlineAt }, actorType: "system", actorId: null
          });
          if (result.exception) {
            ids.push(exception.id);
            await auditLogger?.write?.({
              actorType: "system", action: "order.exception.auto_cancel",
              resourceType: "order_exception", resourceId: exception.id,
              metadata: { item_order_id: exception.itemOrderId }
            }, { critical: true });
          }
        } catch (error) {
          if (error?.code === "ORDER_EXCEPTION_CLOSED") continue; // already handled — idempotent
          throw error;
        }
      }
      return { cancelled: ids.length, ids };
    },

    // V2-04-14 — register (or correct) the merchant's domestic dispatch.
    async registerDispatch(adminUser, itemId, input = {}, requestMeta = {}) {
      return dispatchWrite(repository, auditLogger, adminUser, itemId, input, requestMeta, false);
    },

    async correctDispatch(adminUser, itemId, input = {}, requestMeta = {}) {
      return dispatchWrite(repository, auditLogger, adminUser, itemId, input, requestMeta, true);
    },

    // V2-04-15 — lead reassigns a non-terminal item's purchase account or buyer.
    async reassignItem(adminUser, itemId, input = {}, requestMeta = {}) {
      let result;
      try {
        result = await repository.reassignItem({
          itemId,
          accountId: input?.account_id || null,
          buyerAdminId: input?.buyer_admin_id || null,
          adminUserId: adminUser.id,
          requestId: requestMeta.requestId
        });
      } catch (error) {
        if (error?.code === "ORDER_STATUS_CONFLICT") throw conflict("A terminal item cannot be reassigned.");
        throw error;
      }
      if (!result.item) throw notFound("Item order not found.");
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "procurement.reassign",
        resourceType: "item_order", resourceId: itemId,
        metadata: { account_id: input?.account_id || null, buyer_admin_id: input?.buyer_admin_id || null },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { item: publicItem(result.item) };
    },

    // V2-04-15 — controlled correction of a fulfillment status the normal machine
    // rejects. Lead/super-admin only (route gates the permission); a correction
    // into a terminal state additionally requires the super_admin role.
    async controlledCorrection(adminUser, adminRoles, itemId, input = {}, requestMeta = {}) {
      const to = requiredText(input?.to, "to", 40);
      if (!FULFILLMENT_STATUSES.includes(to)) {
        throw badRequest("Unknown target status.", { field: "to" });
      }
      const roles = adminRoles || [];
      if (FULFILLMENT_TERMINAL.has(to) && !roles.includes("super_admin")) {
        throw forbidden("A correction into a terminal status requires super-admin re-verification.");
      }
      const item = await repository.findItemById(itemId);
      if (!item) throw notFound("Item order not found.");
      const result = await repository.forceTransition({
        itemId, to, action: "controlled_correction", adminUserId: adminUser.id, requestId: requestMeta.requestId
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "orders.controlled_correction",
        resourceType: "item_order", resourceId: itemId,
        metadata: { from: item.fulfillmentStatus, to, reason: optionalText(input?.reason, "reason", 500) },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { item: publicItem(result.item) };
    }
  };
}

async function dispatchWrite(repository, auditLogger, adminUser, itemId, input, requestMeta, correct) {
  const carrier = optionalText(input?.carrier, "carrier", 120);
  const trackingNo = optionalText(input?.tracking_no, "tracking_no", 120);
  if (!correct && !trackingNo) {
    throw badRequest("tracking_no is required.", { field: "tracking_no" });
  }
  let result;
  try {
    result = await repository.registerDispatch({
      itemId, carrier, trackingNo, adminUserId: adminUser.id, requestId: requestMeta.requestId, correct
    });
  } catch (error) {
    if (error?.code === "ORDER_STATUS_CONFLICT") {
      throw conflict(correct ? "Item is not dispatched yet." : "Item is not awaiting merchant dispatch.");
    }
    if (error?.code === "ORDER_TRACKING_CONFLICT") {
      throw conflict("This tracking number is already bound to another user's order.");
    }
    throw error;
  }
  if (!result.item) throw notFound("Item order not found.");
  await auditLogger?.write?.({
    actorType: "admin", actorAdminUserId: adminUser.id,
    action: correct ? "procurement.dispatch_correct" : "procurement.dispatch_register",
    resourceType: "item_order", resourceId: itemId,
    metadata: { carrier, tracking_no: trackingNo }, requestId: requestMeta.requestId
  }, { critical: true });
  return { item: publicItem(result.item) };
}

function deadlineFrom(clock, hoursInput) {
  const h = Number(hoursInput);
  const hours = Number.isInteger(h) && h > 0 && h <= 168 ? h : 24;
  return new Date(clock() + hours * 3600 * 1000).toISOString();
}

async function createItemException(repository, { item, type, exceptionStatus, surchargeCents, detail, deadlineAt, adminUser, requestMeta }) {
  let result;
  try {
    result = await repository.createException({
      itemOrderId: item.id, userId: item.userId, type, exceptionStatus, surchargeCents,
      currency: item.currency, detail, deadlineAt, createdByAdminId: adminUser.id, requestId: requestMeta.requestId
    });
  } catch (error) {
    if (error?.code === "ORDER_EXCEPTION_ACTIVE" || error?.code === "23505") {
      throw conflict("An exception is already active on this item.");
    }
    throw error;
  }
  if (!result.exception) {
    throw notFound("Item order not found.");
  }
  return { exception: publicException(result.exception), item: publicItem(result.item) };
}

async function applyTransition(repository, actor, itemId, field, input) {
  const item = await repository.findItemById(itemId);
  if (!item) {
    throw notFound("Item order not found.");
  }
  const to = requiredText(input?.to, "to", 40);
  const action = requiredText(input?.action, "action", 60);
  const reason = optionalText(input?.reason, "reason", 500);
  const from = field === "exception" ? item.exceptionStatus : item.fulfillmentStatus;

  // Idempotent replay: a key already recorded means this action ran before (the
  // item is already in the target state). Return it as a no-op — this must be
  // checked before the transition legality check, since from == to would
  // otherwise read as an illegal same-state crossing.
  const idempotencyKey = input?.idempotency_key || null;
  if (idempotencyKey) {
    const prior = await repository.findTransition(itemId, idempotencyKey);
    if (prior) {
      return { item: publicItem(item), replay: true };
    }
  }

  if (!isAllowedTransition(field, from, to)) {
    throw conflict(`Illegal ${field} transition ${from} → ${to}.`, { from, to, field });
  }

  let result;
  try {
    result = await repository.transitionItemStatus({
      itemId,
      field,
      expectedFrom: from,
      to,
      action,
      reason,
      actorType: actor?.type || "system",
      actorId: actor?.id || null,
      actorRole: actor?.role || "",
      idempotencyKey: input?.idempotency_key || null,
      requestId: input?.requestId || "",
      evidence: input?.evidence || {}
    });
  } catch (error) {
    if (error?.code === "ORDER_STATUS_CONFLICT") {
      throw conflict("Item status changed concurrently; refresh and retry.", { field });
    }
    throw error;
  }
  if (!result.item) {
    throw notFound("Item order not found.");
  }
  return { item: publicItem(result.item), replay: Boolean(result.replay) };
}

async function priceItem(catalogRepository, user, raw, index) {
  const snapshotId = requiredText(raw?.snapshot_id, `items[${index}].snapshot_id`, 64);
  const snapshot = await catalogRepository.findSnapshot(user.id, snapshotId);
  if (!snapshot) {
    throw notFound(`Snapshot not found for item ${index + 1}.`);
  }
  const quantity = requiredPositiveInteger(raw?.quantity, `items[${index}].quantity`);
  const spec = optionalText(raw?.spec, `items[${index}].spec`, 240);
  const skus = Array.isArray(snapshot.skus) ? snapshot.skus : [];
  const sku = spec ? skus.find((entry) => entry.spec === spec) : null;

  if (spec && skus.length && !sku) {
    throw badRequest(`Selected specification is not available for item ${index + 1}.`, { field: "spec" });
  }
  if (sku && sku.available === false) {
    throw conflict(`Selected specification is sold out for item ${index + 1}.`);
  }

  const unitPriceCents = sku ? sku.priceCents : snapshot.priceCents;
  // Price-change guard: force a re-confirm if the price moved since it was shown.
  if (raw?.expected_unit_price_cents !== undefined && raw.expected_unit_price_cents !== null) {
    if (Number(raw.expected_unit_price_cents) !== unitPriceCents) {
      throw conflict(`Price changed for item ${index + 1}; please review and reconfirm.`, {
        expected_unit_price_cents: Number(raw.expected_unit_price_cents),
        current_unit_price_cents: unitPriceCents
      });
    }
  }

  const minOrderQuantity = sku?.minOrderQuantity || snapshot.minOrderQuantity || 1;
  if (quantity < minOrderQuantity) {
    throw badRequest(`Quantity for item ${index + 1} must be at least ${minOrderQuantity}.`, {
      field: "quantity",
      min: minOrderQuantity
    });
  }

  const calculation = calculatePayable({
    unitPriceCents,
    quantity,
    domesticShippingCents: snapshot.domesticShippingCents,
    currency: snapshot.currency
  });
  // Unknown domestic shipping ⇒ not purchasable. Blocked, never charged as zero.
  if (!calculation.complete) {
    throw conflict(`Item ${index + 1} is not purchasable yet.`, { reason: calculation.reason });
  }

  return {
    snapshotId: snapshot.id,
    platform: snapshot.platform,
    spec,
    quantity,
    unitPriceCents: calculation.unitPriceCents,
    itemsCents: calculation.itemsCents,
    domesticShippingCents: calculation.domesticShippingCents,
    totalCents: calculation.totalCents,
    currency: calculation.currency
  };
}

export function publicParent(parent, items = []) {
  return {
    id: parent.id,
    order_no: parent.orderNo,
    item_count: parent.itemCount,
    items_total_cents: parent.itemsTotalCents,
    currency: parent.currency,
    payment_status: parent.paymentStatus,
    paid_at: parent.paidAt,
    created_at: parent.createdAt,
    updated_at: parent.updatedAt,
    items: items.map(publicItem)
  };
}

export function publicItem(item) {
  return {
    id: item.id,
    item_no: item.itemNo,
    snapshot_id: item.snapshotId,
    platform: item.platform,
    spec: item.spec,
    quantity: item.quantity,
    unit_price_cents: item.unitPriceCents,
    items_cents: item.itemsCents,
    domestic_shipping_cents: item.domesticShippingCents,
    total_cents: item.totalCents,
    currency: item.currency,
    fulfillment_status: item.fulfillmentStatus,
    exception_status: item.exceptionStatus,
    purchase_account_id: item.purchaseAccountId ?? null,
    assigned_at: item.assignedAt ?? null,
    claimed_by_admin_id: item.claimedByAdminId ?? null,
    claimed_at: item.claimedAt ?? null,
    carrier: item.carrier ?? "",
    domestic_tracking_no: item.domesticTrackingNo ?? "",
    dispatched_at: item.dispatchedAt ?? null,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

export function publicHistory(row) {
  return {
    id: row.id,
    field: row.field,
    from_status: row.fromStatus,
    to_status: row.toStatus,
    action: row.action,
    reason: row.reason,
    actor_type: row.actorType,
    actor_role: row.actorRole,
    request_id: row.requestId,
    created_at: row.createdAt
  };
}

export function publicException(exception) {
  return {
    id: exception.id,
    item_order_id: exception.itemOrderId,
    type: exception.type,
    status: exception.status,
    surcharge_cents: exception.surchargeCents,
    currency: exception.currency,
    detail: exception.detail,
    resolution: exception.resolution,
    deadline_at: exception.deadlineAt,
    resolved_at: exception.resolvedAt,
    created_at: exception.createdAt
  };
}

export function publicExceptionEvent(event) {
  return {
    id: event.id,
    action: event.action,
    detail: event.detail,
    actor_type: event.actorType,
    created_at: event.createdAt
  };
}
