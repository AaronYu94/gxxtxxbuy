import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredPositiveInteger, requiredText } from "../core/core-input.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";
import { EXTENSION_UNIT_MINOR, computeStorage, dueMilestone } from "./storage-rules.js";

const EXTRA_PHOTO_UNIT_MINOR = 100; // 1 CNY per extra photo
const DETAILED_ITEM_UNIT_MINOR = 500; // 5 CNY per detailed inspection item

// V2-06 — inbound scanning, measurement, QC, paid add-ons, and storage.
export function createWmsService({ repository, orderRepository = null, orderService = null, financeService = null, auditLogger = null, clock = () => Date.now() } = {}) {
  if (!repository) {
    throw new Error("WMS repository is required.");
  }

  const QC_SLOTS = ["front", "back", "side", "label"];

  async function markArrived(adminUser, item, inboundPackageId) {
    if (orderService && item && item.fulfillmentStatus === "seller_dispatched") {
      await orderService.transitionFulfillment(
        { type: "admin", id: adminUser.id, role: "warehouse" },
        item.id,
        { to: "arrived", action: "inbound_scan", idempotency_key: `arrived:${item.id}` }
      );
    }
    // Create the standard QC task once the item is in the warehouse.
    if (item) {
      const existing = await repository.findStandardQcTaskByItem(item.id);
      if (!existing) {
        await repository.createQcTask({ itemOrderId: item.id, inboundPackageId: inboundPackageId || null, userId: item.userId, type: "standard" });
      }
    }
  }

  async function requireAssignee(id, adminUser) {
    const task = await repository.findQcTask(id);
    if (!task) throw notFound("QC task not found.");
    if (!["claimed", "in_progress"].includes(task.status)) {
      throw conflict("QC task is not claimed or in progress.");
    }
    if (task.assigneeAdminId !== adminUser.id) {
      throw forbidden("Only the assigned operator can act on this QC task.");
    }
    return task;
  }

  return {
    // V2-06-02 — scan a courier number on arrival. Matches an item sub-order and
    // binds one user/one order, or records an unclaimed package (never guessing).
    // A duplicate scan returns the first record + who/when first scanned it.
    async scanArrival(adminUser, input, requestMeta = {}) {
      const trackingNo = requiredText(input?.tracking_no, "tracking_no", 120);
      const carrier = optionalText(input?.carrier, "carrier", 120);

      const existing = await repository.findInboundByTracking(trackingNo);
      if (existing) {
        return { inbound: publicInbound(existing), existing: true };
      }

      const item = orderRepository ? await orderRepository.findItemByTrackingNo(trackingNo) : null;
      const matched = Boolean(item);
      let inbound;
      try {
        inbound = await repository.createInbound({
          domesticTrackingNo: trackingNo, carrier,
          itemOrderId: matched ? item.id : null,
          userId: matched ? item.userId : null,
          status: matched ? "matched" : "unclaimed",
          firstScannedByAdminId: adminUser.id
        });
      } catch (error) {
        if (error.code === "23505") {
          const raced = await repository.findInboundByTracking(trackingNo);
          if (raced) return { inbound: publicInbound(raced), existing: true };
        }
        throw error;
      }
      if (matched) {
        await markArrived(adminUser, item, inbound.id);
      }
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.inbound_scan",
        resourceType: "inbound_package", resourceId: inbound.id, metadata: { matched }, requestId: requestMeta.requestId
      }, { critical: false });
      return { inbound: publicInbound(inbound), existing: false, matched };
    },

    async listUnclaimed() {
      const rows = await repository.listUnclaimed();
      return { inbound_packages: rows.map(publicInbound) };
    },

    // V2-06-03 — manually link an unclaimed package to an order (requires evidence).
    async manualLink(adminUser, id, input, requestMeta = {}) {
      const inbound = await repository.findInboundById(id);
      if (!inbound) throw notFound("Inbound package not found.");
      if (inbound.status !== "unclaimed") throw conflict("Package is not unclaimed.");
      const itemOrderId = requiredText(input?.item_order_id, "item_order_id", 64);
      const evidence = Array.isArray(input?.evidence) ? input.evidence.map(String).filter(Boolean) : [];
      if (evidence.length === 0) {
        throw badRequest("Evidence is required to manually link a package.", { field: "evidence" });
      }
      const item = orderRepository ? await orderRepository.findItemById(itemOrderId) : null;
      if (!item) throw notFound("Item order not found.");

      const linked = await repository.linkInbound(id, {
        itemOrderId: item.id, userId: item.userId, linkedByAdminId: adminUser.id, linkEvidence: evidence
      });
      if (!linked) throw conflict("Package could not be linked (already claimed).");
      await markArrived(adminUser, item, id);
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.inbound_manual_link",
        resourceType: "inbound_package", resourceId: id, metadata: { item_order_id: item.id }, requestId: requestMeta.requestId
      }, { critical: true });
      return { inbound: publicInbound(linked) };
    },

    // V2-06-04 — measurement + outer-package photos (photos required to complete).
    async submitMeasurement(adminUser, id, input, requestMeta = {}) {
      const inbound = await repository.findInboundById(id);
      if (!inbound) throw notFound("Inbound package not found.");
      const weightGrams = integerInRange(input?.weight_grams, "weight_grams", 1, 500000);
      const lengthMm = integerInRange(input?.length_mm, "length_mm", 1, 5000);
      const widthMm = integerInRange(input?.width_mm, "width_mm", 1, 5000);
      const heightMm = integerInRange(input?.height_mm, "height_mm", 1, 5000);
      const photoKeys = Array.isArray(input?.photo_keys) ? input.photo_keys.map(String).filter(Boolean) : [];
      if (photoKeys.length === 0) {
        // An image upload failure must not mark measurement complete.
        throw badRequest("At least one outer-package photo is required.", { field: "photo_keys" });
      }
      const expectedVersion = Number(input?.version);
      if (!Number.isInteger(expectedVersion)) {
        throw badRequest("version is required for measurement.", { field: "version" });
      }
      const updated = await repository.submitMeasurement(id, {
        weightGrams, lengthMm, widthMm, heightMm, photoKeys, expectedVersion
      });
      if (!updated) throw conflict("Measurement changed since it was loaded; reload and retry.");
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.measurement",
        resourceType: "inbound_package", resourceId: id, requestId: requestMeta.requestId
      }, { critical: false });
      return { inbound: publicInbound(updated) };
    },

    async listMyPackages(user) {
      const rows = await repository.listInboundByUser(user.id);
      return { inbound_packages: rows.map(publicInbound) };
    },

    // ---- V2-06-05/06/07 QC ----
    async listQcTasks(query = {}, adminUser = null) {
      const rows = await repository.listQcTasks({
        status: query.status ? String(query.status) : null,
        assigneeAdminId: query.mine === "true" && adminUser ? adminUser.id : null,
        limit: Math.min(Number(query.limit) || 50, 100)
      });
      return { qc_tasks: rows.map(publicQcTask) };
    },

    async getQcTask(id) {
      const task = await repository.findQcTask(id);
      if (!task) throw notFound("QC task not found.");
      const photos = await repository.listQcPhotos(id);
      const slots = await repository.currentQcSlots(id);
      return { qc_task: publicQcTask(task), photos: photos.map(publicQcPhoto), present_slots: slots };
    },

    // V2-06-06 — claim (only one wins), start, release.
    async claimQc(adminUser, id, requestMeta = {}) {
      const claimed = await repository.claimQcTask(id, adminUser.id);
      if (!claimed) {
        const task = await repository.findQcTask(id);
        if (!task) throw notFound("QC task not found.");
        throw conflict("QC task is already claimed.");
      }
      // Item enters qc_in_progress on claim.
      if (orderService) {
        await orderService.transitionFulfillment(
          { type: "admin", id: adminUser.id, role: "warehouse" }, claimed.itemOrderId,
          { to: "qc_in_progress", action: "qc_claim", idempotency_key: `qc:${claimed.itemOrderId}` }
        ).catch(() => {});
      }
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.qc_claim",
        resourceType: "qc_task", resourceId: id, requestId: requestMeta.requestId
      }, { critical: false });
      return { qc_task: publicQcTask(claimed) };
    },

    async startQc(adminUser, id) {
      const started = await repository.startQcTask(id, adminUser.id);
      if (!started) throw conflict("QC task cannot be started (not your claimed task).");
      return { qc_task: publicQcTask(started) };
    },

    // Release (self or timeout by a lead) — audited.
    async releaseQc(adminUser, id, requestMeta = {}) {
      const released = await repository.releaseQcTask(id);
      if (!released) throw conflict("QC task cannot be released.");
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.qc_release",
        resourceType: "qc_task", resourceId: id, requestId: requestMeta.requestId
      }, { critical: true });
      return { qc_task: publicQcTask(released) };
    },

    // V2-06-07 — upload one of the four fixed photo slots. Only the assignee.
    async uploadQcPhoto(adminUser, id, input, requestMeta = {}) {
      const task = await requireAssignee(id, adminUser);
      const slot = requiredText(input?.slot, "slot", 20);
      if (!QC_SLOTS.includes(slot)) {
        throw badRequest("slot must be front, back, side, or label.", { field: "slot", allowed: QC_SLOTS });
      }
      const storageKey = requiredText(input?.storage_key, "storage_key", 512);
      const photo = await repository.addQcPhoto({ qcTaskId: id, slot, storageKey });
      const slots = await repository.currentQcSlots(id);
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.qc_photo",
        resourceType: "qc_task", resourceId: id, metadata: { slot }, requestId: requestMeta.requestId
      }, { critical: false });
      return { photo: publicQcPhoto(photo), present_slots: slots, complete_ready: QC_SLOTS.every((sl) => slots.includes(sl)), item: task.itemOrderId };
    },

    // V2-06-08 — buy extra QC photos (1 CNY each). Amount is backend-authoritative;
    // an idempotency key makes a repeated purchase a no-op.
    async buyExtraPhotos(user, itemId, input, requestMeta = {}) {
      const item = await requireOwnedItem(orderRepository, user, itemId);
      const quantity = requiredPositiveInteger(input?.quantity, "quantity");
      if (quantity > 20) throw badRequest("At most 20 extra photos per purchase.", { field: "quantity" });
      const key = requiredText(input?.idempotency_key, "idempotency_key", 120);
      const existing = await repository.findQcPurchaseByIdem(user.id, key);
      if (existing) return { purchase: publicQcPurchase(existing), existing: true };

      const amount = quantity * EXTRA_PHOTO_UNIT_MINOR;
      const debit = await debitWallet(financeService, user.id, amount, "qc_extra_photo", `qcpur:${key}`);
      const purchase = await repository.createQcPurchase({
        itemOrderId: item.id, userId: user.id, kind: "extra_photo", quantity, amountCnyMinor: amount,
        ledgerTxId: debit.transaction.id, idempotencyKey: key, detail: {}
      });
      await auditLogger?.write?.({
        actorType: "user", actorUserId: user.id, action: "wms.qc_extra_photo_purchase",
        resourceType: "qc_purchase", resourceId: purchase.id, requestId: requestMeta.requestId
      }, { critical: false });
      return { purchase: publicQcPurchase(purchase), existing: false };
    },

    // V2-06-09 — buy a detailed inspection (5 CNY per item). Electronics may not be
    // marked functionally tested (validated when results are recorded).
    async buyDetailedCheck(user, itemId, input, requestMeta = {}) {
      const item = await requireOwnedItem(orderRepository, user, itemId);
      const items = Array.isArray(input?.items) ? input.items : [];
      if (items.length === 0 || items.length > 50) {
        throw badRequest("Provide 1–50 inspection items.", { field: "items" });
      }
      const normalizedItems = items.map((it) => ({ name: String(it?.name || "").slice(0, 120), electronics: Boolean(it?.electronics) }));
      const key = requiredText(input?.idempotency_key, "idempotency_key", 120);
      const existing = await repository.findQcPurchaseByIdem(user.id, key);
      if (existing) return { purchase: publicQcPurchase(existing), existing: true };

      const amount = normalizedItems.length * DETAILED_ITEM_UNIT_MINOR;
      const debit = await debitWallet(financeService, user.id, amount, "qc_detailed", `qcpur:${key}`);
      const purchase = await repository.createQcPurchase({
        itemOrderId: item.id, userId: user.id, kind: "detailed", quantity: normalizedItems.length,
        amountCnyMinor: amount, ledgerTxId: debit.transaction.id, idempotencyKey: key, detail: { items: normalizedItems }
      });
      await auditLogger?.write?.({
        actorType: "user", actorUserId: user.id, action: "wms.qc_detailed_purchase",
        resourceType: "qc_purchase", resourceId: purchase.id, requestId: requestMeta.requestId
      }, { critical: false });
      return { purchase: publicQcPurchase(purchase), existing: false };
    },

    // V2-06-10 — raise / resolve a QC exception. An open exception blocks normal
    // warehousing (checked at QC completion, V2-06-11).
    async raiseQcException(adminUser, qcTaskId, input, requestMeta = {}) {
      const task = await requireAssignee(qcTaskId, adminUser);
      const type = requiredText(input?.type, "type", 60);
      await repository.markQcTask(qcTaskId, { status: "exception" });
      const exception = await repository.createQcException({
        qcTaskId, type, note: optionalText(input?.note, "note", 1000),
        photoKeys: Array.isArray(input?.photo_keys) ? input.photo_keys.map(String).filter(Boolean) : [],
        createdByAdminId: adminUser.id
      });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.qc_exception",
        resourceType: "qc_task", resourceId: qcTaskId, metadata: { type }, requestId: requestMeta.requestId
      }, { critical: true });
      return { qc_task: publicQcTask(await repository.findQcTask(qcTaskId)), exception: publicQcException(exception), item: task.itemOrderId };
    },

    async resolveQcException(adminUser, qcTaskId, requestMeta = {}) {
      const task = await repository.findQcTask(qcTaskId);
      if (!task) throw notFound("QC task not found.");
      if (task.status !== "exception") throw conflict("QC task has no open exception.");
      await repository.resolveQcExceptions(qcTaskId, adminUser.id);
      await repository.markQcTask(qcTaskId, { status: "in_progress" });
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.qc_exception_resolve",
        resourceType: "qc_task", resourceId: qcTaskId, requestId: requestMeta.requestId
      }, { critical: true });
      return { qc_task: publicQcTask(await repository.findQcTask(qcTaskId)) };
    },

    // V2-06-11 — complete QC and officially warehouse the item. Requires the four
    // photos, measurement, and no open exception; idempotent; stamps the inbound
    // time (= 5-day return start) once.
    async completeQc(adminUser, qcTaskId, requestMeta = {}) {
      const task = await repository.findQcTask(qcTaskId);
      if (!task) throw notFound("QC task not found.");
      if (task.status !== "completed") {
        const slots = await repository.currentQcSlots(qcTaskId);
        if (!QC_SLOTS.every((s) => slots.includes(s))) {
          throw conflict("All four QC photos are required to complete.", { code: "photos_incomplete" });
        }
        if (await repository.hasOpenException(qcTaskId)) {
          throw conflict("Resolve the open QC exception before completing.", { code: "open_exception" });
        }
        if (task.inboundPackageId) {
          const inbound = await repository.findInboundById(task.inboundPackageId);
          if (inbound && inbound.status !== "measured") {
            throw conflict("Measurement must be completed before QC completion.", { code: "measurement_required" });
          }
        }
      }
      const stockNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.stock);
      const result = await repository.completeQcAndStock({ qcTaskId, itemOrderId: task.itemOrderId, userId: task.userId, stockNo });
      if (!result.task) throw notFound("QC task not found.");
      if (orderService) {
        await orderService.transitionFulfillment(
          { type: "admin", id: adminUser.id, role: "warehouse" }, task.itemOrderId,
          { to: "warehoused", action: "qc_complete", idempotency_key: `warehoused:${task.itemOrderId}` }
        ).catch(() => {});
      }
      await auditLogger?.write?.({
        actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.qc_complete",
        resourceType: "qc_task", resourceId: qcTaskId, requestId: requestMeta.requestId
      }, { critical: true });
      return { qc_task: publicQcTask(result.task), inventory: publicInventory(result.inventory), replay: Boolean(result.replay) };
    },

    async listMyInventory(user) {
      const rows = await repository.listInventoryByUser(user.id);
      return { inventory: rows.map(publicInventory) };
    },

    // ---- V2-06-12 locations ----
    async createLocation(adminUser, input, requestMeta = {}) {
      const code = requiredText(input?.code, "code", 60);
      const location = await repository.createLocation({
        code, area: optionalText(input?.area, "area", 60), shelf: optionalText(input?.shelf, "shelf", 60),
        level: optionalText(input?.level, "level", 60), position: optionalText(input?.position, "position", 60)
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.location_create", resourceType: "warehouse_location", resourceId: location.id, requestId: requestMeta.requestId }, { critical: false });
      return { location: publicLocation(location) };
    },

    async listLocations() {
      const rows = await repository.listLocations();
      return { locations: rows.map(publicLocation) };
    },

    async disableLocation(adminUser, id, requestMeta = {}) {
      const location = await repository.findLocationById(id);
      if (!location) throw notFound("Location not found.");
      if (await repository.locationOccupancy(id) > 0) {
        throw conflict("Location has inventory and cannot be disabled.");
      }
      const updated = await repository.disableLocation(id);
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.location_disable", resourceType: "warehouse_location", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return { location: publicLocation(updated) };
    },

    // ---- V2-06-13 double-scan assignment ----
    async assignLocation(adminUser, input, requestMeta = {}) {
      const stockNo = requiredText(input?.stock_no, "stock_no", 64);
      const locationCode = requiredText(input?.location_code, "location_code", 60);
      const location = await repository.findLocationByCode(locationCode);
      if (!location) throw notFound("Location not found.");
      if (!location.enabled) throw conflict("Location is disabled.");
      let result;
      try {
        result = await repository.assignLocation({ stockNo, locationId: location.id, adminUserId: adminUser.id });
      } catch (error) {
        if (error.code === "LOCATION_OCCUPIED") throw conflict("Item is already assigned to a location; move it instead.");
        throw error;
      }
      if (!result.inventory) throw notFound("Inventory unit not found.");
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.location_assign", resourceType: "inventory_unit", resourceId: result.inventory.id, metadata: { location_code: locationCode }, requestId: requestMeta.requestId }, { critical: false });
      return { inventory: publicInventory(result.inventory), replay: Boolean(result.replay) };
    },

    // ---- V2-06-14 double-scan movement ----
    async moveLocation(adminUser, input, requestMeta = {}) {
      const stockNo = requiredText(input?.stock_no, "stock_no", 64);
      const fromCode = requiredText(input?.from_location_code, "from_location_code", 60);
      const toCode = requiredText(input?.to_location_code, "to_location_code", 60);
      const from = await repository.findLocationByCode(fromCode);
      const to = await repository.findLocationByCode(toCode);
      if (!from || !to) throw notFound("Location not found.");
      if (!to.enabled) throw conflict("Destination location is disabled.");
      let result;
      try {
        result = await repository.moveLocation({ stockNo, fromLocationId: from.id, toLocationId: to.id, reason: optionalText(input?.reason, "reason", 240), adminUserId: adminUser.id });
      } catch (error) {
        if (error.code === "LOCATION_MISMATCH") throw conflict("Origin location does not match the item's current location.");
        throw error;
      }
      if (!result.inventory) throw notFound("Inventory unit not found.");
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.location_move", resourceType: "inventory_unit", resourceId: result.inventory.id, metadata: { from: fromCode, to: toCode }, requestId: requestMeta.requestId }, { critical: true });
      return { inventory: publicInventory(result.inventory) };
    },

    // ---- V2-06-16 storage status + paid extension ----
    async getStorageStatus(user, stockNo) {
      const inv = await repository.findInventoryByStockNo(stockNo);
      if (!inv || inv.userId !== user.id) throw notFound("Inventory unit not found.");
      return { inventory: publicInventory(inv), storage: computeStorage(inv.officialInboundAt, inv.paidExtensionMonths, clock()) };
    },

    async buyStorageExtension(user, stockNo, input, requestMeta = {}) {
      const inv = await repository.findInventoryByStockNo(stockNo);
      if (!inv || inv.userId !== user.id) throw notFound("Inventory unit not found.");
      const months = requiredPositiveInteger(input?.months, "months");
      if (months > 2 || inv.paidExtensionMonths + months > 2) {
        throw conflict("Storage can be extended at most two months in total.", { code: "max_extension" });
      }
      const key = requiredText(input?.idempotency_key, "idempotency_key", 120);
      const existing = await repository.findStorageExtensionByIdem(user.id, key);
      if (existing) {
        return { inventory: publicInventory(inv), storage: computeStorage(inv.officialInboundAt, inv.paidExtensionMonths, clock()), existing: true };
      }
      const amount = months * EXTENSION_UNIT_MINOR;
      const debit = await debitWallet(financeService, user.id, amount, "storage_extension", `storext:${key}`);
      let result;
      try {
        result = await repository.addStorageExtension({
          inventoryUnitId: inv.id, userId: user.id, months, amountMinor: amount,
          ledgerTxId: debit.transaction.id, idempotencyKey: key
        });
      } catch (error) {
        if (error.code === "STORAGE_MAX_EXTENSION") throw conflict("Storage can be extended at most two months in total.", { code: "max_extension" });
        throw error;
      }
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "wms.storage_extension", resourceType: "inventory_unit", resourceId: inv.id, metadata: { months }, requestId: requestMeta.requestId }, { critical: false });
      return { inventory: publicInventory(result.inventory), storage: computeStorage(result.inventory.officialInboundAt, result.inventory.paidExtensionMonths, clock()), existing: false };
    },

    // ---- V2-06-17 reminder + destroy sweep (idempotent cron) ----
    async runStorageSweep({ nowIso = null, limit = 500 } = {}) {
      const nowMs = nowIso ? Date.parse(nowIso) : clock();
      const units = await repository.listActiveInventory(limit);
      let reminded = 0;
      let markedForDestroy = 0;
      for (const inv of units) {
        const s = computeStorage(inv.officialInboundAt, inv.paidExtensionMonths, nowMs);
        const milestone = dueMilestone(s.daysLeft);
        if (milestone !== null) {
          if (await repository.markReminderSent(inv.id, milestone)) reminded += 1;
        }
        // Destruction is only eligible at 150 days.
        if (s.destroyEligible && inv.status === "in_stock") {
          const marked = await repository.markForDestroy(inv.id);
          if (marked) markedForDestroy += 1;
        }
      }
      return { reminded, marked_for_destroy: markedForDestroy };
    },

    // ---- V2-06-18 destroy execution (irreversible) ----
    async markForDestroy(adminUser, stockNo, requestMeta = {}) {
      const inv = await repository.findInventoryByStockNo(stockNo);
      if (!inv) throw notFound("Inventory unit not found.");
      const s = computeStorage(inv.officialInboundAt, inv.paidExtensionMonths, clock());
      if (!s.destroyEligible) {
        throw conflict("Items cannot be destroyed before 150 days.", { code: "not_eligible", destroy_eligible_at: s.destroyEligibleAt });
      }
      const marked = await repository.markForDestroy(inv.id);
      if (!marked) throw conflict("Item is not in stock.");
      if (orderService) {
        await orderService.transitionFulfillment(
          { type: "admin", id: adminUser.id, role: "warehouse" }, inv.itemOrderId,
          { to: "destroy_pending", action: "mark_for_destroy", idempotency_key: `destroypend:${inv.itemOrderId}` }
        ).catch(() => {});
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.mark_for_destroy", resourceType: "inventory_unit", resourceId: inv.id, requestId: requestMeta.requestId }, { critical: true });
      return { inventory: publicInventory(marked) };
    },

    async executeDestroy(adminUser, stockNo, input, requestMeta = {}) {
      const inv = await repository.findInventoryByStockNo(stockNo);
      if (!inv) throw notFound("Inventory unit not found.");
      const quantity = requiredPositiveInteger(input?.quantity, "quantity");
      const photoKeys = Array.isArray(input?.photo_keys) ? input.photo_keys.map(String).filter(Boolean) : [];
      if (photoKeys.length === 0) throw badRequest("Destruction evidence photos are required.", { field: "photo_keys" });
      let result;
      try {
        result = await repository.executeDestroy({ inventoryUnitId: inv.id, quantity, photoKeys, adminUserId: adminUser.id });
      } catch (error) {
        if (error.code === "DESTROY_STATE") throw conflict("Item is not pending destruction.");
        throw error;
      }
      if (result.inventory && orderService && !result.replay) {
        await orderService.transitionFulfillment(
          { type: "admin", id: adminUser.id, role: "warehouse" }, inv.itemOrderId,
          { to: "destroyed", action: "destroy", idempotency_key: `destroyed:${inv.itemOrderId}` }
        ).catch(() => {});
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.destroy_execute", resourceType: "inventory_unit", resourceId: inv.id, metadata: { quantity }, requestId: requestMeta.requestId }, { critical: true });
      return { inventory: publicInventory(result.inventory), replay: Boolean(result.replay) };
    },

    // ---- V2-06-15 shipping restrictions ----
    async setShippingRestrictions(adminUser, input, requestMeta = {}) {
      const stockNo = requiredText(input?.stock_no, "stock_no", 64);
      const allowed = ["normal", "battery", "liquid", "powder", "magnetic", "flammable"];
      const restrictions = Array.isArray(input?.restrictions)
        ? [...new Set(input.restrictions.map(String))].filter((r) => allowed.includes(r))
        : [];
      const inv = await repository.findInventoryByStockNo(stockNo);
      if (!inv) throw notFound("Inventory unit not found.");
      const updated = await repository.setShippingRestrictions({ inventoryUnitId: inv.id, restrictions, adminUserId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "wms.shipping_restrictions", resourceType: "inventory_unit", resourceId: inv.id, metadata: { restrictions }, requestId: requestMeta.requestId }, { critical: true });
      return { inventory: publicInventory(updated) };
    }
  };
}

