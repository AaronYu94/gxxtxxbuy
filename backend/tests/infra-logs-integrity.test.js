import assert from "node:assert/strict";
import test from "node:test";
import { redactLogFields, redactHeaders } from "../src/utils/redact.js";
import { verifyLedgerIntegrity } from "../src/db/integrity-check.js";

// ---- V2-12-05 log separation / redaction ----
test("structured log fields are scrubbed of tokens, addresses, payment, identity", () => {
  const log = {
    action: "login",
    access_token: "secret-abc",
    user: { email: "a@x.com", line1: "1 Main St", postal_code: "90001", id_number: "X123" },
    payment: { card: "4111111111111111", cvv: "123", amount: 100 },
    totp_secret: "JBSWY3DP",
    note: "ok"
  };
  const safe = redactLogFields(log);
  assert.equal(safe.access_token, "[REDACTED]");
  assert.equal(safe.user.line1, "[REDACTED]");
  assert.equal(safe.user.postal_code, "[REDACTED]");
  assert.equal(safe.user.id_number, "[REDACTED]");
  assert.equal(safe.payment.card, "[REDACTED]");
  assert.equal(safe.payment.cvv, "[REDACTED]");
  assert.equal(safe.totp_secret, "[REDACTED]");
  // Non-sensitive fields survive.
  assert.equal(safe.action, "login");
  assert.equal(safe.user.email, "a@x.com");
  assert.equal(safe.payment.amount, 100);
  assert.equal(safe.note, "ok");
});

test("authorization headers are redacted", () => {
  const h = redactHeaders({ Authorization: "Bearer x", "X-Api-Key": "k", accept: "json" });
  assert.equal(h.authorization, "[REDACTED]");
  assert.equal(h["x-api-key"], "[REDACTED]");
  assert.equal(h.accept, "json");
});

// ---- V2-12-04 ledger integrity (recovery verification) ----
test("integrity check passes when every ledger transaction balances", async () => {
  // Stub query returning balanced ledgers (0 unbalanced everywhere).
  const query = async (sql) => {
    if (sql.includes("from commission_entries s") || sql.includes("s from commission_entries")) return { rows: [{ s: 0 }] };
    if (sql.includes("referral_effective_ledger")) return { rows: [{ c: 0 }] };
    return { rows: [{ c: 0 }] }; // no unbalanced transactions
  };
  const res = await verifyLedgerIntegrity(query);
  assert.equal(res.ok, true);
  assert.ok(res.checks.every((c) => c.ok));
});

test("integrity check fails when a ledger does not net to zero", async () => {
  const query = async (sql) => {
    if (sql.includes("commission_entries s") || /s from commission_entries/.test(sql)) return { rows: [{ s: 500 }] }; // unbalanced!
    return { rows: [{ c: 0 }] };
  };
  const res = await verifyLedgerIntegrity(query);
  assert.equal(res.ok, false);
  assert.ok(res.checks.find((c) => c.name === "commission_ledger_balanced").ok === false);
});
