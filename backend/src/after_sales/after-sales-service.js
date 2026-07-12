import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredPositiveInteger, requiredText } from "../core/core-input.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";
import { evaluateReturnEligibility } from "./after-sales-eligibility.js";
import { isAllowedAfterSalesTransition } from "./after-sales-status.js";
import { computeReturnFee } from "./return-billing.js";
import { computePlatformRefund } from "./refund-accounting.js";

// V2-08 — after-sales (returns & refunds): eligibility, user return request,
// procurement review, return-fee bill, warehouse handling, and the refund chain,
// all through the version-guarded transition primitive.
//
// couponService is the V2-10 seam (restore a coupon's remaining validity on
// refund); its default no-op keeps the refund chain complete before V2-10 lands.
export function createAfterSalesService({ repository, orderRepository = null, orderService = null, financeService = null, couponService = null, auditLogger = null, clock = () => Date.now() } = {}) {
  if (!repository) throw new Error("After-sales repository is required.");

  const ELIGIBILITY_MESSAGES = {
    not_warehoused: "This item is not officially warehoused yet.",
    after_sales_open: "There is already an open after-sales order for this item.",
    already_returning: "This item is already being returned.",
    not_available: "This item is not available to return (it may be in a parcel or shipped).",
    no_deadline: "This item has no return window.",
    window_expired: "The 5-day return window has closed."
  };

  async function requireOwnedItem(user, itemId) {
    if (!orderRepository) throw new Error("Order repository is required.");
    const item = await orderRepository.findItemById(itemId);
    if (!item || item.userId !== user.id) throw notFound("Item order not found.");
    return item;
  }

  return {
    // ---- V2-08-02 eligibility ----
    async checkEligibility(user, itemId) {
      await requireOwnedItem(user, itemId);
      const inventory = await repository.findInventoryByItem(itemId);
      const open = await repository.findActiveByItem(itemId);
      const result = evaluateReturnEligibility({ inventory, hasOpenAfterSales: Boolean(open), nowMs: clock() });
      return {
        eligible: result.eligible,
        reason: result.reason,
        message: result.reason ? (ELIGIBILITY_MESSAGES[result.reason] || "Not eligible.") : null,
        deadline_at: result.deadlineAt,
        after_sales_id: open ? open.id : null
      };
    },

    // ---- V2-08-03 user opens a return ----
    async requestReturn(user, itemId, input, requestMeta = {}) {
      const item = await requireOwnedItem(user, itemId);

      // A duplicate request returns the existing open order (idempotent).
      const existing = await repository.findActiveByItem(itemId);
      if (existing) return this.getAfterSales(user, existing.id);

      const inventory = await repository.findInventoryByItem(itemId);
      const elig = evaluateReturnEligibility({ inventory, hasOpenAfterSales: false, nowMs: clock() });
      if (!elig.eligible) {
        throw conflict(ELIGIBILITY_MESSAGES[elig.reason] || "Not eligible to return.", { code: elig.reason, deadline_at: elig.deadlineAt });
      }

      const reason = requiredText(input?.reason, "reason", 120);
      const description = optionalText(input?.description, "description", 2000);
      const quantity = input?.quantity == null ? (item.quantity || 1) : requiredPositiveInteger(input?.quantity, "quantity");
      if (quantity > (item.quantity || 1)) throw badRequest("Return quantity exceeds the ordered quantity.", { field: "quantity" });
      const evidencePhotoKeys = Array.isArray(input?.evidence_photo_keys) ? input.evidence_photo_keys.map(String).filter(Boolean) : [];

      const asNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.afterSales);
      let order;
      try {
        order = await repository.createReturn({
          asNo, itemOrderId: itemId, inventoryUnitId: inventory.id, userId: user.id,
          reason, description, quantity, evidencePhotoKeys, deadlineAt: inventory.returnDeadlineAt,
          actor: { type: "user", id: user.id }
        });
      } catch (error) {
        if (error.code === "UNIT_NOT_FOUND") throw notFound("Inventory unit not found.");
        if (error.code === "UNIT_NOT_OWNED") throw forbidden("Inventory unit is not yours.");
        if (error.code === "UNIT_NOT_AVAILABLE") throw conflict("This item is not available to return.", { code: "not_available", status: error.status });
        if (error.code === "AFTER_SALES_EXISTS") return this.getAfterSales(user, (await repository.findActiveByItem(itemId)).id);
        throw error;
      }

      // Item sub-order fulfillment warehoused → return_in_progress.
      if (orderService) {
        await orderService.transitionFulfillment(
          { type: "user", id: user.id, role: "user" }, itemId,
          { to: "return_in_progress", action: "return_open", idempotency_key: `return_open:${order.id}` }
        ).catch(() => {});
      }
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "after_sales.open", resourceType: "after_sales_order", resourceId: order.id, requestId: requestMeta.requestId }, { critical: false });
      return this.getAfterSales(user, order.id);
    },

    async listMyAfterSales(user) {
      const rows = await repository.listByUser(user.id);
      return { after_sales_orders: rows.map(publicOrder) };
    },

    async getAfterSales(user, id) {
      const order = await repository.findById(id);
      if (!order || order.userId !== user.id) throw notFound("After-sales order not found.");
      return this._assemble(order);
    },

    // Admin/staff read (no per-user filter).
    async adminGetAfterSales(id) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      return this._assemble(order);
    },

    // Guarded transition: rejects any move the frozen state machine disallows, then
    // applies it version-safely with a history row.
    async _move(id, toStatus, { action, actor, reason = "", note = "", patch = {}, metadata = {} }) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      if (!isAllowedAfterSalesTransition(order.status, toStatus)) {
        throw conflict(`Cannot move from ${order.status} to ${toStatus}.`, { code: "illegal_transition", status: order.status });
      }
      const result = await repository.transition({ afterSalesId: id, toStatus, action, actor, reason, note, patch, metadata, expectedVersion: order.version });
      if (result.notFound) throw notFound("After-sales order not found.");
      if (result.versionConflict) throw conflict("After-sales order changed; reload and retry.", { code: "version_conflict" });
      return result.order;
    },

    // ---- V2-08-04 procurement review (customer service is blocked at the route) ----
    async startReview(adminUser, id, requestMeta = {}) {
      const order = await this._move(id, "purchase_reviewing", { action: "start_review", actor: adminActor(adminUser, "procurement") });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.start_review", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetAfterSales(order.id);
    },

    async approveReview(adminUser, id, input, requestMeta = {}) {
      const responsibleParty = requireParty(input?.responsible_party, "responsible_party");
      const freightParty = requireParty(input?.freight_party, "freight_party");
      // The user pays return freight → a fee bill is due first; otherwise straight to picking.
      const toStatus = freightParty === "user" ? "return_fee_due" : "warehouse_picking_pending";
      const order = await this._move(id, toStatus, {
        action: "approve_review", actor: adminActor(adminUser, "procurement"),
        patch: { responsible_party: responsibleParty, freight_party: freightParty },
        metadata: { responsible_party: responsibleParty, freight_party: freightParty }
      });
      // V2-08-06 — user-responsible freight ⇒ a return-fee bill is due before picking.
      if (freightParty === "user") {
        const fee = computeReturnFee();
        const billNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.feeBill);
        await repository.createReturnFeeBill({
          billNo, afterSalesId: id, userId: order.userId, subtotalMinor: fee.total_cny_minor, totalMinor: fee.total_cny_minor, breakdown: fee
        }).catch((e) => { if (e.code !== "BILL_EXISTS") throw e; });
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.approve", resourceType: "after_sales_order", resourceId: id, metadata: { responsible_party: responsibleParty, freight_party: freightParty }, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(order.id);
    },

    async rejectReview(adminUser, id, input, requestMeta = {}) {
      const reason = requiredText(input?.reason, "reason", 500); // rejection reason is mandatory
      const order = await this._move(id, "rejected", { action: "reject", actor: adminActor(adminUser, "procurement"), reason, patch: { reject_reason: reason } });
      await this._releaseReservation(order);
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.reject", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(order.id);
    },

    async requestMaterial(adminUser, id, input, requestMeta = {}) {
      const note = requiredText(input?.note, "note", 1000);
      const order = await this._move(id, "customer_material_pending", { action: "request_material", actor: adminActor(adminUser, "procurement"), note });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.request_material", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetAfterSales(order.id);
    },

    // ---- V2-08-05 user supplements material; old attachments are retained ----
    async supplementMaterial(user, id, input, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order || order.userId !== user.id) throw notFound("After-sales order not found.");
      if (order.status !== "customer_material_pending") {
        throw conflict("Material can only be added while the order is awaiting your supplement.", { code: "not_awaiting_material", status: order.status });
      }
      const photoKeys = Array.isArray(input?.photo_keys) ? input.photo_keys.map(String).filter(Boolean) : [];
      const note = optionalText(input?.note, "note", 2000);
      if (photoKeys.length === 0 && !note) throw badRequest("Provide a note or photos.", { field: "photo_keys" });
      await repository.addAttachment({ afterSalesId: id, kind: "material", photoKeys, note, createdByType: "user", createdById: user.id });
      const moved = await this._move(id, "purchase_reviewing", { action: "supplement_material", actor: { type: "user", id: user.id, role: "user" } });
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "after_sales.supplement", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.getAfterSales(user, moved.id);
    },

    // Close an order that stalled awaiting the user (timeout) or an unpaid return fee.
    async closeStalled(adminUser, id, input, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      if (!["customer_material_pending", "return_fee_due"].includes(order.status)) {
        throw conflict("Only a stalled order can be closed here.", { code: "not_closable", status: order.status });
      }
      const moved = await this._move(id, "closed", { action: "close_stalled", actor: adminActor(adminUser, order.currentOwnerRole), reason: optionalText(input?.reason, "reason", 500), patch: { closed_at: new Date(clock()).toISOString() } });
      await this._releaseReservation(moved);
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.close", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(moved.id);
    },

    // ---- V2-08-06 user pays the return fee (return_fee_due → warehouse_picking_pending) ----
    async payReturnFee(user, id, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order || order.userId !== user.id) throw notFound("After-sales order not found.");
      if (order.status !== "return_fee_due") throw conflict("No return fee is due.", { code: "not_fee_due", status: order.status });
      const bill = await repository.findActiveBill(id, "return_fee");
      if (!bill) throw notFound("No return-fee bill for this order.");
      if (bill.status === "paid") return this.getAfterSales(user, id);
      if (bill.status !== "payable") throw conflict("Return-fee bill is not payable.", { code: "not_payable", status: bill.status });
      if (!financeService) throw conflict("Wallet is not configured.", { code: "not_configured" });

      const idempotencyKey = `returnfee:${bill.id}`;
      if (bill.totalCnyMinor > 0) {
        await financeService.debit(user.id, bill.totalCnyMinor, { type: "return_fee", businessType: "after_sales_bill", businessRef: bill.id, idempotencyKey });
      }
      await repository.markBillPaid({ billId: bill.id, ledgerTxId: null, idempotencyKey });
      const moved = await this._move(id, "warehouse_picking_pending", { action: "pay_return_fee", actor: { type: "user", id: user.id, role: "user" } });
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "after_sales.pay_return_fee", resourceType: "after_sales_bill", resourceId: bill.id, requestId: requestMeta.requestId }, { critical: true });
      return this.getAfterSales(user, moved.id);
    },

    // ---- V2-08-07 warehouse return picking scan ----
    async scanReturnPick(adminUser, id, input, requestMeta = {}) {
      const stockNo = requiredText(input?.stock_no, "stock_no", 64);
      const result = await repository.scanReturnPick({ afterSalesId: id, stockNo, expectedStatus: "warehouse_picking_pending", toStatus: "return_verifying", adminId: adminUser.id });
      if (result.notFound) throw notFound("After-sales order not found.");
      if (result.conflict) throw conflict("Order is not awaiting return picking.", { code: "not_picking", status: result.status });
      if (result.wrongItem) throw conflict(`Scanned item does not match this return: ${stockNo}`, { code: "wrong_item" });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.return_pick", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetAfterSales(id);
    },

    // ---- V2-08-08 return verification (QC compare) + packing ----
    async verifyReturn(adminUser, id, input, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      if (order.status !== "return_verifying") throw conflict("Order is not in return verification.", { code: "not_verifying", status: order.status });
      const photoKeys = photoList(input?.photo_keys);
      if (photoKeys.length === 0) throw badRequest("Return QC photos are required.", { field: "photo_keys" });
      const quantityMatched = input?.quantity_matched !== false;
      const specMatched = input?.spec_matched !== false;
      await repository.recordInspection({
        afterSalesId: id, quantityMatched, specMatched, photoKeys,
        weightGrams: intOrNull(input?.weight_grams), lengthMm: intOrNull(input?.length_mm),
        widthMm: intOrNull(input?.width_mm), heightMm: intOrNull(input?.height_mm),
        note: optionalText(input?.note, "note", 1000), adminId: adminUser.id
      });
      // A mismatch routes to the exception state instead of packing.
      const toStatus = quantityMatched && specMatched ? "return_packing" : "exception";
      const moved = await this._move(id, toStatus, {
        action: quantityMatched && specMatched ? "verify_pass" : "verify_mismatch",
        actor: adminActor(adminUser, "warehouse"), metadata: { quantity_matched: quantityMatched, spec_matched: specMatched }
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.return_verify", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetAfterSales(moved.id);
    },

    async packReturn(adminUser, id, input, requestMeta = {}) {
      const photoKeys = photoList(input?.photo_keys);
      if (photoKeys.length === 0) throw badRequest("Return packing photos are required.", { field: "photo_keys" });
      await repository.addAttachment({ afterSalesId: id, kind: "return_qc", photoKeys, note: "return packing", createdByType: "admin", createdById: adminUser.id });
      const moved = await this._move(id, "merchant_return_pending", { action: "pack_return", actor: adminActor(adminUser, "warehouse") });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.return_pack", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetAfterSales(moved.id);
    },

    // ---- V2-08-09 ship back to merchant + tracking ----
    async shipBackToMerchant(adminUser, id, input, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      if (order.status !== "merchant_return_pending") throw conflict("Order is not awaiting ship-back.", { code: "not_shipback", status: order.status });
      const carrier = requiredText(input?.carrier, "carrier", 120);
      const trackingNo = requiredText(input?.tracking_no, "tracking_no", 120);
      const address = input?.merchant_address || {};
      if (!address || typeof address !== "object" || Object.keys(address).length === 0) {
        throw badRequest("A merchant return address is required.", { field: "merchant_address" });
      }
      try {
        await repository.createShipment({ afterSalesId: id, carrier, trackingNo, merchantAddressSnapshot: address, adminId: adminUser.id });
      } catch (error) {
        if (error.code === "TRACKING_DUPLICATE") throw conflict("This tracking number is already used.", { code: "tracking_duplicate" });
        if (error.code === "SHIPMENT_EXISTS") throw conflict("A ship-back already exists for this order.", { code: "shipment_exists" });
        throw error;
      }
      // Item sub-order to returning is implicit; mark the unit returned.
      if (order.inventoryUnitId) await repository.markUnitReturned(order.inventoryUnitId).catch(() => {});
      const moved = await this._move(id, "returned_to_merchant", { action: "ship_back", actor: adminActor(adminUser, "warehouse"), metadata: { carrier, tracking_no: trackingNo } });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.ship_back", resourceType: "after_sales_order", resourceId: id, metadata: { tracking_no: trackingNo }, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(moved.id);
    },

    // Record a shipment event (rejected / logistics exception). Optionally routes
    // the order to the exception state.
    async recordShipmentEvent(adminUser, id, input, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      const type = requiredText(input?.type, "type", 60);
      const event = { type, note: optionalText(input?.note, "note", 500), at: new Date(clock()).toISOString() };
      const shipmentStatus = type === "rejected" ? "rejected" : (type === "delivered" ? "delivered" : (type === "exception" ? "exception" : null));
      await repository.appendShipmentEvent({ afterSalesId: id, event, status: shipmentStatus });
      // A rejection/exception on an in-flight return raises the order exception.
      if ((type === "rejected" || type === "exception") && order.status === "returned_to_merchant") {
        await this._move(id, "exception", { action: "shipment_exception", actor: adminActor(adminUser, "procurement"), reason: type });
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.shipment_event", resourceType: "after_sales_order", resourceId: id, metadata: { type }, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetAfterSales(id);
    },

    // ---- V2-08-10 merchant received + merchant refund registration ----
    async markMerchantReceived(adminUser, id, requestMeta = {}) {
      const moved = await this._move(id, "merchant_refund_pending", { action: "merchant_received", actor: adminActor(adminUser, "procurement") });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.merchant_received", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetAfterSales(moved.id);
    },

    async registerMerchantRefund(adminUser, id, input, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      if (order.status !== "merchant_refund_pending") throw conflict("Order is not awaiting a merchant refund.", { code: "not_merchant_refund", status: order.status });
      const refundMinor = nonNegMinor(input?.merchant_refund_cny_minor, "merchant_refund_cny_minor");
      const deductionMinor = nonNegMinor(input?.merchant_deduction_cny_minor, "merchant_deduction_cny_minor");
      const refundNo = requiredText(input?.refund_no, "refund_no", 120);
      const receiptKeys = photoList(input?.receipt_photo_keys);

      // The merchant refund cannot exceed the refundable ceiling (original item payment).
      const itemTotal = await this._itemTotalMinor(order);
      if (refundMinor > itemTotal) {
        throw badRequest("Merchant refund exceeds the refundable amount.", { field: "merchant_refund_cny_minor", cap_cny_minor: itemTotal });
      }
      if (receiptKeys.length > 0) {
        await repository.addAttachment({ afterSalesId: id, kind: "merchant_receipt", photoKeys: receiptKeys, note: `refund_no=${refundNo}`, createdByType: "admin", createdById: adminUser.id });
      }
      const moved = await this._move(id, "platform_refund_pending", {
        action: "register_merchant_refund", actor: adminActor(adminUser, "procurement"),
        patch: { merchant_refund_cny_minor: refundMinor, merchant_deduction_cny_minor: deductionMinor },
        metadata: { refund_no: refundNo, merchant_refund_cny_minor: refundMinor, merchant_deduction_cny_minor: deductionMinor }
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.merchant_refund", resourceType: "after_sales_order", resourceId: id, metadata: { refund_no: refundNo }, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(moved.id);
    },

    // ---- V2-08-11 platform refund preview (pure accounting) ----
    async previewRefund(id) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      const accounting = await this._computeRefund(order);
      return { after_sales_id: id, ...accounting };
    },

    // ---- V2-08-12 finance wallet refund (only after merchant refund; idempotent) ----
    async executeRefund(adminUser, id, requestMeta = {}) {
      const order = await repository.findById(id);
      if (!order) throw notFound("After-sales order not found.");
      if (order.status === "completed") return this.adminGetAfterSales(id); // idempotent
      if (order.status !== "platform_refund_pending") throw conflict("Order is not awaiting the platform refund.", { code: "not_platform_refund", status: order.status });
      if (!financeService) throw conflict("Wallet is not configured.", { code: "not_configured" });

      const accounting = await this._computeRefund(order);
      const amount = accounting.platform_refund_cny_minor;
      const idempotencyKey = `asrefund:${id}`;
      if (amount > 0) {
        await financeService.refund(order.userId, amount, { type: "after_sales_refund", businessType: "after_sales", businessRef: id, idempotencyKey });
      }
      const moved = await this._move(id, "completed", {
        action: "execute_refund", actor: adminActor(adminUser, "finance"),
        patch: { platform_refund_cny_minor: amount, completed_at: new Date(clock()).toISOString() },
        metadata: { platform_refund_cny_minor: amount, breakdown: accounting.breakdown }
      });
      // V2-08-13 — restore the coupon's remaining validity (V2-10 seam; no-op default).
      if (couponService && couponService.restoreForAfterSales) {
        await couponService.restoreForAfterSales(order.userId, { afterSalesId: id, idempotencyKey: `ascoupon:${id}` }).catch(() => {});
      }
      // Mark the unit fully returned + item sub-order refunded.
      if (order.inventoryUnitId) await repository.markUnitReturned(order.inventoryUnitId).catch(() => {});
      if (orderService) {
        await orderService.transitionFulfillment(
          { type: "admin", id: adminUser.id, role: "finance" }, order.itemOrderId,
          { to: "refunded", action: "after_sales_refund", idempotency_key: `refunded:${id}` }
        ).catch(() => {});
      }
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.execute_refund", resourceType: "after_sales_order", resourceId: id, metadata: { amount_cny_minor: amount }, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(moved.id);
    },

    async _itemTotalMinor(order) {
      if (!orderRepository) return 0;
      const item = await orderRepository.findItemById(order.itemOrderId);
      return item ? Math.max(0, Number(item.totalCents) || 0) : 0;
    },

    async _computeRefund(order) {
      const itemTotal = await this._itemTotalMinor(order);
      const feeBill = await repository.findActiveBill(order.id, "return_fee");
      const userPaidReturnFee = feeBill && feeBill.status === "paid" ? feeBill.totalCnyMinor : 0;
      return computePlatformRefund({
        itemTotalMinor: itemTotal, responsibleParty: order.responsibleParty || "user",
        merchantDeductionMinor: order.merchantDeductionCnyMinor || 0, userPaidReturnFeeMinor: userPaidReturnFee
      });
    },

    // Generic exception raise / resolve (owner routes back to a legal node).
    async raiseException(adminUser, id, input, requestMeta = {}) {
      const moved = await this._move(id, "exception", { action: "raise_exception", actor: adminActor(adminUser, "warehouse"), reason: requiredText(input?.reason, "reason", 500) });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.exception", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(moved.id);
    },
    async resolveException(adminUser, id, input, requestMeta = {}) {
      const toStatus = requiredText(input?.to_status, "to_status", 40);
      const moved = await this._move(id, toStatus, { action: "resolve_exception", actor: adminActor(adminUser, "warehouse"), note: optionalText(input?.note, "note", 500) });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "after_sales.exception_resolve", resourceType: "after_sales_order", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetAfterSales(moved.id);
    },

    // Staff worklist by status/role.
    async listForStaff(query = {}) {
      const rows = await repository.listByStatus({ status: query.status ? String(query.status) : null, role: query.role ? String(query.role) : null, limit: Number(query.limit) || 50 });
      return { after_sales_orders: rows.map(publicOrder) };
    },

    // Release the return reservation on reject/close (unit → in_stock, item → warehoused).
    async _releaseReservation(order) {
      if (order.inventoryUnitId) await repository.releaseUnit(order.inventoryUnitId).catch(() => {});
      if (orderService) {
        await orderService.transitionFulfillment(
          { type: "system", id: null, role: "system" }, order.itemOrderId,
          { to: "warehoused", action: "return_closed", idempotency_key: `return_closed:${order.id}` }
        ).catch(() => {});
      }
    },

    async _assemble(order) {
      const history = await repository.listHistory(order.id);
      const attachments = await repository.listAttachments(order.id);
      const bills = await repository.listBills(order.id);
      const inspection = await repository.findInspection(order.id);
      const shipment = await repository.findShipment(order.id);
      return {
        after_sales_order: publicOrder(order), history: history.map(publicHistory), attachments: attachments.map(publicAttachment),
        bills: bills.map(publicBill), inspection: publicInspection(inspection), shipment: publicShipment(shipment)
      };
    }
  };
}

function adminActor(adminUser, role) { return { type: "admin", id: adminUser.id, role }; }

function requireParty(value, field) {
  if (value !== "seller" && value !== "user") throw badRequest(`${field} must be 'seller' or 'user'.`, { field });
  return value;
}

function photoList(value) {
  return Array.isArray(value) ? value.map((v) => String(v || "").trim()).filter(Boolean) : [];
}

function intOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegMinor(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${field} must be a non-negative integer.`, { field });
  return n;
}

export function publicOrder(o) {
  if (!o) return null;
  return {
    id: o.id, as_no: o.asNo, item_order_id: o.itemOrderId, status: o.status, reason: o.reason,
    description: o.description, quantity: o.quantity, responsible_party: o.responsibleParty, freight_party: o.freightParty,
    reject_reason: o.rejectReason, merchant_refund_cny_minor: o.merchantRefundCnyMinor, merchant_deduction_cny_minor: o.merchantDeductionCnyMinor,
    platform_refund_cny_minor: o.platformRefundCnyMinor, current_owner_role: o.currentOwnerRole, deadline_at: o.deadlineAt,
    version: o.version, created_at: o.createdAt
  };
}

export function publicHistory(h) {
  return { id: h.id, from_status: h.fromStatus, to_status: h.toStatus, action: h.action, actor_role: h.actorRole, reason: h.reason, note: h.note, created_at: h.createdAt };
}

export function publicAttachment(a) {
  return { id: a.id, kind: a.kind, photo_keys: a.photoKeys, note: a.note, created_by_type: a.createdByType, created_at: a.createdAt };
}

export function publicBill(b) {
  if (!b) return null;
  return { id: b.id, bill_no: b.billNo, kind: b.kind, status: b.status, subtotal_cny_minor: b.subtotalCnyMinor, total_cny_minor: b.totalCnyMinor, breakdown: b.breakdown, paid_at: b.paidAt, created_at: b.createdAt };
}

export function publicInspection(i) {
  if (!i) return null;
  return { id: i.id, quantity_matched: i.quantityMatched, spec_matched: i.specMatched, photo_keys: i.photoKeys, weight_grams: i.weightGrams, length_mm: i.lengthMm, width_mm: i.widthMm, height_mm: i.heightMm, note: i.note, created_at: i.createdAt };
}

export function publicShipment(s) {
  if (!s) return null;
  return { id: s.id, carrier: s.carrier, tracking_no: s.trackingNo, merchant_address_snapshot: s.merchantAddressSnapshot, status: s.status, events: s.events, created_at: s.createdAt };
}
