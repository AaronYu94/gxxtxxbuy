import express from "express";
import { requireUser } from "../middleware/auth.js";
import { requestMeta } from "./auth.js";

// Social login routes: provider list, authorize redirect, callback → session.
export function createOAuthRouter({ authService, oauthService, env = {} }) {
  const router = express.Router();

  // Which providers are available (configured) for the sign-in UI.
  router.get("/auth/oauth/providers", (_req, res, next) => {
    try { res.json(oauthService.listProviders()); } catch (error) { next(error); }
  });

  // Begin authorization — redirect the browser to the provider.
  router.get("/auth/oauth/:provider/start", (req, res, next) => {
    try {
      const { authorize_url } = oauthService.startAuthorization(req.params.provider, { returnTo: req.query.return_to || "" });
      res.redirect(302, authorize_url);
    } catch (error) { next(error); }
  });

  // Provider callback (GET for query-string providers, POST for Apple form_post).
  const callback = async (req, res, next) => {
    try {
      const code = req.query.code || req.body?.code;
      const state = req.query.state || req.body?.state;
      const result = await oauthService.handleCallback(req.params.provider, { code, state, requestMeta: requestMeta(req) });
      const target = result.return_to || env.oauthSuccessRedirect || "/";
      // Hand the session back to the SPA via the URL fragment (not logged, not sent to servers).
      const access = result.session?.access_token || "";
      const refresh = result.session?.refresh_token || "";
      const wantsHtml = String(req.get("accept") || "").includes("text/html");
      if (wantsHtml && target) {
        return res.redirect(302, `${target}#access_token=${encodeURIComponent(access)}&refresh_token=${encodeURIComponent(refresh)}&provider=${req.params.provider}`);
      }
      res.json(result);
    } catch (error) { next(error); }
  };
  router.get("/auth/oauth/:provider/callback", callback);
  router.post("/auth/oauth/:provider/callback", callback);

  // The providers a signed-in user has linked.
  router.get("/api/v2/account/linked-providers", requireUser(authService), async (req, res, next) => {
    try { res.json(await authService.listLinkedProviders(req.user)); } catch (error) { next(error); }
  });

  return router;
}