export function publicLocation(l) {
  return { id: l.id, code: l.code, area: l.area, shelf: l.shelf, level: l.level, position: l.position, enabled: l.enabled };
}

// V2-06-09 — a detailed-inspection result cannot mark an electronics item as
// functionally tested/working (we do not power-test electronics).
export function validateDetailedResults(items) {
  for (const item of items || []) {
    if (item?.electronics && (item.functional_ok === true || item.result === "functional_ok")) {
      return { ok: false, reason: "electronics_function_test_forbidden", name: item.name };
    }
  }
  return { ok: true };
}

async function requireOwnedItem(orderRepository, user, itemId) {
  if (!orderRepository) throw new Error("Order repository is required.");
  const item = await orderRepository.findItemById(itemId);
  if (!item || item.userId !== user.id) throw notFound("Item order not found.");
  return item;
}

async function debitWallet(financeService, userId, amount, type, idempotencyKey) {
  if (!financeService) throw conflict("Wallet is not configured.", { code: "not_configured" });
  return financeService.debit(userId, amount, { type, businessType: "qc_purchase", idempotencyKey });
}

export const QC_STANDARD_SLOTS = ["front", "back", "side", "label"];

function integerInRange(value, field, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}.`, { field, min, max });
  }
  return n;
}

export function publicQcTask(t) {
  return {
    id: t.id,
    item_order_id: t.itemOrderId,
    type: t.type,
    status: t.status,
    assignee_admin_id: t.assigneeAdminId,
    unpack_required: t.unpackRequired,
    wait_hours: t.waitHours,
    exception_note: t.exceptionNote,
    completed_at: t.completedAt,
    created_at: t.createdAt
  };
}

export function publicQcPhoto(p) {
  return {
    id: p.id,
    slot: p.slot,
    storage_key: p.storageKey,
    version: p.version,
    created_at: p.createdAt
  };
}

export function publicInventory(inv) {
  if (!inv) return null;
  return {
    id: inv.id,
    stock_no: inv.stockNo,
    item_order_id: inv.itemOrderId,
    status: inv.status,
    official_inbound_at: inv.officialInboundAt,
    return_deadline_at: inv.returnDeadlineAt,
    location_id: inv.locationId,
    shipping_restrictions: inv.shippingRestrictions || [],
    created_at: inv.createdAt
  };
}

export function publicQcPurchase(p) {
  return {
    id: p.id,
    item_order_id: p.itemOrderId,
    kind: p.kind,
    quantity: p.quantity,
    amount_cny_minor: p.amountCnyMinor,
    status: p.status,
    detail: p.detail,
    created_at: p.createdAt
  };
}

export function publicQcException(e) {
  return {
    id: e.id,
    type: e.type,
    note: e.note,
    photo_keys: e.photoKeys,
    status: e.status,
    created_at: e.createdAt,
    resolved_at: e.resolvedAt
  };
}

export function publicInbound(p) {
  return {
    id: p.id,
    domestic_tracking_no: p.domesticTrackingNo,
    carrier: p.carrier,
    item_order_id: p.itemOrderId,
    status: p.status,
    first_scanned_at: p.firstScannedAt,
    weight_grams: p.weightGrams,
    length_mm: p.lengthMm,
    width_mm: p.widthMm,
    height_mm: p.heightMm,
    photo_keys: p.photoKeys,
    measured_at: p.measuredAt,
    measurement_version: p.measurementVersion,
    created_at: p.createdAt
  };
}
