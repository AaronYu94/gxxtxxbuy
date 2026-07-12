import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import { optionalText, requiredText } from "../core/core-input.js";
import { BUSINESS_NUMBER_PREFIXES, generateBusinessNumber } from "../core/business-number.js";
import { computeBilling, packingSubtotal, PACKING_BASE_FEE_CNY_MINOR } from "./billing.js";

// V2-07-04..10 — consolidation: eligible-stock query, draft parcel with an address
// snapshot + stock reservation, the value-added-service catalog, the packing-fee
// bill (membership→coupon discount order), and pre-packing cancel.
//
// membershipProvider / couponProvider are seams for V2-09 / V2-10 (not yet built).
// Their default no-op implementations return null, so billing degrades to "no
// discount" cleanly and the seams light up when those modules land.
export function createConsolidationService({
  repository, addressRepository = null, orderService = null, financeService = null,
  logisticsService = null, membershipProvider = null, couponProvider = null,
  membershipService = null, couponService = null, auditLogger = null
} = {}) {
  if (!repository) throw new Error("Consolidation repository is required.");

  function requireSuperAdmin(adminRoles) {
    if (!Array.isArray(adminRoles) || !adminRoles.includes("super_admin")) {
      throw forbidden("Only a super admin can configure value-added services.");
    }
  }

  return {
    // ---- V2-07-07 value-added service catalog (super-admin) ----
    async createValueAddedService(adminUser, adminRoles, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const code = requiredText(input?.code, "code", 60);
      const priceCnyMinor = nonNegInt(input?.price_cny_minor, "price_cny_minor");
      const vas = await repository.createValueAddedService({
        code, name: optionalText(input?.name, "name", 120) || code,
        description: optionalText(input?.description, "description", 500),
        priceCnyMinor, requiresPhoto: Boolean(input?.requires_photo),
        enabled: input?.enabled !== false, adminUserId: adminUser.id
      });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "consolidation.vas_create", resourceType: "value_added_service", resourceId: vas.id, requestId: requestMeta.requestId }, { critical: true });
      return { value_added_service: publicVas(vas) };
    },

    async updateValueAddedService(adminUser, adminRoles, id, input, requestMeta = {}) {
      requireSuperAdmin(adminRoles);
      const existing = await repository.findVasById(id);
      if (!existing) throw notFound("Value-added service not found.");
      const patch = {};
      if (input?.name !== undefined) patch.name = optionalText(input.name, "name", 120);
      if (input?.description !== undefined) patch.description = optionalText(input.description, "description", 500);
      if (input?.price_cny_minor !== undefined) patch.priceCnyMinor = nonNegInt(input.price_cny_minor, "price_cny_minor");
      if (input?.requires_photo !== undefined) patch.requiresPhoto = Boolean(input.requires_photo);
      if (input?.enabled !== undefined) patch.enabled = Boolean(input.enabled);
      const vas = await repository.updateValueAddedService(id, patch);
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "consolidation.vas_update", resourceType: "value_added_service", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return { value_added_service: publicVas(vas) };
    },

    async listValueAddedServices({ enabledOnly = false } = {}) {
      const rows = await repository.listValueAddedServices({ enabledOnly });
      return { value_added_services: rows.map(publicVas) };
    },

    // ---- V2-07-04 eligible stock ----
    async listEligibleStock(user) {
      const rows = await repository.listEligibleStock(user.id);
      return { eligible_stock: rows.map(publicEligible) };
    },

    // ---- V2-07-05/06 create a draft parcel: snapshot the address, reserve stock ----
    async createParcel(user, input, requestMeta = {}) {
      const stockNos = uniqueStrings(input?.stock_nos);
      if (stockNos.length === 0) throw badRequest("Select at least one item to consolidate.", { field: "stock_nos" });
      if (stockNos.length > 200) throw badRequest("At most 200 items per parcel.", { field: "stock_nos" });

      // V2-07-06 — snapshot the delivery address at draft time.
      const addressId = optionalText(input?.address_id, "address_id", 64);
      let recipientSnapshot = {};
      let destinationCountry = optionalText(input?.destination_country, "destination_country", 2);
      if (addressId) {
        if (!addressRepository) throw conflict("Address lookup is not configured.");
        const address = await addressRepository.findAddress(user.id, addressId);
        if (!address) throw notFound("Address not found.");
        recipientSnapshot = snapshotAddress(address);
        destinationCountry = address.countryCode || destinationCountry;
      }

      // V2-07-07 — resolve requested value-added services against the live catalog.
      const vasCodes = uniqueStrings(input?.value_added_service_codes);
      let vasList = [];
      if (vasCodes.length > 0) {
        const found = await repository.findVasByCodes(vasCodes);
        const byCode = new Map(found.map((v) => [v.code, v]));
        for (const code of vasCodes) {
          const v = byCode.get(code);
          if (!v || !v.enabled) throw badRequest(`Unknown or disabled value-added service: ${code}`, { field: "value_added_service_codes", code });
          vasList.push(v);
        }
      }

      const parcelNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.parcel);
      let result;
      try {
        result = await repository.createParcelWithReservation({
          userId: user.id, addressId: addressId || null, recipientSnapshot, destinationCountry, parcelNo, stockNos, valueAddedServices: vasList
        });
      } catch (error) {
        if (error.code === "UNIT_NOT_FOUND") throw notFound(`Inventory unit not found: ${error.stockNo}`);
        if (error.code === "UNIT_NOT_OWNED") throw forbidden(`Inventory unit is not yours: ${error.stockNo}`);
        if (error.code === "UNIT_NOT_ELIGIBLE") throw conflict(`Inventory unit is not available for consolidation: ${error.stockNo}`, { code: "not_eligible" });
        if (error.code === "UNIT_ALREADY_RESERVED") throw conflict(`Inventory unit is already in another parcel: ${error.stockNo}`, { code: "already_reserved" });
        throw error;
      }

      // V2-07-05 — reflect the reservation on each item sub-order (warehoused → parcel_reserved).
      if (orderService) {
        for (const itemId of result.itemOrderIds) {
          await orderService.transitionFulfillment(
            { type: "admin", id: user.id, role: "warehouse" }, itemId,
            { to: "parcel_reserved", action: "parcel_reserve", idempotency_key: `parcel_reserve:${result.parcel.id}:${itemId}` }
          ).catch(() => {});
        }
      }
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "consolidation.parcel_create", resourceType: "consolidation_parcel", resourceId: result.parcel.id, metadata: { count: stockNos.length }, requestId: requestMeta.requestId }, { critical: false });
      return this.getParcel(user, result.parcel.id);
    },

    async listMyParcels(user) {
      const rows = await repository.listParcelsByUser(user.id);
      return { parcels: rows.map(publicParcel) };
    },

    async getParcel(user, id) {
      const parcel = await repository.findParcelById(id);
      if (!parcel || parcel.userId !== user.id) throw notFound("Parcel not found.");
      const items = await repository.listParcelItems(id);
      const vas = await repository.listParcelVas(id);
      const bills = await repository.listBillsByParcel(id);
      return { parcel: publicParcel(parcel), items: items.map(publicParcelItem), value_added_services: vas.map(publicParcelVas), bills: bills.map(publicBill) };
    },

    // ---- V2-07-08/09 submit the draft: compute the packing bill (membership then
    // coupon), advancing the parcel draft → packing_fee_due ----
    async submitParcel(user, id, input = {}, requestMeta = {}) {
      const parcel = await requireOwnedParcel(repository, user, id);
      if (parcel.status !== "draft") throw conflict("Only a draft parcel can be submitted.", { code: "not_draft", status: parcel.status });

      const vas = await repository.listParcelVas(id);
      const subtotal = packingSubtotal(vas);

      // V2-07-09 — resolve optional membership + coupon (no-op until V2-09/V2-10).
      const membership = membershipProvider ? await membershipProvider.forUser(user.id) : null;
      const couponCode = optionalText(input?.coupon_code, "coupon_code", 60);
      let coupon = null;
      if (couponCode) {
        if (!couponProvider) throw badRequest("Coupons are not available yet.", { field: "coupon_code" });
        coupon = await couponProvider.resolve(user.id, couponCode, { businessType: "packing_fee", subtotalMinor: subtotal });
        if (!coupon) throw badRequest(`Coupon not applicable: ${couponCode}`, { field: "coupon_code" });
      }

      const billing = computeBilling({ subtotalMinor: subtotal, membership, coupon });
      const breakdown = {
        base_fee_cny_minor: PACKING_BASE_FEE_CNY_MINOR,
        value_added_services: vas.map((v) => ({ code: v.code, price_cny_minor: v.priceCnyMinor })),
        ...billing
      };
      const billNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.feeBill);
      const result = await repository.submitParcelWithBill({
        parcelId: id, expectedStatus: "draft", billNo, subtotalMinor: billing.subtotal_cny_minor,
        membershipDiscountMinor: billing.membership_discount_cny_minor, couponDiscountMinor: billing.coupon_discount_cny_minor,
        couponCode, totalMinor: billing.total_cny_minor, breakdown
      });
      if (result.notFound) throw notFound("Parcel not found.");
      if (result.conflict) throw conflict("Parcel is no longer a draft.", { code: "not_draft", status: result.status });
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "consolidation.parcel_submit", resourceType: "consolidation_parcel", resourceId: id, metadata: { total_cny_minor: billing.total_cny_minor }, requestId: requestMeta.requestId }, { critical: false });
      return this.getParcel(user, id);
    },

    // Pay the packing bill from the wallet, advancing packing_fee_due →
    // warehouse_acceptance_pending. Idempotent on the bill.
    async payPackingBill(user, id, requestMeta = {}) {
      const parcel = await requireOwnedParcel(repository, user, id);
      const bill = await repository.findActiveBill(id, "packing");
      if (!bill) throw notFound("No packing bill for this parcel.");
      if (bill.status === "paid") {
        // Already paid → idempotent (advance the parcel if it lagged behind).
        return this.getParcel(user, id);
      }
      if (bill.status !== "payable") throw conflict("Packing bill is not payable.", { code: "not_payable", status: bill.status });
      if (parcel.status !== "packing_fee_due") throw conflict("Parcel is not awaiting the packing fee.", { code: "bad_state", status: parcel.status });
      if (!financeService) throw conflict("Wallet is not configured.", { code: "not_configured" });

      const idempotencyKey = `packbill:${bill.id}`;
      if (bill.totalCnyMinor > 0) {
        await financeService.debit(user.id, bill.totalCnyMinor, {
          type: "packing_fee", businessType: "parcel_bill", businessRef: bill.id, idempotencyKey
        });
      }
      const advanced = await repository.markBillPaidAndAdvance({
        billId: bill.id, ledgerTxId: null, idempotencyKey, parcelId: id,
        fromStatus: "packing_fee_due", toStatus: "warehouse_acceptance_pending"
      });
      if (!advanced) throw conflict("Packing bill was already settled.", { code: "already_settled" });
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "consolidation.packing_fee_paid", resourceType: "parcel_bill", resourceId: bill.id, requestId: requestMeta.requestId }, { critical: true });
      return this.getParcel(user, id);
    },

    // ---- V2-07-16 pay the international shipping bill from the wallet ----
    async payShippingBill(user, id, requestMeta = {}) {
      const parcel = await requireOwnedParcel(repository, user, id);
      const bill = await repository.findActiveBill(id, "shipping");
      if (!bill) throw notFound("No shipping bill for this parcel.");
      if (bill.status === "paid") return this.getParcel(user, id);
      if (bill.status !== "payable") throw conflict("Shipping bill is not payable.", { code: "not_payable", status: bill.status });
      if (parcel.status !== "shipping_fee_due") throw conflict("Parcel is not awaiting the shipping fee.", { code: "bad_state", status: parcel.status });
      if (!financeService) throw conflict("Wallet is not configured.", { code: "not_configured" });

      const idempotencyKey = `shipbill:${bill.id}`;
      if (bill.totalCnyMinor > 0) {
        await financeService.debit(user.id, bill.totalCnyMinor, {
          type: "international_shipping", businessType: "parcel_bill", businessRef: bill.id, idempotencyKey
        });
      }
      const advanced = await repository.markBillPaidAndAdvance({
        billId: bill.id, ledgerTxId: null, idempotencyKey, parcelId: id,
        fromStatus: "shipping_fee_due", toStatus: "outbound_pending"
      });
      if (!advanced) throw conflict("Shipping bill was already settled.", { code: "already_settled" });
      // V2-10-04 — settle the reserved coupon (reserved → used) now that shipping is paid.
      if (couponService) await couponService.settleForParcel(id).catch(() => {});
      // V2-09-06 — international shipping the user actually paid accrues membership
      // growth (idempotent on the bill, so a replayed payment never double-counts).
      if (membershipService && bill.totalCnyMinor > 0) {
        await membershipService.accrueShipping(user.id, { amountMinor: bill.totalCnyMinor, businessRef: bill.id, idempotencyKey: `ship:${bill.id}` }).catch(() => {});
      }
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "consolidation.shipping_fee_paid", resourceType: "parcel_bill", resourceId: bill.id, requestId: requestMeta.requestId }, { critical: true });
      return this.getParcel(user, id);
    },

    // ---- V2-07-10 pre-packing cancel ----
    // Allowed only before the warehouse starts packing: draft, packing_fee_due, or
    // warehouse_acceptance_pending. Releases reservations and refunds a paid bill.
    async cancelParcel(user, id, requestMeta = {}) {
      const parcel = await requireOwnedParcel(repository, user, id);
      const cancellable = ["draft", "packing_fee_due", "warehouse_acceptance_pending"];
      if (!cancellable.includes(parcel.status)) {
        throw conflict("A parcel cannot be cancelled once packing has started.", { code: "packing_started", status: parcel.status });
      }
      const result = await repository.cancelParcelAndRelease({ parcelId: id, expectedStatuses: cancellable });
      if (result.notFound) throw notFound("Parcel not found.");
      if (result.conflict) throw conflict("A parcel cannot be cancelled once packing has started.", { code: "packing_started", status: result.status });

      // Return each released unit's item sub-order to warehoused.
      if (orderService) {
        for (const itemId of result.itemOrderIds) {
          await orderService.transitionFulfillment(
            { type: "admin", id: user.id, role: "warehouse" }, itemId,
            { to: "warehoused", action: "parcel_release", idempotency_key: `parcel_release:${id}:${itemId}` }
          ).catch(() => {});
        }
      }
      // V2-10-04 — release any coupon reserved against this parcel back to available.
      if (couponService) await couponService.releaseForParcel(id).catch(() => {});
      // Refund any paid bill (refund_pending → refunded).
      if (financeService) {
        for (const bill of result.refundBills) {
          if (bill.totalCnyMinor > 0) {
            await financeService.refund(user.id, bill.totalCnyMinor, {
              type: "packing_fee_refund", businessType: "parcel_bill", businessRef: bill.id, idempotencyKey: `packrefund:${bill.id}`
            }).catch(() => {});
          }
          await repository.markBillRefunded({ billId: bill.id, refundLedgerTxId: null });
        }
      }
      await auditLogger?.write?.({ actorType: "user", actorUserId: user.id, action: "consolidation.parcel_cancel", resourceType: "consolidation_parcel", resourceId: id, metadata: { released: result.itemOrderIds.length }, requestId: requestMeta.requestId }, { critical: true });
      return this.getParcel(user, id);
    },

    // ---- V2-07-11 warehouse accepts a paid parcel and opens a picking task ----
    async acceptForPicking(adminUser, id, requestMeta = {}) {
      const result = await repository.acceptForPicking({ parcelId: id, expectedStatus: "warehouse_acceptance_pending" });
      if (result.notFound) throw notFound("Parcel not found.");
      if (result.conflict) throw conflict("Parcel is not awaiting warehouse acceptance.", { code: "bad_state", status: result.status });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "consolidation.picking_accept", resourceType: "consolidation_parcel", resourceId: id, requestId: requestMeta.requestId }, { critical: false });
      return this.adminGetParcel(id);
    },

    async claimPicking(adminUser, id, requestMeta = {}) {
      const claimed = await repository.claimPickingTask(id, adminUser.id);
      if (!claimed) {
        const task = await repository.findPickingTaskByParcel(id);
        if (!task) throw notFound("No picking task for this parcel.");
        throw conflict("Picking task is already claimed.", { code: "already_claimed" });
      }
      return { picking_task: publicPickingTask(claimed) };
    },

    // ---- V2-07-12 scan one unit into the parcel ----
    async scanPickItem(adminUser, id, input, requestMeta = {}) {
      const parcel = await repository.findParcelById(id);
      if (!parcel) throw notFound("Parcel not found.");
      if (parcel.status !== "picking") throw conflict("Parcel is not being picked.", { code: "not_picking", status: parcel.status });
      const stockNo = requiredText(input?.stock_no, "stock_no", 64);
      const result = await repository.scanPickItem({ parcelId: id, stockNo, adminId: adminUser.id });
      if (result.foreign) throw conflict(`Scanned unit does not belong to this parcel: ${stockNo}`, { code: "foreign_item" });
      return { stock_no: stockNo, replay: Boolean(result.replay), total: result.total, picked: result.picked, complete_ready: result.picked >= result.total };
    },

    // ---- V2-07-13 review and start packing (the cancel lock point) ----
    async startPacking(adminUser, id, requestMeta = {}) {
      const result = await repository.startPacking({ parcelId: id, expectedStatus: "picking" });
      if (result.notFound) throw notFound("Parcel not found.");
      if (result.conflict) throw conflict("Parcel is not being picked.", { code: "not_picking", status: result.status });
      if (result.incomplete) throw conflict("All items must be scanned before packing.", { code: "picking_incomplete", total: result.total, picked: result.picked });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "consolidation.start_packing", resourceType: "consolidation_parcel", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetParcel(id);
    },

    // ---- V2-07-14 execute a value-added service during packing ----
    async executeValueAddedService(adminUser, id, input, requestMeta = {}) {
      const parcel = await repository.findParcelById(id);
      if (!parcel) throw notFound("Parcel not found.");
      if (parcel.status !== "packing") throw conflict("Value-added services run during packing.", { code: "not_packing", status: parcel.status });
      const parcelVasId = requiredText(input?.parcel_vas_id, "parcel_vas_id", 64);
      const vas = await repository.findParcelVasById(id, parcelVasId);
      if (!vas) throw notFound("Value-added service not found on this parcel.");
      const photoKeys = Array.isArray(input?.photo_keys) ? input.photo_keys.map(String).filter(Boolean) : [];
      if (vas.requiresPhoto && photoKeys.length === 0) {
        throw badRequest("This value-added service requires evidence photos.", { field: "photo_keys" });
      }
      const updated = await repository.markVasExecuted({ parcelVasId, photoKeys, adminId: adminUser.id });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "consolidation.vas_execute", resourceType: "parcel_value_added_service", resourceId: parcelVasId, metadata: { code: vas.code }, requestId: requestMeta.requestId }, { critical: false });
      return { value_added_service: publicParcelVas(updated) };
    },

    // ---- V2-07-15 final measurement → international shipping bill ----
    async finalizeMeasurement(adminUser, id, input, requestMeta = {}) {
      const parcel = await repository.findParcelById(id);
      if (!parcel) throw notFound("Parcel not found.");
      if (parcel.status !== "packing") throw conflict("Final measurement happens during packing.", { code: "not_packing", status: parcel.status });
      if (!logisticsService) throw conflict("Logistics is not configured.", { code: "not_configured" });

      // All photo-required value-added services must be executed first.
      const pendingPhoto = await repository.countPendingPhotoVas(id);
      if (pendingPhoto > 0) throw conflict("Complete all photo value-added services before measurement.", { code: "vas_incomplete", pending: pendingPhoto });

      const routeCode = requiredText(input?.route_code, "route_code", 40);
      const finalWeightGrams = positiveInt(input?.final_weight_grams, "final_weight_grams");
      const dims = input?.dimensions_cm || {};
      const quoted = await logisticsService.quote({
        route_code: routeCode, actual_weight_grams: finalWeightGrams, dimensions_cm: dims,
        insured_value_minor: Number(input?.insured_value_minor) || 0, remote: Boolean(input?.remote)
      });
      if (!quoted.quote.quotable) throw conflict("Parcel is not quotable on this route.", { code: "not_quotable", reason: quoted.quote.reason });

      // V2-09-06 + V2-10-04 — apply the shipping discount pipeline (membership
      // freight discount first, then one coupon; frozen order per V2-12-17) to the
      // freight subtotal. The coupon is reserved against this parcel here and
      // settled on payment / released on cancel.
      const freightSubtotal = quoted.quote.total_cny_minor;
      const membership = membershipProvider ? await membershipProvider.forUser(parcel.userId).catch(() => null) : null;
      let coupon = null;
      let couponGrantId = null;
      const couponCode = optionalText(input?.coupon_code, "coupon_code", 60);
      if (couponCode && couponService) {
        const reserved = await couponService.reserveForParcel(parcel.userId, {
          couponCode, parcelId: id, country: parcel.destinationCountry, routeCode, shippingMinor: freightSubtotal
        });
        if (reserved.discount_minor > 0) { coupon = { type: "fixed", valueMinor: reserved.discount_minor }; couponGrantId = reserved.grant_id; }
      }
      const billing = computeBilling({ subtotalMinor: freightSubtotal, membership, coupon });
      const breakdown = {
        route_code: routeCode, price_version_id: quoted.price_version_id, ...quoted.quote.breakdown,
        chargeable_weight_grams: quoted.quote.chargeableWeightGrams, freight_subtotal_cny_minor: freightSubtotal,
        membership_discount_cny_minor: billing.membership_discount_cny_minor, coupon_discount_cny_minor: billing.coupon_discount_cny_minor,
        coupon_grant_id: couponGrantId, total_cny_minor: billing.total_cny_minor
      };
      const billNo = generateBusinessNumber(BUSINESS_NUMBER_PREFIXES.feeBill);
      const result = await repository.finalizeMeasurementWithBill({
        parcelId: id, expectedStatus: "packing", routeId: quoted.route.id,
        finalWeightGrams, chargeableWeightGrams: quoted.quote.chargeableWeightGrams,
        dimensions: dims, billNo, totalMinor: billing.total_cny_minor, breakdown
      });
      if (result.notFound) throw notFound("Parcel not found.");
      if (result.conflict) throw conflict("Parcel is no longer being packed.", { code: "bad_state", status: result.status });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "consolidation.final_measurement", resourceType: "consolidation_parcel", resourceId: id, metadata: { total_cny_minor: quoted.quote.total_cny_minor }, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetParcel(id);
    },

    // ---- V2-07-17 seal / label / outbound evidence (outbound_pending → outbound) ----
    async recordOutbound(adminUser, id, input, requestMeta = {}) {
      const parcel = await repository.findParcelById(id);
      if (!parcel) throw notFound("Parcel not found.");
      if (parcel.status !== "outbound_pending") throw conflict("Parcel is not awaiting outbound.", { code: "not_outbound_pending", status: parcel.status });
      const sealPhotoKeys = photoList(input?.seal_photo_keys);
      const outboundPhotoKeys = photoList(input?.outbound_photo_keys);
      const labelKey = optionalText(input?.label_key, "label_key", 512);
      if (sealPhotoKeys.length === 0) throw badRequest("Seal photos are required.", { field: "seal_photo_keys" });
      if (outboundPhotoKeys.length === 0) throw badRequest("Outbound photos are required.", { field: "outbound_photo_keys" });

      const result = await repository.recordOutboundEvidence({
        parcelId: id, expectedStatus: "outbound_pending", sealPhotoKeys, labelKey, outboundPhotoKeys, adminId: adminUser.id
      });
      if (result.notFound) throw notFound("Parcel not found.");
      if (result.conflict) throw conflict("Parcel is not awaiting outbound.", { code: "not_outbound_pending", status: result.status });
      await auditLogger?.write?.({ actorType: "admin", actorAdminUserId: adminUser.id, action: "consolidation.outbound_record", resourceType: "consolidation_parcel", resourceId: id, requestId: requestMeta.requestId }, { critical: true });
      return this.adminGetParcel(id);
    },

    // Admin read (no per-user ownership filter).
    async adminGetParcel(id) {
      const parcel = await repository.findParcelById(id);
      if (!parcel) throw notFound("Parcel not found.");
      const items = await repository.listParcelItems(id);
      const vas = await repository.listParcelVas(id);
      const bills = await repository.listBillsByParcel(id);
      const task = await repository.findPickingTaskByParcel(id);
      const outbound = await repository.findOutboundRecord(id);
      return { parcel: publicParcel(parcel), items: items.map(publicParcelItem), value_added_services: vas.map(publicParcelVas), bills: bills.map(publicBill), picking_task: publicPickingTask(task), outbound_record: publicOutboundRecord(outbound) };
    }
  };
}

