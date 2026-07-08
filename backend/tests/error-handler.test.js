import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  unauthorized
} from "../src/errors/app-error.js";
import { errorHandler, notFoundHandler } from "../src/middleware/error-handler.js";
import { requestLogger } from "../src/middleware/request-logger.js";

function createErrorTestServer() {
  const app = express();
  app.use(express.json());
  app.use(requestLogger({ logLevel: "silent" }));
  app.post("/json", (_req, res) => res.json({ ok: true }));
  app.get("/400", (_req, _res, next) => next(badRequest("Invalid input.")));
  app.get("/401", (_req, _res, next) => next(unauthorized()));
  app.get("/403", (_req, _res, next) => next(forbidden()));
  app.get("/409", (_req, _res, next) => next(conflict("Already exists.")));
  app.get("/500", (_req, _res, next) => next(new AppError(500, "BOOM", "Sensitive stack detail.")));
  app.use(notFoundHandler);
  app.use(errorHandler({ logger: { info() {}, error() {} } }));

  const server = app.listen(0);
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

test("error handler keeps standard envelope across core status codes", async () => {
  const { server, baseUrl } = createErrorTestServer();
  try {
    for (const [path, status, code] of [
      ["/400", 400, "BAD_REQUEST"],
      ["/401", 401, "UNAUTHORIZED"],
      ["/403", 403, "FORBIDDEN"],
      ["/missing", 404, "NOT_FOUND"],
      ["/409", 409, "CONFLICT"],
      ["/500", 500, "BOOM"]
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.json();
      assert.equal(response.status, status);
      assert.equal(body.error.code, code);
      assert.ok(body.error.request_id);
      assert.equal(Object.keys(body).length, 1);
    }
  } finally {
    server.close();
  }
});

test("invalid JSON returns 400 without stack details", async () => {
  const { server, baseUrl } = createErrorTestServer();
  try {
    const response = await fetch(`${baseUrl}/json`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{bad json"
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_JSON");
    assert.doesNotMatch(JSON.stringify(body), /SyntaxError|stack/);
  } finally {
    server.close();
  }
});
