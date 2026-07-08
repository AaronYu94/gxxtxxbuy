import { Router } from "express";
import { forbidden, notFound } from "../errors/app-error.js";

export function createStorageRouter({ storage, signedUrlHelper }) {
  const router = Router();

  router.get("/storage/private/:key", async (req, res, next) => {
    try {
      const key = req.params.key;
      const isValid = signedUrlHelper.verify({
        key,
        expires: req.query.expires,
        signature: req.query.signature
      });
      if (!isValid) {
        throw forbidden("Signed URL is invalid or expired.");
      }

      const object = await storage.getObject({ key });
      if (!object) {
        throw notFound("Storage object not found.");
      }

      res.set({
        "content-type": object.contentType || "application/octet-stream",
        "cache-control": "private, max-age=60",
        "content-length": String(object.sizeBytes || object.body.length)
      });
      res.send(object.body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