export function publicOutboundRecord(r) {
  if (!r) return null;
  return { id: r.id, seal_photo_keys: r.sealPhotoKeys, label_key: r.labelKey, outbound_photo_keys: r.outboundPhotoKeys, created_at: r.createdAt };
}

async function requireOwnedParcel(repository, user, id) {
  const parcel = await repository.findParcelById(id);
  if (!parcel || parcel.userId !== user.id) throw notFound("Parcel not found.");
  return parcel;
}

function nonNegInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${field} must be a non-negative integer.`, { field });
  return n;
}

function positiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} must be a positive integer.`, { field });
  return n;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || "").trim()).filter(Boolean))];
}

function photoList(value) {
  return Array.isArray(value) ? value.map((v) => String(v || "").trim()).filter(Boolean) : [];
}

function snapshotAddress(address) {
  return {
    address_id: address.id, version: address.version ?? 1,
    recipient_name: address.recipientName, phone: address.phone, country_code: address.countryCode,
    region: address.region, city: address.city, postal_code: address.postalCode,
    line1: address.line1, line2: address.line2
  };
}

export function publicVas(v) {
  if (!v) return null;
  return { id: v.id, code: v.code, name: v.name, description: v.description, price_cny_minor: v.priceCnyMinor, requires_photo: v.requiresPhoto, enabled: v.enabled };
}

