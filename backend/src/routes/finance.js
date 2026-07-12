import { Router } from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-05 — user wallet + top-up surface, the signed payment webhook, and admin
// exchange-rate management.
export function createFinanceRouter({ authService, financeService }) {
  const router = Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const financeRead = requireAnyPermission(["finance:read", "finance:write"]);
  const financeWrite = requirePermission("finance:write");
  const financeAdjust = requirePermission("finance:adjust");

  router.get("/api/v2/wallet", userAuth, async (req, res, next) => {
    try {
      res.json(await financeService.getBalance(req.user.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/wallet/transactions", userAuth, async (req, res, next) => {
    try {
      res.json(await financeService.listTransactions(req.user.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v2/wallet/top-ups", userAuth, async (req, res, next) => {
    try {
      const result = await financeService.createTopUp(req.user, req.body, requestMeta(req));
      res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/wallet/top-ups", userAuth, async (req, res, next) => {
    try {
      res.json(await financeService.listTopUps(req.user));
    } catch (error) {
      next(error);
    }
  });

  // V2-05-09/10 — pay a parent order from the wallet + shortfall preview.
  router.get("/api/v2/orders/:id/payment-preview", userAuth, async (req, res, next) => {
    try {
      res.json(await financeService.getOrderPaymentPreview(req.user, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v2/orders/:id/pay", userAuth, async (req, res, next) => {
    try {
      res.json(await financeService.payOrder(req.user, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-05-11 — pay a price-increase surcharge from the wallet.
  router.post("/api/v2/orders/items/:id/pay-surcharge", userAuth, async (req, res, next) => {
    try {
      res.json(await financeService.paySurcharge(req.user, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-05-13 — user withdrawal request + list.
  router.post("/api/v2/wallet/withdrawals", userAuth, async (req, res, next) => {
    try {
      res.status(201).json(await financeService.requestWithdrawal(req.user, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v2/wallet/withdrawals", userAuth, async (req, res, next) => {
    try {
      res.json(await financeService.listWithdrawals(req.user));
    } catch (error) {
      next(error);
    }
  });

  // V2-05-14 — finance review + execute.
  router.post("/admin/finance/withdrawals/:id/review", adminAuth, financeWrite, async (req, res, next) => {
    try {
      res.json(await financeService.reviewWithdrawal(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/finance/withdrawals/:id/execute", adminAuth, financeWrite, async (req, res, next) => {
    try {
      res.json(await financeService.executeWithdrawal(req.adminUser, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-05-15/16 — manual adjustment maker-checker.
  router.post("/admin/finance/adjustments", adminAuth, financeAdjust, async (req, res, next) => {
    try {
      res.status(201).json(await financeService.createAdjustment(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/finance/adjustments", adminAuth, financeRead, async (req, res, next) => {
    try {
      res.json(await financeService.listAdjustments());
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/finance/adjustments/:id/approve", adminAuth, financeAdjust, async (req, res, next) => {
    try {
      res.json(await financeService.approveAdjustment(req.adminUser, req.adminRoles, req.params.id, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/finance/adjustments/:id/reject", adminAuth, financeAdjust, async (req, res, next) => {
    try {
      res.json(await financeService.rejectAdjustment(req.adminUser, req.params.id, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // V2-05-17 top-up exception workbench + V2-05-18 reconciliation import.
  router.get("/admin/finance/topup-exceptions", adminAuth, financeRead, async (req, res, next) => {
    try {
      res.json(await financeService.listTopUpExceptions(req.query));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/finance/reconciliation", adminAuth, financeWrite, async (req, res, next) => {
    try {
      res.status(201).json(await financeService.importReconciliation(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  // Signed provider webhook (no session auth — verified by signature).
  router.post("/webhooks/payments", async (req, res, next) => {
    try {
      res.json(await financeService.handlePaymentWebhook({
        body: req.body,
        signature: req.get("x-goatedbuy-signature") || ""
      }));
    } catch (error) {
      next(error);
    }
  });

  // Admin exchange-rate management (V2-05-03).
  router.post("/admin/finance/exchange-rates", adminAuth, financeWrite, async (req, res, next) => {
    try {
      res.status(201).json(await financeService.setExchangeRate(req.adminUser, req.body, requestMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/finance/exchange-rates", adminAuth, financeRead, async (req, res, next) => {
    try {
      res.json(await financeService.listExchangeRates(req.query.currency));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
