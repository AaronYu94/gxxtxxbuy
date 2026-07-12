import express from "express";
import { requireUser, requireAdmin, requirePermission, requireAnyPermission } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// V2-11-06/08/09/10/11/12 — commission wallet, dashboard, transfer, withdrawal, ops.
export function createCommissionRouter({ authService, commissionService }) {
  const router = express.Router();
  const userAuth = requireUser(authService);
  const adminAuth = requireAdmin(authService);
  const financeWrite = requireAnyPermission(["finance:wallet:write", "finance:write"]);
  const referralWrite = requirePermission("referral:write");

  router.get("/api/v2/commission/wallet", userAuth, async (req, res, next) => {
    try { res.json(await commissionService.getWallet(req.user)); } catch (error) { next(error); }
  });
  router.get("/api/v2/commission/transactions", userAuth, async (req, res, next) => {
    try { res.json(await commissionService.listTransactions(req.user)); } catch (error) { next(error); }
  });
  router.get("/api/v2/commission/dashboard", userAuth, async (req, res, next) => {
    try { res.json(await commissionService.getPromoterDashboard(req.user)); } catch (error) { next(error); }
  });
  router.post("/api/v2/commission/transfer", userAuth, async (req, res, next) => {
    try { res.json(await commissionService.transferToBalance(req.user, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // ---- V2-11-10 withdrawal (user request; finance review/pay) ----
  router.post("/api/v2/commission/withdrawals", userAuth, async (req, res, next) => {
    try { res.status(201).json(await commissionService.requestWithdrawal(req.user, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/admin/commission/withdrawals", adminAuth, financeWrite, async (req, res, next) => {
    try { res.json(await commissionService.listWithdrawals(req.query)); } catch (error) { next(error); }
  });
  router.post("/admin/commission/withdrawals/:id/review", adminAuth, financeWrite, async (req, res, next) => {
    try { res.json(await commissionService.reviewWithdrawal(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/commission/withdrawals/:id/pay", adminAuth, financeWrite, async (req, res, next) => {
    try { res.json(await commissionService.payWithdrawal(req.adminUser, req.params.id, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/commission/withdrawals/:id/fail", adminAuth, financeWrite, async (req, res, next) => {
    try { res.json(await commissionService.failWithdrawal(req.adminUser, req.params.id, req.body, requestMeta(req))); } catch (error) { next(error); }
  });

  // ---- V2-11-11 discipline (referral ops) + V2-11-12 clawback (finance) ----
  router.post("/admin/commission/discipline", adminAuth, referralWrite, async (req, res, next) => {
    try { res.json(await commissionService.discipline(req.adminUser, req.adminRoles, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.post("/admin/commission/clawback", adminAuth, financeWrite, async (req, res, next) => {
    try { res.json(await commissionService.clawbackForRefund({ parcelId: req.body?.parcel_id, refundRef: req.body?.refund_ref })); } catch (error) { next(error); }
  });

  return router;
}
