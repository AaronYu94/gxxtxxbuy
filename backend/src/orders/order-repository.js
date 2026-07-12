import { getDbPool } from "../db/pool.js";
import { statusColumn } from "./order-status.js";

// Persistence for the V2 two-level order model (V2-04-01/02/03). Order creation
// is a single transaction: parent + every item commit together or not at all.
export function createPgOrderRepository(env) {
  const pool = () => getDbPool(env);

  return {
    async findParentBySubmitKey(userId, submitKey) {
      const result = await pool().query(
        "select * from order_parents where user_id = $1 and submit_key = $2",
        [userId, submitKey]
      );
      return normalizeParent(result.rows[0]);
    },

    async findParentById(userId, parentId) {
      const result = await pool().query(
        "select * from order_parents where user_id = $1 and id = $2",
        [userId, parentId]
      );
      return normalizeParent(result.rows[0]);
    },

    // Admin/system context: no user scope (used by the payment/assignment flow).
    async findParentByIdAny(parentId) {
      const result = await pool().query("select * from order_parents where id = $1", [parentId]);
      return normalizeParent(result.rows[0]);
    },

    // Idempotent paid mark: only an unpaid parent flips to paid. A second call
    // matches 0 rows and returns null, so payment events never double-apply.
    async markParentPaid(parentId) {
      const result = await pool().query(
        `update order_parents set payment_status = 'paid', paid_at = now()
         where id = $1 and payment_status = 'unpaid' returning *`,
        [parentId]
      );
      return normalizeParent(result.rows[0]);
    },

    async assignItemAccount(itemId, accountId) {
      const result = await pool().query(
        `update item_orders set purchase_account_id = $2, assigned_at = now()
         where id = $1 and purchase_account_id is null returning *`,
        [itemId, accountId]
      );
      return normalizeItem(result.rows[0]);
    },

    // V2-04-08 — claim an agent_ordering item. Locked + from-checked so two
    // concurrent claims can't both win; moves to purchasing and records history.
    async claimItem({ itemId, adminUserId, requestId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const current = (await client.query("select * from item_orders where id = $1 for update", [itemId])).rows[0];
        if (!current) {
          await client.query("rollback");
          return { item: null };
        }
        if (current.fulfillment_status !== "agent_ordering" || current.claimed_by_admin_id) {
          await client.query("rollback");
          const error = new Error("Item is not claimable.");
          error.code = "ORDER_STATUS_CONFLICT";
          throw error;
        }
        const updated = (await client.query(
          `update item_orders set claimed_by_admin_id = $2, claimed_at = now(), fulfillment_status = 'purchasing'
           where id = $1 returning *`,
          [itemId, adminUserId]
        )).rows[0];
        await client.query(
          `insert into item_order_status_history
             (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
           values ($1, 'fulfillment', 'agent_ordering', 'purchasing', 'claim', 'admin', $2, $3)`,
          [itemId, adminUserId, requestId || ""]
        );
        await client.query("commit");
        return { item: normalizeItem(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // V2-04-09 — record the real purchase and move to seller_dispatch_pending.
    // Unique index makes a second confirmation raise 23505 (idempotent guard).
    async createPurchaseConfirmation(input) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const current = (await client.query("select * from item_orders where id = $1 for update", [input.itemOrderId])).rows[0];
        if (!current) {
          await client.query("rollback");
          return { item: null };
        }
        if (current.fulfillment_status !== "purchasing") {
          await client.query("rollback");
          const error = new Error("Item is not in purchasing.");
          error.code = "ORDER_STATUS_CONFLICT";
          throw error;
        }
        const confirmation = (await client.query(
          `insert into purchase_confirmations
             (item_order_id, buyer_admin_id, actual_platform, actual_account, actual_order_no,
              spec, quantity, cost_cents, shipping_cents, voucher_keys)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           returning *`,
          [
            input.itemOrderId, input.buyerAdminId || null, input.actualPlatform, input.actualAccount || "",
            input.actualOrderNo, input.spec || "", input.quantity, input.costCents, input.shippingCents || 0,
            JSON.stringify(input.voucherKeys || [])
          ]
        )).rows[0];
        const updated = (await client.query(
          `update item_orders set fulfillment_status = 'seller_dispatch_pending' where id = $1 returning *`,
          [input.itemOrderId]
        )).rows[0];
        await client.query(
          `insert into item_order_status_history
             (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
           values ($1, 'fulfillment', 'purchasing', 'seller_dispatch_pending', 'confirm_purchase', 'admin', $2, $3)`,
          [input.itemOrderId, input.buyerAdminId || null, input.requestId || ""]
        );
        await client.query("commit");
        return { item: normalizeItem(updated), confirmation: normalizeConfirmation(confirmation) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async findConfirmationByItem(itemId) {
      const result = await pool().query("select * from purchase_confirmations where item_order_id = $1", [itemId]);
      return normalizeConfirmation(result.rows[0]);
    },

    // V2-04-07 — scope-aware procurement task list. SELF restricts to the buyer's
    // own accounts/claims; ORG/ALL see everything; SEARCH must carry an exact
    // item_no (the middleware rejects an empty search for customer service).
    async listProcurementTasks({ scope, adminUserId, itemNo = null, platform = null, statuses = null, limit = 50, offset = 0 }) {
      const args = [];
      const where = [];
      const statusList = statuses && statuses.length ? statuses : ["agent_ordering", "purchasing", "seller_dispatch_pending"];
      args.push(statusList);
      where.push(`io.fulfillment_status = any($${args.length})`);
      if (platform) {
        args.push(platform);
        where.push(`io.platform = $${args.length}`);
      }
      if (itemNo) {
        args.push(itemNo);
        where.push(`upper(io.item_no) = upper($${args.length})`);
      }
      if (scope === "SELF") {
        args.push(adminUserId);
        where.push(`(io.claimed_by_admin_id = $${args.length} or pa.owner_admin_id = $${args.length})`);
      }
      const rows = (await pool().query(
        `select io.* from item_orders io
         left join purchase_accounts pa on io.purchase_account_id = pa.id
         where ${where.join(" and ")}
         order by io.updated_at desc
         limit ${Number(limit)} offset ${Number(offset)}`,
        args
      )).rows;
      return rows.map(normalizeItem);
    },

    // V2-04-10/11 — raise an exception. One open exception per item; the item
    // must currently have exception_status = none. Sets the item overlay, appends
    // history, and opens the immutable event log — all atomically.
    async createException(input) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const item = (await client.query("select * from item_orders where id = $1 for update", [input.itemOrderId])).rows[0];
        if (!item) {
          await client.query("rollback");
          return { exception: null };
        }
        if (item.exception_status !== "none") {
          await client.query("rollback");
          const error = new Error("An exception is already active on this item.");
          error.code = "ORDER_EXCEPTION_ACTIVE";
          throw error;
        }
        const exception = (await client.query(
          `insert into order_exceptions
             (item_order_id, user_id, type, surcharge_cents, currency, detail, deadline_at, created_by_admin_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
          [input.itemOrderId, input.userId, input.type, input.surchargeCents ?? null, input.currency || "CNY",
           JSON.stringify(input.detail || {}), input.deadlineAt, input.createdByAdminId || null]
        )).rows[0];
        await client.query("update item_orders set exception_status = $2 where id = $1", [input.itemOrderId, input.exceptionStatus]);
        await client.query(
          `insert into item_order_status_history (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
           values ($1, 'exception', 'none', $2, $3, 'admin', $4, $5)`,
          [input.itemOrderId, input.exceptionStatus, `raise_${input.type}`, input.createdByAdminId || null, input.requestId || ""]
        );
        await client.query(
          `insert into order_exception_events (exception_id, action, detail, actor_type, actor_id)
           values ($1, 'raised', $2, 'admin', $3)`,
          [exception.id, JSON.stringify(input.detail || {}), input.createdByAdminId || null]
        );
        const freshItem = (await client.query("select * from item_orders where id = $1", [input.itemOrderId])).rows[0];
        await client.query("commit");
        return { exception: normalizeException(exception), item: normalizeItem(freshItem) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async findOpenExceptionByItem(itemId) {
      const result = await pool().query(
        "select * from order_exceptions where item_order_id = $1 and status = 'open' limit 1",
        [itemId]
      );
      return normalizeException(result.rows[0]);
    },

    async getException(id) {
      const result = await pool().query("select * from order_exceptions where id = $1", [id]);
      return normalizeException(result.rows[0]);
    },

    async listExceptionEvents(exceptionId) {
      const result = await pool().query(
        "select * from order_exception_events where exception_id = $1 order by created_at asc",
        [exceptionId]
      );
      return result.rows.map(normalizeExceptionEvent);
    },

    async listExpiredOpenExceptions(nowIso, limit = 100) {
      const result = await pool().query(
        "select * from order_exceptions where status = 'open' and deadline_at < $1 order by deadline_at asc limit $2",
        [nowIso, limit]
      );
      return result.rows.map(normalizeException);
    },

    // V2-04-10/11/13 — close an open exception. Optionally cancels the item's
    // fulfillment (user cancel / 24h auto-cancel). Idempotent: a non-open
    // exception raises ORDER_EXCEPTION_CLOSED so replays don't double-apply.
    async resolveException(input) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const exception = (await client.query("select * from order_exceptions where id = $1 for update", [input.exceptionId])).rows[0];
        if (!exception) {
          await client.query("rollback");
          return { exception: null };
        }
        if (exception.status !== "open") {
          await client.query("rollback");
          const error = new Error("Exception is not open.");
          error.code = "ORDER_EXCEPTION_CLOSED";
          throw error;
        }
        const updatedException = (await client.query(
          "update order_exceptions set status = $2, resolution = $3, resolved_at = now() where id = $1 returning *",
          [input.exceptionId, input.newStatus || "resolved", input.resolution || ""]
        )).rows[0];
        const item = (await client.query("select * from item_orders where id = $1 for update", [exception.item_order_id])).rows[0];
        const targetExceptionStatus = input.itemExceptionStatus || "none";
        await client.query("update item_orders set exception_status = $2 where id = $1", [exception.item_order_id, targetExceptionStatus]);
        await client.query(
          `insert into item_order_status_history (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
           values ($1, 'exception', $2, $3, $4, $5, $6, $7)`,
          [exception.item_order_id, item.exception_status, targetExceptionStatus, input.eventAction || "resolve",
           input.actorType || "system", input.actorId || null, input.requestId || ""]
        );
        if (input.cancelItem && !["completed", "cancelled", "refunded", "destroyed"].includes(item.fulfillment_status)) {
          await client.query("update item_orders set fulfillment_status = 'cancelled' where id = $1", [exception.item_order_id]);
          await client.query(
            `insert into item_order_status_history (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
             values ($1, 'fulfillment', $2, 'cancelled', $3, $4, $5, $6)`,
            [exception.item_order_id, item.fulfillment_status, input.eventAction || "cancel",
             input.actorType || "system", input.actorId || null, input.requestId || ""]
          );
        }
        await client.query(
          `insert into order_exception_events (exception_id, action, detail, actor_type, actor_id)
           values ($1, $2, $3, $4, $5)`,
          [input.exceptionId, input.eventAction || "resolved", JSON.stringify(input.eventDetail || {}),
           input.actorType || "system", input.actorId || null]
        );
        const freshItem = (await client.query("select * from item_orders where id = $1", [exception.item_order_id])).rows[0];
        await client.query("commit");
        return { exception: normalizeException(updatedException), item: normalizeItem(freshItem) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // V2-04-14 — register the merchant's domestic dispatch and move to
    // seller_dispatched. A tracking number already bound to a DIFFERENT user is
    // rejected so one courier number cannot cross-bind two buyers' orders.
    async registerDispatch({ itemId, carrier, trackingNo, adminUserId, requestId, correct = false }) {
      const requiredFrom = correct ? "seller_dispatched" : "seller_dispatch_pending";
      const client = await pool().connect();
      try {
        await client.query("begin");
        const item = (await client.query("select * from item_orders where id = $1 for update", [itemId])).rows[0];
        if (!item) {
          await client.query("rollback");
          return { item: null };
        }
        if (item.fulfillment_status !== requiredFrom) {
          await client.query("rollback");
          const error = new Error("Item is not in the right state for dispatch.");
          error.code = "ORDER_STATUS_CONFLICT";
          throw error;
        }
        if (trackingNo) {
          const clash = (await client.query(
            "select 1 from item_orders where domestic_tracking_no = $1 and user_id <> $2 and id <> $3 limit 1",
            [trackingNo, item.user_id, itemId]
          )).rows[0];
          if (clash) {
            await client.query("rollback");
            const error = new Error("Tracking number already bound to another user's order.");
            error.code = "ORDER_TRACKING_CONFLICT";
            throw error;
          }
        }
        const updated = correct
          ? (await client.query(
              "update item_orders set carrier = coalesce(nullif($2, ''), carrier), domestic_tracking_no = coalesce(nullif($3, ''), domestic_tracking_no) where id = $1 returning *",
              [itemId, carrier || "", trackingNo || ""]
            )).rows[0]
          : (await client.query(
              "update item_orders set carrier = $2, domestic_tracking_no = $3, dispatched_at = now(), fulfillment_status = 'seller_dispatched' where id = $1 returning *",
              [itemId, carrier || "", trackingNo || ""]
            )).rows[0];
        await client.query(
          `insert into item_order_status_history (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
           values ($1, 'fulfillment', $2, $3, $4, 'admin', $5, $6)`,
          [itemId, requiredFrom, correct ? "seller_dispatched" : "seller_dispatched",
           correct ? "correct_dispatch" : "register_dispatch", adminUserId || null, requestId || ""]
        );
        await client.query("commit");
        return { item: normalizeItem(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // V2-04-15 — lead reassigns a non-terminal item's purchase account / buyer.
    async reassignItem({ itemId, accountId, buyerAdminId, adminUserId, requestId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const item = (await client.query("select * from item_orders where id = $1 for update", [itemId])).rows[0];
        if (!item) {
          await client.query("rollback");
          return { item: null };
        }
        if (["completed", "cancelled", "refunded", "destroyed"].includes(item.fulfillment_status)) {
          await client.query("rollback");
          const error = new Error("A terminal item cannot be reassigned.");
          error.code = "ORDER_STATUS_CONFLICT";
          throw error;
        }
        const updated = (await client.query(
          "update item_orders set purchase_account_id = coalesce($2, purchase_account_id), claimed_by_admin_id = coalesce($3, claimed_by_admin_id) where id = $1 returning *",
          [itemId, accountId ?? null, buyerAdminId ?? null]
        )).rows[0];
        await client.query(
          `insert into item_order_status_history (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
           values ($1, 'fulfillment', $2, $2, 'reassign', 'admin', $3, $4)`,
          [itemId, item.fulfillment_status, adminUserId || null, requestId || ""]
        );
        await client.query("commit");
        return { item: normalizeItem(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // V2-04-15 — controlled correction: force a fulfillment status the normal
    // machine would reject. Always recorded in history (authorization is enforced
    // in the service: lead/super-admin, with super-admin re-auth for high risk).
    async forceTransition({ itemId, to, action, adminUserId, requestId }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const item = (await client.query("select * from item_orders where id = $1 for update", [itemId])).rows[0];
        if (!item) {
          await client.query("rollback");
          return { item: null };
        }
        const from = item.fulfillment_status;
        const updated = (await client.query(
          "update item_orders set fulfillment_status = $2 where id = $1 returning *",
          [itemId, to]
        )).rows[0];
        await client.query(
          `insert into item_order_status_history (item_order_id, field, from_status, to_status, action, actor_type, actor_id, request_id)
           values ($1, 'fulfillment', $2, $3, $4, 'admin', $5, $6)`,
          [itemId, from, to, action || "controlled_correction", adminUserId || null, requestId || ""]
        );
        await client.query("commit");
        return { item: normalizeItem(updated) };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async listItemsByParent(parentId) {
      const result = await pool().query(
        "select * from item_orders where parent_order_id = $1 order by created_at asc",
        [parentId]
      );
      return result.rows.map(normalizeItem);
    },

    async listParents(userId) {
      const result = await pool().query(
        "select * from order_parents where user_id = $1 order by created_at desc",
        [userId]
      );
      return result.rows.map(normalizeParent);
    },

    async findItemById(itemId) {
      const result = await pool().query("select * from item_orders where id = $1", [itemId]);
      return normalizeItem(result.rows[0]);
    },

    async findItemByTrackingNo(trackingNo) {
      const result = await pool().query(
        "select * from item_orders where domestic_tracking_no = $1 order by created_at desc limit 1",
        [trackingNo]
      );
      return normalizeItem(result.rows[0]);
    },

    async listItemHistory(itemId) {
      const result = await pool().query(
        "select * from item_order_status_history where item_order_id = $1 order by created_at asc",
        [itemId]
      );
      return result.rows.map(normalizeHistory);
    },

    async findTransition(itemId, idempotencyKey) {
      if (!idempotencyKey) return null;
      const result = await pool().query(
        "select * from item_order_status_history where item_order_id = $1 and idempotency_key = $2 limit 1",
        [itemId, idempotencyKey]
      );
      return normalizeHistory(result.rows[0]);
    },

    // V2-04-06 — one status transition + its history row, atomically. The row is
    // locked, the from-status is re-checked under the lock (so two concurrent
    // actions can't both cross), and the same idempotency key is a no-op replay.
    async transitionItemStatus({
      itemId, field, expectedFrom, to, action, reason, actorType, actorId, actorRole,
      idempotencyKey, requestId, evidence
    }) {
      const col = statusColumn(field);
      const client = await pool().connect();
      try {
        await client.query("begin");
        const current = (await client.query("select * from item_orders where id = $1 for update", [itemId])).rows[0];
        if (!current) {
          await client.query("rollback");
          return { item: null };
        }
        if (idempotencyKey) {
          const replay = (await client.query(
            "select 1 from item_order_status_history where item_order_id = $1 and idempotency_key = $2",
            [itemId, idempotencyKey]
          )).rows[0];
          if (replay) {
            await client.query("commit");
            return { item: normalizeItem(current), replay: true };
          }
        }
        if (current[col] !== expectedFrom) {
          await client.query("rollback");
          const error = new Error("Item status changed concurrently.");
          error.code = "ORDER_STATUS_CONFLICT";
          throw error;
        }
        const updated = (await client.query(
          `update item_orders set ${col} = $2 where id = $1 returning *`,
          [itemId, to]
        )).rows[0];
        const history = (await client.query(
          `insert into item_order_status_history
             (item_order_id, field, from_status, to_status, action, reason,
              actor_type, actor_id, actor_role, idempotency_key, request_id, evidence)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           returning *`,
          [
            itemId, field, expectedFrom, to, action, reason || "", actorType,
            actorId || null, actorRole || "", idempotencyKey || null, requestId || "",
            JSON.stringify(evidence || {})
          ]
        )).rows[0];
        await client.query("commit");
        return { item: normalizeItem(updated), history: normalizeHistory(history), replay: false };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    // Atomic parent + items (V2-04-03). Any failure rolls back the whole order.
    // A duplicate submit_key raises 23505 via the unique index; the caller maps
    // that back to the existing order.
    async createOrderWithItems({ parent, items }) {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const parentRow = (await client.query(
          `insert into order_parents
             (order_no, user_id, submit_key, item_count, items_total_cents, currency, payment_status)
           values ($1, $2, $3, $4, $5, $6, 'unpaid')
           returning *`,
          [parent.orderNo, parent.userId, parent.submitKey, parent.itemCount, parent.itemsTotalCents, parent.currency]
        )).rows[0];
        const itemRows = [];
        for (const item of items) {
          const row = (await client.query(
            `insert into item_orders
               (item_no, parent_order_id, user_id, snapshot_id, platform, spec, quantity,
                unit_price_cents, items_cents, domestic_shipping_cents, total_cents, currency)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             returning *`,
            [
              item.itemNo, parentRow.id, parent.userId, item.snapshotId, item.platform || "", item.spec,
              item.quantity, item.unitPriceCents, item.itemsCents, item.domesticShippingCents, item.totalCents, item.currency
            ]
          )).rows[0];
          itemRows.push(row);
        }
        await client.query("commit");
        return { parent: normalizeParent(parentRow), items: itemRows.map(normalizeItem) };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export function normalizeParent(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.order_no,
    userId: row.user_id,
    submitKey: row.submit_key,
    itemCount: row.item_count,
    itemsTotalCents: Number(row.items_total_cents),
    currency: row.currency,
    paymentStatus: row.payment_status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemNo: row.item_no,
    parentOrderId: row.parent_order_id,
    userId: row.user_id,
    snapshotId: row.snapshot_id,
    platform: row.platform,
    purchaseAccountId: row.purchase_account_id ?? null,
    assignedAt: row.assigned_at ?? null,
    claimedByAdminId: row.claimed_by_admin_id ?? null,
    claimedAt: row.claimed_at ?? null,
    carrier: row.carrier ?? "",
    domesticTrackingNo: row.domestic_tracking_no ?? "",
    dispatchedAt: row.dispatched_at ?? null,
    spec: row.spec,
    quantity: row.quantity,
    unitPriceCents: Number(row.unit_price_cents),
    itemsCents: Number(row.items_cents),
    domesticShippingCents: Number(row.domestic_shipping_cents),
    totalCents: Number(row.total_cents),
    currency: row.currency,
    fulfillmentStatus: row.fulfillment_status,
    exceptionStatus: row.exception_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeException(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemOrderId: row.item_order_id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    surchargeCents: row.surcharge_cents === null || row.surcharge_cents === undefined ? null : Number(row.surcharge_cents),
    currency: row.currency,
    detail: row.detail || {},
    resolution: row.resolution,
    deadlineAt: row.deadline_at,
    createdByAdminId: row.created_by_admin_id,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeExceptionEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    exceptionId: row.exception_id,
    action: row.action,
    detail: row.detail || {},
    actorType: row.actor_type,
    actorId: row.actor_id,
    createdAt: row.created_at
  };
}

export function normalizeConfirmation(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemOrderId: row.item_order_id,
    buyerAdminId: row.buyer_admin_id,
    actualPlatform: row.actual_platform,
    actualAccount: row.actual_account,
    actualOrderNo: row.actual_order_no,
    spec: row.spec,
    quantity: row.quantity,
    costCents: Number(row.cost_cents),
    shippingCents: Number(row.shipping_cents),
    voucherKeys: row.voucher_keys || [],
    createdAt: row.created_at
  };
}

export function normalizeHistory(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemOrderId: row.item_order_id,
    field: row.field,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    action: row.action,
    reason: row.reason,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    idempotencyKey: row.idempotency_key,
    requestId: row.request_id,
    evidence: row.evidence || {},
    createdAt: row.created_at
  };
}
