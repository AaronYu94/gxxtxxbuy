import { badRequest, conflict, forbidden, notFound } from "../errors/app-error.js";
import {
  optionalMoneyToCents, optionalText, requiredMoneyToCents, requiredPositiveInteger, requiredText
} from "../core/core-input.js";
import { publicException, publicHistory, publicItem } from "../orders/order-service.js";

// V2-04-04 procurement account management (admin) + V2-04-05 account picking for
// post-payment assignment + V2-04-07/08/09 procurement task list, claim, and
// confirm-purchase. Every mutation is audited; updates are version-guarded.
export function createProcurementService({ repository, orderRepository = null, auditLogger = null } = {}) {
  if (!repository) {
    throw new Error("Procurement repository is required.");
  }

  return {
    async createAccount(adminUser, input, requestMeta = {}) {
      const platform = requiredText(input?.platform, "platform", 40);
      const label = requiredText(input?.label, "label", 120);
      const role = input?.role === "backup" ? "backup" : "default";
      const account = await repository.createAccount({
        platform,
        label,
        accountRef: optionalText(input?.account_ref, "account_ref", 240),
        role,
        ownerAdminId: input?.owner_admin_id || null,
        enabled: input?.enabled !== false
      });
      await auditLogger?.write?.({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "procurement.account_create",
        resourceType: "purchase_account",
        resourceId: account.id,
        metadata: { platform, role },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { account: publicAccount(account) };
    },

    async listAccounts(query = {}) {
      const accounts = await repository.listAccounts({
        platform: query.platform ? String(query.platform) : null,
        enabled: query.enabled === undefined ? null : query.enabled === "true" || query.enabled === true
      });
      return { accounts: accounts.map(publicAccount) };
    },

    async updateAccount(adminUser, id, input, requestMeta = {}) {
      const existing = await repository.findAccount(id);
      if (!existing) {
        throw notFound("Purchase account not found.");
      }
      const expectedVersion = Number(input?.version);
      if (!Number.isInteger(expectedVersion)) {
        throw badRequest("version is required for updates.", { field: "version" });
      }
      const patch = {
        label: input?.label !== undefined ? requiredText(input.label, "label", 120) : null,
        role: input?.role !== undefined ? (input.role === "backup" ? "backup" : "default") : null,
        enabled: input?.enabled !== undefined ? Boolean(input.enabled) : null,
        ownerAdminId: input?.owner_admin_id !== undefined ? (input.owner_admin_id || null) : null
      };
      const updated = await repository.updateAccount(id, expectedVersion, patch);
      if (!updated) {
        throw conflict("Purchase account changed since it was loaded; reload and retry.");
      }
      await auditLogger?.write?.({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "procurement.account_update",
        resourceType: "purchase_account",
        resourceId: updated.id,
        metadata: { version: updated.version, enabled: updated.enabled },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { account: publicAccount(updated) };
    },

    // V2-04-05 — pick the platform's preferred enabled account, or null when the
    // platform has none configured (caller routes the item to the exception queue).
    async pickAccountForPlatform(platform) {
      if (!platform) return null;
      return repository.pickAccountForPlatform(platform);
    },

    // V2-04-07 — scope-aware procurement task list. The scope context comes from
    // requireDataScope("procurement"): SELF for buyers, ORG for leads, and an
    // exact item_no search for customer service (empty search already rejected).
    async listTasks(scopeContext, query = {}) {
      requireOrderRepository(orderRepository);
      const tasks = await orderRepository.listProcurementTasks({
        scope: scopeContext?.scope,
        adminUserId: scopeContext?.adminUserId,
        itemNo: query.item_no || scopeContext?.exactSearch?.item_no || null,
        platform: query.platform ? String(query.platform) : null,
        statuses: query.status ? [String(query.status)] : null,
        limit: clampLimit(query.limit),
        offset: Math.max(0, Number(query.offset) || 0)
      });
      return { tasks: tasks.map(publicItem) };
    },

    // V2-04-16 — item sub-order workbench detail: the item, its status timeline,
    // the open exception (if any), and the purchase confirmation (if any).
    async getTaskDetail(itemId) {
      requireOrderRepository(orderRepository);
      const item = await orderRepository.findItemById(itemId);
      if (!item) {
        throw notFound("Item order not found.");
      }
      const [history, exception, confirmation] = await Promise.all([
        orderRepository.listItemHistory(itemId),
        orderRepository.findOpenExceptionByItem(itemId),
        orderRepository.findConfirmationByItem(itemId)
      ]);
      return {
        task: publicItem(item),
        timeline: history.map(publicHistory),
        exception: exception ? publicException(exception) : null,
        confirmation: confirmation ? publicConfirmation(confirmation) : null
      };
    },

    // V2-04-08 — claim an item currently in 代下单. Only one concurrent claim wins.
    async claimTask(adminUser, itemId, requestMeta = {}) {
      requireOrderRepository(orderRepository);
      let result;
      try {
        result = await orderRepository.claimItem({ itemId, adminUserId: adminUser.id, requestId: requestMeta.requestId });
      } catch (error) {
        if (error?.code === "ORDER_STATUS_CONFLICT") {
          throw conflict("Item is already claimed or is not in 代下单.");
        }
        throw error;
      }
      if (!result.item) {
        throw notFound("Item order not found.");
      }
      await auditLogger?.write?.({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "procurement.claim",
        resourceType: "item_order",
        resourceId: itemId,
        requestId: requestMeta.requestId
      }, { critical: true });
      return { task: publicItem(result.item) };
    },

    // V2-04-09 — record the real purchase for a claimed item. Quantity cannot
    // exceed the ordered quantity; money is integer minor units; vouchers are
    // private storage keys. One confirmation per item.
    async confirmPurchase(adminUser, itemId, input, requestMeta = {}) {
      requireOrderRepository(orderRepository);
      const item = await orderRepository.findItemById(itemId);
      if (!item) {
        throw notFound("Item order not found.");
      }
      if (item.claimedByAdminId && item.claimedByAdminId !== adminUser.id) {
        throw forbidden("Only the buyer who claimed this item can confirm its purchase.");
      }
      const quantity = requiredPositiveInteger(input?.quantity, "quantity");
      if (quantity > item.quantity) {
        throw badRequest("Confirmed quantity cannot exceed the ordered quantity.", { field: "quantity", max: item.quantity });
      }
      const costCents = requiredMoneyToCents(input?.cost, "cost");
      const shippingCents = optionalMoneyToCents(input?.shipping, "shipping") || 0;

      let result;
      try {
        result = await orderRepository.createPurchaseConfirmation({
          itemOrderId: itemId,
          buyerAdminId: adminUser.id,
          actualPlatform: requiredText(input?.actual_platform, "actual_platform", 40),
          actualAccount: optionalText(input?.actual_account, "actual_account", 240),
          actualOrderNo: requiredText(input?.actual_order_no, "actual_order_no", 120),
          spec: optionalText(input?.spec, "spec", 240),
          quantity,
          costCents,
          shippingCents,
          voucherKeys: sanitizeKeys(input?.voucher_keys),
          requestId: requestMeta.requestId
        });
      } catch (error) {
        if (error?.code === "23505") {
          throw conflict("This item has already been confirmed.");
        }
        if (error?.code === "ORDER_STATUS_CONFLICT") {
          throw conflict("Item is not in 采购处理中.");
        }
        throw error;
      }
      if (!result.item) {
        throw notFound("Item order not found.");
      }
      await auditLogger?.write?.({
        actorType: "admin",
        actorAdminUserId: adminUser.id,
        action: "procurement.confirm_purchase",
        resourceType: "item_order",
        resourceId: itemId,
        metadata: { quantity, cost_cents: costCents },
        requestId: requestMeta.requestId
      }, { critical: true });
      return { task: publicItem(result.item), confirmation: publicConfirmation(result.confirmation) };
    }
  };
}

function requireOrderRepository(orderRepository) {
  if (!orderRepository) {
    throw new Error("Order repository is required for procurement tasks.");
  }
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return 50;
  return Math.min(n, 100);
}

function sanitizeKeys(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 10);
}

export function publicConfirmation(confirmation) {
  return {
    id: confirmation.id,
    item_order_id: confirmation.itemOrderId,
    actual_platform: confirmation.actualPlatform,
    actual_account: confirmation.actualAccount,
    actual_order_no: confirmation.actualOrderNo,
    spec: confirmation.spec,
    quantity: confirmation.quantity,
    cost_cents: confirmation.costCents,
    shipping_cents: confirmation.shippingCents,
    voucher_keys: confirmation.voucherKeys,
    created_at: confirmation.createdAt
  };
}

export function publicAccount(account) {
  return {
    id: account.id,
    platform: account.platform,
    label: account.label,
    account_ref: account.accountRef,
    role: account.role,
    owner_admin_id: account.ownerAdminId,
    enabled: account.enabled,
    version: account.version,
    created_at: account.createdAt,
    updated_at: account.updatedAt
  };
}
