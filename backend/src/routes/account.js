import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

export function createAccountRouter({ authService, accountService }) {
  const router = Router();
  const authenticated = requireUser(authService);

  router.get("/api/v2/account", authenticated, async (req, res, next) => {
    try { respond(res, req, (await accountService.getAccount(req.user)).account); } catch (error) { next(error); }
  });
  router.patch("/api/v2/account", authenticated, async (req, res, next) => {
    try { respond(res, req, (await accountService.updateAccount(req.user, req.body, requestMeta(req))).account); } catch (error) { next(error); }
  });
  router.post("/api/v2/account/password", authenticated, async (req, res, next) => {
    try { respond(res, req, await accountService.changePassword(req.user, req.body, requestMeta(req))); } catch (error) { next(error); }
  });
  router.get("/api/v2/addresses", authenticated, async (req, res, next) => {
    try { respond(res, req, (await accountService.listAddresses(req.user)).addresses); } catch (error) { next(error); }
  });
  router.post("/api/v2/addresses", authenticated, async (req, res, next) => {
    try { respond(res.status(201), req, (await accountService.createAddress(req.user, req.body, requestMeta(req))).address); } catch (error) { next(error); }
  });
  router.patch("/api/v2/addresses/:addressId", authenticated, async (req, res, next) => {
    try {
      const body = { ...req.body, expected_version: req.body?.expected_version ?? parseIfMatch(req) };
      respond(res, req, (await accountService.updateAddress(req.user, req.params.addressId, body, requestMeta(req))).address);
    } catch (error) { next(error); }
  });
  router.delete("/api/v2/addresses/:addressId", authenticated, async (req, res, next) => {
    try {
      const result = await accountService.deleteAddress(req.user, req.params.addressId, parseIfMatch(req), requestMeta(req));
      respond(res, req, result);
    } catch (error) { next(error); }
  });
  router.get("/api/v2/account/deletion-eligibility", authenticated, async (req, res, next) => {
    try { respond(res, req, await accountService.getDeletionEligibility(req.user)); } catch (error) { next(error); }
  });
  router.post("/api/v2/account/deletion-requests", authenticated, async (req, res, next) => {
    try { respond(res.status(202), req, await accountService.requestDeletion(req.user, requestMeta(req))); } catch (error) { next(error); }
  });
  return router;
}

function respond(res, req, data) {
  res.json({ data, meta: { request_id: req.requestId } });
}

function parseIfMatch(req) {
  const raw = String(req.get("if-match") || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return raw || undefined;
}