export function publicEligible(inv) {
  return { stock_no: inv.stockNo, item_order_id: inv.itemOrderId, status: inv.status, official_inbound_at: inv.officialInboundAt, return_deadline_at: inv.returnDeadlineAt, location_id: inv.locationId };
}

export function publicParcel(p) {
  if (!p) return null;
  return {
    id: p.id, parcel_no: p.parcelNo, status: p.status, destination_country: p.destinationCountry,
    recipient_snapshot: p.recipientSnapshot, route_id: p.routeId,
    packing_fee_bill_id: p.packingFeeBillId, shipping_fee_bill_id: p.shippingFeeBillId,
    declared_weight_grams: p.declaredWeightGrams, final_weight_grams: p.finalWeightGrams,
    chargeable_weight_grams: p.chargeableWeightGrams, tracking_no: p.trackingNo,
    outbound_batch_id: p.outboundBatchId, version: p.version, created_at: p.createdAt
  };
}

export function publicParcelItem(it) {
  return { id: it.id, stock_no: it.stockNo, item_order_id: it.itemOrderId, released_at: it.releasedAt, picked_at: it.pickedAt ?? null };
}

export function publicPickingTask(t) {
  if (!t) return null;
  return { id: t.id, parcel_id: t.parcelId, status: t.status, assignee_admin_id: t.assigneeAdminId, claimed_at: t.claimedAt, completed_at: t.completedAt };
}

export function publicParcelVas(v) {
  return { id: v.id, code: v.code, name: v.name, price_cny_minor: v.priceCnyMinor, requires_photo: v.requiresPhoto, status: v.status, photo_keys: v.photoKeys };
}

export function publicBill(b) {
  if (!b) return null;
  return {
    id: b.id, bill_no: b.billNo, kind: b.kind, status: b.status,
    subtotal_cny_minor: b.subtotalCnyMinor, membership_discount_cny_minor: b.membershipDiscountCnyMinor,
    coupon_discount_cny_minor: b.couponDiscountCnyMinor, coupon_code: b.couponCode,
    total_cny_minor: b.totalCnyMinor, breakdown: b.breakdown, paid_at: b.paidAt, created_at: b.createdAt
  };
}
