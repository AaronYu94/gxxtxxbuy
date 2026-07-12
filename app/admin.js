const ADMIN_SESSION_KEY = "goatedbuy-admin-api-v1";
// API base: explicit window override first, then host-aware default
// (prod ops.goated-buy.us -> api.goated-buy.us; local -> 127.0.0.1:3000).
const DEFAULT_API_BASE_URL =
  (typeof window !== "undefined" && window.GOATEDBUY_API_BASE_URL) ||
  (typeof location !== "undefined" && /(^|\.)goated-buy\.us$/i.test(location.hostname)
    ? "https://api.goated-buy.us"
    : "http://127.0.0.1:3000");

const navItems = [
  ["overview", "Overview", []],
  ["orders", "Procurement", ["orders:read", "orders:write", "support:read"]],
  ["warehouse", "Warehouse / QC", ["warehouse:read", "warehouse:write"]],
  ["shipping", "Shipping Ops", ["shipping:read", "shipping:write", "support:read"]],
  ["policies", "Policy CMS", ["ops:policy:write"]],
  ["content", "Content Review", ["content:review:write"]],
  ["risk", "Risk Console", ["risk:case:write"]]
];

const state = {
  view: "overview",
  baseUrl: DEFAULT_API_BASE_URL,
  session: null,
  adminUser: null,
  roles: [],
  permissions: [],
  overview: null,
  orders: [],
  warehouseItems: [],
  parcels: [],
  policies: [],
  contentStories: [],
  riskCases: [],
  loading: false,
  error: ""
};

const adminView = document.querySelector("#admin-view");
const adminTitle = document.querySelector("#admin-title");
const adminNav = document.querySelector("#admin-nav");
const notice = document.querySelector(".admin-notice p");

loadSession();
render();
if (state.session?.access_token) {
  syncAdmin();
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || "{}");
    state.baseUrl = saved.baseUrl || state.baseUrl;
    state.session = saved.session || null;
    state.adminUser = saved.adminUser || null;
    state.roles = saved.roles || [];
    state.permissions = saved.permissions || [];
  } catch {
    state.session = null;
  }
}

function saveSession() {
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    baseUrl: state.baseUrl,
    session: state.session,
    adminUser: state.adminUser,
    roles: state.roles,
    permissions: state.permissions
  }));
}

