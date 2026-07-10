import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAuditEvent, redactMetadata, writeAuditLog } from "../src/audit/audit-log.js";
import { PERMISSIONS, ROLE_DEFINITIONS, hasPermission } from "../src/rbac/permissions.js";
import { MemoryAuditRepository } from "./helpers/memory-auth-repository.js";

test("RBAC definitions include required operational roles and permissions", () => {
  const roleCodes = ROLE_DEFINITIONS.map((role) => role.code);
  for (const role of ["super_admin", "procurement_agent", "procurement_lead", "support_agent", "warehouse_operator", "warehouse_lead", "finance_operator", "campaign_operator", "referral_operator"]) {
    assert.ok(roleCodes.includes(role));
  }
  assert.ok(PERMISSIONS.some(([code]) => code === "*"));
  assert.equal(hasPermission(["*"], "finance:wallet:write"), true);
  assert.equal(hasPermission(["orders:read"], "orders:write"), false);
});

test("audit writer redacts sensitive metadata and respects critical failures", async () => {
  const redacted = redactMetadata({
    email: "buyer@example.com",
    password: "secret",
    nested: {
      refresh_token: "secret-token"
    }
  });
  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.nested.refresh_token, "[REDACTED]");
  assert.equal(redacted.email, "buyer@example.com");

  const repository = new MemoryAuditRepository();
  await writeAuditLog({
    repository,
    event: normalizeAuditEvent({
      actorType: "admin",
      actorAdminUserId: "admin-1",
      action: "admin.test",
      resourceType: "test",
      resourceId: "resource-1",
      metadata: { password: "secret" }
    })
  });
  assert.equal(repository.logs.length, 1);
  assert.equal(repository.logs[0].metadata.password, "[REDACTED]");

  const failingRepository = new MemoryAuditRepository({ fail: true });
  const soft = await writeAuditLog({
    repository: failingRepository,
    logger: { error() {} },
    critical: false,
    event: {
      actorType: "system",
      action: "soft.audit",
      resourceType: "test"
    }
  });
  assert.equal(soft, false);

  await assert.rejects(
    writeAuditLog({
      repository: failingRepository,
      logger: { error() {} },
      critical: true,
      event: {
        actorType: "system",
        action: "critical.audit",
        resourceType: "test"
      }
    }),
    /audit insert failed/
  );
});
