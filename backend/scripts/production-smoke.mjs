// B8-05: production/staging smoke test. Exercises the critical client and admin paths
// against a running service and reports pass/fail per step. Read-mostly and safe to run
// against staging; it creates a throwaway user via the public register endpoint.
//
//   SMOKE_BASE_URL=https://api.example.com \
//   SMOKE_ADMIN_EMAIL=ops@example.com SMOKE_ADMIN_PASSWORD=... \
//   npm run smoke
const BASE_URL = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "";

const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

async function call(path, { method = "GET", token = "", body = null } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { status: response.status, ok: response.ok, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `smoke+${runId}@example.com`;
let userToken = "";
let linkId = "";
let haulItemId = "";

await step("health is up", async () => {
  const res = await call("/health");
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

await step("version is served", async () => {
  const res = await call("/version");
  assert(res.status === 200 && res.payload?.version, "version missing");
});

await step("ready reports dependency state", async () => {
  const res = await call("/ready");
  assert([200, 503].includes(res.status), `unexpected ready status ${res.status}`);
});

await step("policies are public", async () => {
  const res = await call("/policies");
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

await step("user can register", async () => {
  const res = await call("/auth/register", { method: "POST", body: { email, password: "CorrectHorse123" } });
  assert(res.status === 201, `expected 201, got ${res.status}`);
  userToken = res.payload.session.access_token;
});

await step("user can login", async () => {
  const res = await call("/auth/login", { method: "POST", body: { email, password: "CorrectHorse123" } });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  userToken = res.payload.session.access_token;
});

await step("user can save a link", async () => {
  const res = await call("/links", { method: "POST", token: userToken, body: { url: "https://item.taobao.com/item.htm?id=1" } });
  assert(res.status === 201 || res.status === 200, `expected 2xx, got ${res.status}`);
  linkId = res.payload.link?.id || res.payload.id;
});

await step("user can add to haul", async () => {
  const res = await call(`/links/${linkId}`, { method: "PATCH", token: userToken, body: { title: "Smoke Item", spec: "Black / 42", price: 20, quantity: 1 } });
  assert(res.ok, `patch failed ${res.status}`);
  const added = await call(`/links/${linkId}/add-to-haul`, { method: "POST", token: userToken });
  assert(added.ok, `add-to-haul failed ${added.status}`);
  haulItemId = added.payload.haul_item?.id || added.payload.id;
});

await step("user can submit a purchase order", async () => {
  const res = await call("/purchase-orders", { method: "POST", token: userToken, body: { haul_item_id: haulItemId } });
  assert(res.ok, `expected 2xx, got ${res.status}`);
});

await step("user can read orders", async () => {
  const res = await call("/orders", { token: userToken });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

await step("user can read QC items", async () => {
  const res = await call("/qc/items", { token: userToken });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

await step("user can read shipping lines", async () => {
  const res = await call("/shipping-lines", { token: userToken });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

await step("user can read wallet", async () => {
  const res = await call("/wallet", { token: userToken });
  assert(res.status === 200, `expected 200, got ${res.status}`);
});

if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  let adminToken = "";
  await step("admin can login", async () => {
    const res = await call("/admin/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    adminToken = res.payload.session.access_token;
  });
  await step("admin can read overview", async () => {
    const res = await call("/admin/overview", { token: adminToken });
    assert(res.status === 200, `expected 200, got ${res.status}`);
  });
} else {
  console.log("SKIP  admin smoke (set SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD to enable)");
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\nSmoke: ${results.length - failed.length}/${results.length} passed against ${BASE_URL}`);
if (failed.length) {
  process.exit(1);
}