async function apiRequest(path, { method = "GET", body = null, token = state.session?.access_token } = {}) {
  const response = await fetch(`${state.baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.error?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function login(formData) {
  state.baseUrl = String(formData.get("baseUrl") || state.baseUrl).replace(/\/+$/, "");
  const result = await apiRequest("/admin/auth/login", {
    method: "POST",
    token: "",
    body: {
      email: formData.get("email"),
      password: formData.get("password")
    }
  });
  state.session = result.session;
  state.adminUser = result.admin_user;
  state.roles = result.roles || [];
  state.permissions = result.permissions || [];
  state.error = "";
  saveSession();
  await syncAdmin();
}

async function logout() {
  try {
    if (state.session?.access_token) {
      await apiRequest("/admin/auth/logout", { method: "POST" });
    }
  } catch {
    // Local session cleanup still needs to happen when the token is already expired.
  }
  state.session = null;
  state.adminUser = null;
  state.roles = [];
  state.permissions = [];
  state.overview = null;
  state.orders = [];
  state.warehouseItems = [];
  state.parcels = [];
  state.policies = [];
  state.error = "";
  saveSession();
  render();
}

async function syncAdmin() {
  if (!state.session?.access_token) {
    render();
    return;
  }
  state.loading = true;
  state.error = "";
  render();
  try {
    const me = await apiRequest("/admin/me");
    state.adminUser = me.admin_user;
    state.roles = me.roles || [];
    state.permissions = me.permissions || [];

    const requests = [apiRequest("/admin/overview")];
    const keys = ["overview"];
    if (canAny(["orders:read", "orders:write", "support:read"])) {
      requests.push(apiRequest("/admin/orders?limit=50"));
      keys.push("orders");
    }
    if (canAny(["warehouse:read", "warehouse:write"])) {
      requests.push(apiRequest("/admin/warehouse/items?limit=50"));
      keys.push("warehouse");
    }
    if (canAny(["shipping:read", "shipping:write", "support:read"])) {
      requests.push(apiRequest("/admin/parcels?limit=50"));
      keys.push("parcels");
    }
    if (can("ops:policy:write")) {
      requests.push(apiRequest("/admin/policies?limit=50"));
      keys.push("policies");
    }
    if (can("content:review:write")) {
      requests.push(apiRequest("/admin/content-review?status=pending&limit=50"));
      keys.push("content");
    }
    if (can("risk:case:write")) {
      requests.push(apiRequest("/admin/risk-cases?limit=50"));
      keys.push("risk");
    }

    const results = await Promise.all(requests);
    keys.forEach((key, index) => {
      const data = results[index];
      if (key === "overview") state.overview = data.overview;
      if (key === "orders") state.orders = data.orders || [];
      if (key === "warehouse") state.warehouseItems = data.items || [];
      if (key === "parcels") state.parcels = data.parcels || [];
      if (key === "policies") state.policies = data.policies || [];
      if (key === "content") state.contentStories = data.stories || [];
      if (key === "risk") state.riskCases = data.cases || [];
    });

    saveSession();
  } catch (error) {
    state.error = error.message;
    if (error.status === 401) {
      state.session = null;
      saveSession();
    }
  } finally {
    state.loading = false;
    render();
  }
}

function can(permission) {
  return state.permissions.includes("*") || state.permissions.includes(permission);
}

function canAny(permissions = []) {
  return permissions.length === 0 || permissions.some((permission) => can(permission));
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents, fallback = "Restricted") {
  return cents === undefined || cents === null ? fallback : `$${(Number(cents) / 100).toFixed(2)}`;
}

function dateLabel(value) {
  if (!value) return "Pending";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status) {
  const labels = {
    submitted: "Submitted",
    purchasing: "Purchasing",
    seller_shipped: "Seller shipped",
    arrived: "Arrived",
    qc_ready: "QC ready",
    exception: "Exception",
    cancelled: "Cancelled",
    received: "Received",
    extra_photo_requested: "Extra photo",
    ready_to_ship: "Ready to ship",
    shipping_due: "Shipping due",
    payment_pending: "Payment pending",
    paid: "Paid",
    processing: "Processing",
    dispatched: "Dispatched",
    in_transit: "In transit",
    delivered: "Delivered",
    draft: "Draft",
    published: "Published",
    archived: "Archived"
  };
  return labels[status] || status || "Unknown";
}

function statusClass(status) {
  if (["ready_to_ship", "paid", "delivered", "published"].includes(status)) return "good";
  if (["submitted", "qc_ready", "shipping_due", "payment_pending", "processing", "draft"].includes(status)) return "warn";
  if (["exception", "cancelled", "extra_photo_requested"].includes(status)) return "bad";
  return "";
}

function empty(title, body) {
  return `
    <div class="empty">
      <div class="empty-visual"></div>
      <h3>${escapeHtml(title)}</h3>
      <p class="subtle">${escapeHtml(body)}</p>
    </div>
  `;
}

function renderNav() {
  const visible = navItems.filter(([, , permissions]) => canAny(permissions));
  const countMap = {
    orders: state.orders.length,
    warehouse: state.warehouseItems.length,
    shipping: state.parcels.length,
    policies: state.policies.length
  };
  adminNav.innerHTML = visible.map(([id, label]) => `
    <button class="${id === state.view ? "active" : ""}" data-admin-route="${id}">
      <span>${escapeHtml(label)}</span>
      ${countMap[id] ? `<span class="count">${countMap[id]}</span>` : ""}
    </button>
  `).join("");
  adminNav.querySelectorAll("[data-admin-route]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.adminRoute;
      render();
    });
  });
}

function renderLogin() {
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Admin Login</h2>
          <p class="subtle">Connect to the backend API before using internal queues.</p>
        </div>
      </div>
      ${state.error ? `<p class="status bad">${escapeHtml(state.error)}</p>` : ""}
      <form class="form-grid" data-admin-login>
        <div class="field">
          <label>API base URL</label>
          <input name="baseUrl" value="${escapeHtml(state.baseUrl)}" autocomplete="url">
        </div>
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" autocomplete="username">
        </div>
        <div class="field">
          <label>Password</label>
          <input name="password" type="password" autocomplete="current-password">
        </div>
        <div class="actions field full">
          <button class="primary-button" type="submit">${state.loading ? "Connecting..." : "Login"}</button>
        </div>
      </form>
    </section>
  `;
}

function renderOverview() {
  const counts = state.overview?.counts || {};
  return `
    ${state.error ? `<p class="status bad">${escapeHtml(state.error)}</p>` : ""}
    <section class="metric-row">
      ${metric("Orders", counts.orders?.total)}
      ${metric("Exceptions", counts.orders?.exceptions)}
      ${metric("Warehouse", counts.warehouse?.total)}
      ${metric("Parcels", counts.parcels?.total)}
      ${metric("Policies", counts.policies?.total)}
    </section>
    <div class="grid two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Queues</h2>
            <p class="subtle">${escapeHtml(state.adminUser?.email || "")} · ${escapeHtml(state.roles.join(", ") || "custom role")}</p>
          </div>
          <button class="secondary-button" data-admin-refresh>Refresh</button>
        </div>
        <div class="list">
          ${canAny(["orders:read", "orders:write", "support:read"]) ? queueCard("Procurement", `${state.orders.length} visible orders`, "orders") : ""}
          ${canAny(["warehouse:read", "warehouse:write"]) ? queueCard("Warehouse / QC", `${state.warehouseItems.length} visible items`, "warehouse") : ""}
          ${canAny(["shipping:read", "shipping:write", "support:read"]) ? queueCard("Shipping Ops", `${state.parcels.length} visible parcels`, "shipping") : ""}
          ${can("ops:policy:write") ? queueCard("Policy CMS", `${state.policies.length} CMS pages`, "policies") : ""}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Session</h2>
            <p class="subtle">${escapeHtml(state.baseUrl)}</p>
          </div>
        </div>
        <div class="list">
          <article class="card">
            <h3>${escapeHtml(state.adminUser?.display_name || state.adminUser?.email || "Admin")}</h3>
            <p class="subtle">${escapeHtml(state.permissions.join(", ") || "No explicit permissions")}</p>
            <div class="actions">
              <button class="secondary-button" data-admin-refresh>Refresh</button>
              <button class="ghost-button" data-admin-logout>Logout</button>
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function metric(label, value) {
  return `<div class="metric"><strong>${value ?? "—"}</strong><span>${escapeHtml(label)}</span></div>`;
}

function queueCard(title, body, routeId) {
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="subtle">${escapeHtml(body)}</p>
        </div>
        <button class="secondary-button" data-admin-route-button="${routeId}">Open</button>
      </div>
    </article>
  `;
}

function renderOrders() {
  if (!canAny(["orders:read", "orders:write", "support:read"])) return renderDenied();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Procurement</h2>
          <p class="subtle">Purchase orders, exceptions, and seller-side fulfillment state.</p>
        </div>
        <button class="secondary-button" data-admin-refresh>Refresh</button>
      </div>
      ${state.orders.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Item</th><th>Status</th><th>Exception</th><th>Action</th></tr></thead>
            <tbody>
              ${state.orders.map((order) => `
                <tr>
                  <td><strong>${escapeHtml(order.id.slice(0, 8))}</strong><br><span class="subtle">${escapeHtml(order.user_email)} · ${dateLabel(order.created_at)}</span></td>
                  <td>${escapeHtml(order.title)}<br><span class="subtle">${escapeHtml(order.spec)} · ${escapeHtml(order.source_platform)}</span></td>
                  <td><span class="status ${statusClass(order.status)}">${statusLabel(order.status)}</span></td>
                  <td>${order.exception ? `<span class="status bad">${escapeHtml(order.exception)}</span>` : `<span class="subtle">None</span>`}</td>
                  <td>${renderOrderActions(order)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : empty("No orders", "Orders submitted by clients appear here.")}
    </section>
  `;
}

function renderOrderActions(order) {
  const statusForm = can("orders:write") ? `
    <form class="actions" data-admin-order-status="${order.id}">
      <select name="status" aria-label="Order status">
        ${["purchasing", "seller_shipped", "arrived", "qc_ready", "cancelled"].map((status) => `
          <option value="${status}" ${status === order.status ? "selected" : ""}>${statusLabel(status)}</option>
        `).join("")}
      </select>
      <input name="external_order_no" placeholder="Seller order #" value="${escapeHtml(order.external_order_no || "")}">
      <button class="secondary-button" type="submit">Update</button>
    </form>
  ` : "";
  const exceptionForm = canAny(["orders:write", "support:write"]) ? `
    <form class="actions" data-admin-order-exception="${order.id}">
      <input name="exception" placeholder="Exception reason">
      <button class="secondary-button" type="submit">Flag</button>
    </form>
  ` : "";
  return statusForm || exceptionForm ? `${statusForm}${exceptionForm}` : `<span class="subtle">Read only</span>`;
}

function renderWarehouse() {
  if (!canAny(["warehouse:read", "warehouse:write"])) return renderDenied();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Warehouse / QC</h2>
          <p class="subtle">Received inventory, QC state, weights, photo counts, and storage location.</p>
        </div>
        <button class="secondary-button" data-admin-refresh>Refresh</button>
      </div>
      ${state.warehouseItems.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Status</th><th>Weight</th><th>QC photos</th><th>Storage</th></tr></thead>
            <tbody>
              ${state.warehouseItems.map((item) => `
                <tr>
                  <td><strong>${escapeHtml(item.title)}</strong><br><span class="subtle">${escapeHtml(item.user_email)} · ${escapeHtml(item.spec)}</span></td>
                  <td><span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></td>
                  <td>${item.weight_grams ? `${(item.weight_grams / 1000).toFixed(2)} kg` : "Pending"}</td>
                  <td>${item.photo_count}</td>
                  <td>${escapeHtml(item.storage_location || "Unassigned")}<br><span class="subtle">${dateLabel(item.received_at)}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : empty("No warehouse items", "Received and QC-ready items appear here.")}
    </section>
  `;
}

function renderShipping() {
  if (!canAny(["shipping:read", "shipping:write", "support:read"])) return renderDenied();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Shipping Ops</h2>
          <p class="subtle">Parcel queue. Support accounts see redacted payment and final-fee fields.</p>
        </div>
        <button class="secondary-button" data-admin-refresh>Refresh</button>
      </div>
      ${state.parcels.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Parcel</th><th>Destination</th><th>Line</th><th>Fee</th><th>Status</th><th>Tracking</th></tr></thead>
            <tbody>
              ${state.parcels.map((parcel) => `
                <tr>
                  <td><strong>${escapeHtml(parcel.id.slice(0, 8))}</strong><br><span class="subtle">${escapeHtml(parcel.user_email)} · ${parcel.item_count} item(s)</span></td>
                  <td>${escapeHtml(parcel.destination_country || "Pending")}<br><span class="subtle">${escapeHtml(parcel.recipient_name || "")}</span></td>
                  <td>${escapeHtml(parcel.shipping_line_name || parcel.shipping_line_code || "Pending")}</td>
                  <td>${money(parcel.final_fee_cents)}<br><span class="subtle">${escapeHtml(parcel.payment_status || "")}</span></td>
                  <td><span class="status ${statusClass(parcel.status)}">${statusLabel(parcel.status)}</span></td>
                  <td>${escapeHtml(parcel.tracking_number || "Pending")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : empty("No parcels", "Client-submitted parcels appear here.")}
    </section>
  `;
}

function renderPolicies() {
  if (!can("ops:policy:write")) return renderDenied();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Policy CMS</h2>
          <p class="subtle">Draft and published Trust Center copy with version increments.</p>
        </div>
        <button class="secondary-button" data-admin-refresh>Refresh</button>
      </div>
      ${state.policies.length ? `
        <div class="grid two">
          ${state.policies.map((policy) => `
            <article class="card">
              <form class="form-grid" data-admin-policy="${policy.id}">
                <div class="field">
                  <label>Title</label>
                  <input name="title" value="${escapeHtml(policy.title)}">
                </div>
                <div class="field">
                  <label>Status</label>
                  <select name="status">
                    ${["draft", "published", "archived"].map((status) => `
                      <option value="${status}" ${status === policy.status ? "selected" : ""}>${statusLabel(status)}</option>
                    `).join("")}
                  </select>
                </div>
                <div class="field full">
                  <label>${escapeHtml(policy.policy_type)} · v${policy.version}</label>
                  <textarea name="body">${escapeHtml(policy.body)}</textarea>
                </div>
                <div class="actions field full">
                  <button class="primary-button" type="submit">Save</button>
                </div>
              </form>
            </article>
          `).join("")}
        </div>
      ` : empty("No policy pages", "Policy CMS pages appear here when seeded in the backend.")}
    </section>
  `;
}

function renderContent() {
  if (!can("content:review:write")) return renderDenied();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Content Review</h2>
          <p class="subtle">Moderate pending Haul Stories. Approve to publish, or reject/hide with a reason.</p>
        </div>
        <button class="secondary-button" data-admin-refresh>Refresh</button>
      </div>
      ${state.contentStories.length ? state.contentStories.map((story) => `
        <article class="card">
          <div class="card-head">
            <div>
              <div class="item-title">${escapeHtml(story.title)}</div>
              <p class="subtle">${escapeHtml(story.privacy_level)} · ${escapeHtml(story.review_status)}</p>
            </div>
          </div>
          <p class="subtle" style="margin-top:8px">${escapeHtml(story.body || "")}</p>
          <form class="form-grid" data-admin-content="${story.id}">
            <div class="field">
              <label>Action</label>
              <select name="action">
                ${["approve", "reject", "hide"].map((action) => `<option value="${action}">${action}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Reason (required for reject/hide)</label>
              <input name="reason" placeholder="Reason">
            </div>
            <div class="actions field full">
              <button class="primary-button" type="submit">Apply</button>
            </div>
          </form>
        </article>
      `).join("") : empty("Nothing pending", "No stories are awaiting review.")}
    </section>
  `;
}

function renderRisk() {
  if (!can("risk:case:write")) return renderDenied();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Risk Console</h2>
          <p class="subtle">Open and advance risk cases through legal status transitions.</p>
        </div>
        <button class="secondary-button" data-admin-refresh>Refresh</button>
      </div>
      <article class="card">
        <form class="form-grid" data-admin-risk-create>
          <div class="field">
            <label>Risk type</label>
            <input name="risk_type" placeholder="chargeback" required>
          </div>
          <div class="field">
            <label>Severity</label>
            <select name="severity">
              ${["low", "medium", "high"].map((s) => `<option value="${s}" ${s === "medium" ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          <div class="field full">
            <label>Reason</label>
            <input name="reason" placeholder="Reason">
          </div>
          <div class="actions field full">
            <button class="primary-button" type="submit">Open case</button>
          </div>
        </form>
      </article>
      ${state.riskCases.length ? state.riskCases.map((riskCase) => `
        <article class="card">
          <div class="card-head">
            <div>
              <div class="item-title">${escapeHtml(riskCase.risk_type)}</div>
              <p class="subtle">${escapeHtml(riskCase.severity)} · ${escapeHtml(riskCase.reason || "")}</p>
            </div>
            <span class="status">${escapeHtml(riskCase.status)}</span>
          </div>
          <form class="form-grid" data-admin-risk="${riskCase.id}">
            <div class="field">
              <label>Status</label>
              <select name="status">
                ${["open", "investigating", "resolved", "dismissed"].map((status) => `
                  <option value="${status}" ${status === riskCase.status ? "selected" : ""}>${status}</option>
                `).join("")}
              </select>
            </div>
            <div class="actions field full">
              <button class="primary-button" type="submit">Update</button>
            </div>
          </form>
        </article>
      `).join("") : empty("No risk cases", "Risk cases appear here when opened manually or by automated rules.")}
    </section>
  `;
}

function renderDenied() {
  return empty("No access", "This admin account does not have permission for this queue.");
}

function attachHandlers() {
  document.querySelector("form[data-admin-login]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.loading = true;
    state.error = "";
    render();
    try {
      await login(formData);
    } catch (error) {
      state.loading = false;
      state.error = error.message;
      render();
    }
  });

  document.querySelectorAll("[data-admin-route-button]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.adminRouteButton;
      render();
    });
  });

  document.querySelectorAll("[data-admin-refresh]").forEach((button) => {
    button.addEventListener("click", () => syncAdmin());
  });

  document.querySelectorAll("[data-admin-logout]").forEach((button) => {
    button.addEventListener("click", () => logout());
  });

  document.querySelectorAll("form[data-admin-order-status]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await runAction(() => apiRequest(`/admin/orders/${form.dataset.adminOrderStatus}/status`, {
        method: "PATCH",
        body: {
          status: data.get("status"),
          external_order_no: data.get("external_order_no"),
          reason: "admin_console_update"
        }
      }));
    });
  });

  document.querySelectorAll("form[data-admin-order-exception]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await runAction(() => apiRequest(`/admin/orders/${form.dataset.adminOrderException}/exception`, {
        method: "PATCH",
        body: { exception: data.get("exception") }
      }));
    });
  });

  document.querySelectorAll("form[data-admin-policy]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await runAction(() => apiRequest(`/admin/policies/${form.dataset.adminPolicy}`, {
        method: "PATCH",
        body: {
          title: data.get("title"),
          body: data.get("body"),
          status: data.get("status")
        }
      }));
    });
  });

  document.querySelectorAll("form[data-admin-content]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await runAction(() => apiRequest(`/admin/content-review/${form.dataset.adminContent}/action`, {
        method: "POST",
        body: { action: data.get("action"), reason: data.get("reason") }
      }));
    });
  });

  document.querySelector("form[data-admin-risk-create]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await runAction(() => apiRequest("/admin/risk-cases", {
      method: "POST",
      body: { risk_type: data.get("risk_type"), severity: data.get("severity"), reason: data.get("reason") }
    }));
  });

  document.querySelectorAll("form[data-admin-risk]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await runAction(() => apiRequest(`/admin/risk-cases/${form.dataset.adminRisk}`, {
        method: "PATCH",
        body: { status: data.get("status") }
      }));
    });
  });
}

async function runAction(action) {
  state.loading = true;
  state.error = "";
  render();
  try {
    await action();
    await syncAdmin();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    render();
  }
}

function render() {
  if (notice) {
    notice.textContent = state.session?.access_token
      ? `Connected to ${state.baseUrl}. Visible queues are determined by the logged-in admin permissions.`
      : "Login to the backend API to load permission-gated admin queues.";
  }

  const visibleIds = navItems.filter(([, , permissions]) => canAny(permissions)).map(([id]) => id);
  if (!state.session?.access_token) state.view = "overview";
  if (state.session?.access_token && !visibleIds.includes(state.view)) state.view = "overview";

  const viewMap = {
    overview: ["Overview", state.session?.access_token ? renderOverview : renderLogin],
    orders: ["Procurement", renderOrders],
    warehouse: ["Warehouse / QC", renderWarehouse],
    shipping: ["Shipping Ops", renderShipping],
    policies: ["Policy CMS", renderPolicies],
    content: ["Content Review", renderContent],
    risk: ["Risk Console", renderRisk]
  };
  const [title, renderer] = viewMap[state.view] || viewMap.overview;
  adminTitle.textContent = title;
  adminView.innerHTML = `${state.loading ? `<p class="status warn">Loading...</p>` : ""}${renderer()}`;
  renderNav();
  attachHandlers();
}
