const STORAGE_KEY = "goatedbuy-workspace-v1";
const API_STORAGE_KEY = "goatedbuy-client-api-v1";
const SESSION_STORAGE_KEY = "goatedbuy-client-session-v2";
const PREFERENCES_STORAGE_KEY = "goatedbuy-client-preferences-v2";
const DEVICE_STORAGE_KEY = "goatedbuy-client-device-v2";
const runtime = window.GoatedBuyRuntime;
const runtimeConfig = runtime?.config || {};
const DEFAULT_API_BASE_URL = runtimeConfig.apiBaseUrl || "http://127.0.0.1:3000";
const ROUTE_PATHS = Object.freeze({
  dashboard: "/home", links: "/links", haul: "/forwarding", orders: "/orders",
  qc: "/warehouse", shipping: "/parcels", wallet: "/wallet", creator: "/affiliate",
  guide: "/help", community: "/community", trust: "/trust", login: "/account/login",
  register: "/account/register", verifyEmail: "/account/verify-email",
  verifyDevice: "/account/verify-device", account: "/account/settings", addresses: "/account/addresses"
});
const PATH_ROUTES = new Map(Object.entries(ROUTE_PATHS).map(([viewId, path]) => [path, viewId]));
const PROTECTED_VIEWS = new Set(["links", "haul", "orders", "qc", "wallet", "account", "addresses"]);
const AUTH_VIEWS = new Set(["login", "register", "verifyEmail", "verifyDevice"]);
const deviceId = loadDeviceId();
const preferences = loadPreferences();
const i18n = window.GoatedBuyI18n.create(preferences.locale);

const navItems = [
  ["dashboard", "nav.home", "house"],
  ["shipping", "nav.shipping", "calculator"],
  ["haul", "nav.forwarding", "package-open"],
  ["guide", "nav.help", "circle-help"],
  ["creator", "nav.affiliate", "badge-percent"]
];

// Design Language V2 · single source of truth for the parcel journey (Stage B).
// The 7 canonical stages drive: the home spine (motion-v2.js reads window.JOURNEY_STAGES),
// and the New User Guide timeline. Colors follow the Journey palette roles
// (ink=origin · coral=brand act · amber=inspection · ship-blue=domestic · air-purple=international · success=done).
const JOURNEY_STAGES = [
  { label: "China",     cn: "中国货源", color: "#8A929B", glyph: "M9 15l6-6M8.5 12l-2 2a2.8 2.8 0 004 4l2-2M15.5 12l2-2a2.8 2.8 0 00-4-4l-2 2", detail: "Search platforms and suppliers; paste Taobao, 1688 or Weidian links." },
  { label: "Purchased", cn: "平台代采", color: "#F0503D", glyph: "M5 12.5l4.5 4.5L19 7", detail: "A dedicated agent buys it for you; the seller ships to our China warehouse." },
  { label: "QC",        cn: "入仓质检", color: "#B5741A", glyph: "M11 4a7 7 0 105 12l4 4M11 8v6M8 11h6", detail: "Inspected and photographed on arrival; defects are flagged before shipping." },
  { label: "Warehouse", cn: "仓储",     color: "#2F6BF0", glyph: "M4 20V9l8-4 8 4v11M9 20v-6h6v6", detail: "Approved goods enter 90 days of free storage until you're ready." },
  { label: "Bundle",    cn: "合包",     color: "#2F6BF0", glyph: "M12 4l7 3-7 3-7-3 7-3zM5 11l7 3 7-3M5 15l7 3 7-3", detail: "Combine many separate orders into one smart, lighter parcel." },
  { label: "Air",       cn: "国际空运", color: "#6C4BD6", glyph: "M20 5L5 11l5 2M20 5l-6 15-2-6M20 5l-8 8", detail: "Pick from 700+ routes to 220+ countries; follow live tracking." },
  { label: "Delivered", cn: "送达",     color: "#16915B", glyph: "M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5", detail: "One dashboard for every order, payment, parcel and message." }
];
if (typeof window !== "undefined") window.JOURNEY_STAGES = JOURNEY_STAGES;

const sourceLabels = ["TikTok", "Reddit", "Discord", "Creator spreadsheet", "Taobao", "1688", "Weidian / Micro", "Yupoo"];

const policyCards = [
  ["Fees", "Item price, domestic shipping, service fee, estimated shipping, and final shipping must stay visible."],
  ["QC", "QC photos help you review visible details before shipping. They are not an authenticity guarantee."],
  ["Storage", "Items get 90 days of free warehouse storage after arrival before long-term storage rules apply."],
  ["Shipping", "Estimated shipping can change after final packing, chargeable weight, and carrier confirmation."],
  ["Refunds", "Refund availability depends on order status, seller handling, and which services have already been performed."],
  ["Creator content", "Creators and community members may share links. GOATEDBUY does not officially endorse third-party items."],
  ["Privacy", "Users can only access their own orders, QC, parcels, wallet, and saved links."]
];

let state = loadState();
let apiState = loadApiState();
let currentView = viewFromHash();
let returnView = "dashboard";
let authFlow = { email: "", password: "", verificationToken: "", resendAvailableAt: 0, loading: false, error: "" };
let accountState = { account: null, addresses: [], loading: false, loaded: false, error: "", editingAddressId: "" };

const view = document.querySelector("#view");
const pageTitle = document.querySelector("#page-title");
const nav = document.querySelector("#nav");
const quickRail = document.querySelector("#quick-rail");

function defaultState() {
  return {
    links: [],
    items: [],
    qcItems: [],
    orders: [],
    parcels: [],
    shippingLines: [],
    wallet: { balance: 0, balance_cents: 0, currency: "USD", transactions: [] },
    coupons: [],
    policies: [],
    draftLinkId: null,
    shippingCountry: "United States",
    selectedLine: "Balanced Air",
    creator: { loaded: false, error: "", data: null },
    toast: ""
  };
}

function loadState() {
  try {
    return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return defaultState();
  }
}

function defaultApiState() {
  return {
    baseUrl: DEFAULT_API_BASE_URL,
    accessToken: "",
    refreshToken: "",
    userEmail: "",
    connected: false,
    loading: false,
    error: ""
  };
}

function loadApiState() {
  try {
    const safe = JSON.parse(localStorage.getItem(API_STORAGE_KEY) || "{}");
    const session = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "{}");
    return { ...defaultApiState(), ...safe, accessToken: session.accessToken || "", refreshToken: session.refreshToken || "" };
  } catch {
    return defaultApiState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveApiState() {
  const { accessToken, refreshToken, ...safeState } = apiState;
  localStorage.setItem(API_STORAGE_KEY, JSON.stringify(safeState));
  if (accessToken || refreshToken) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
  else sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function hasApiSession() {
  return Boolean(apiState.accessToken);
}

function loadDeviceId() {
  const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(DEVICE_STORAGE_KEY, value);
  return value;
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
    return {
      locale: runtimeConfig.enabledLocales?.includes(saved.locale) ? saved.locale : runtimeConfig.defaultLocale || "en-US",
      currency: runtimeConfig.displayCurrencies?.includes(saved.currency) ? saved.currency : runtimeConfig.defaultCurrency || "USD"
    };
  } catch {
    return { locale: runtimeConfig.defaultLocale || "en-US", currency: runtimeConfig.defaultCurrency || "USD" };
  }
}

function savePreferences() {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function viewFromHash() {
  const path = decodeURIComponent(location.hash.replace(/^#/, "") || "/home");
  return PATH_ROUTES.get(path) || "dashboard";
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function nowLabel() {
  return new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function normalizeUrl(raw) {
  const value = raw.trim();
  if (!value) throw new Error("Paste an item link to start your haul.");
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (!url.hostname.includes(".")) throw new Error("Use a valid item URL.");
  return url;
}

function platformFromHost(host) {
  const lower = host.toLowerCase();
  if (lower.includes("taobao")) return "Taobao";
  if (lower.includes("1688")) return "1688";
  if (lower.includes("weidian")) return "Weidian";
  if (lower.includes("yupoo")) return "Yupoo";
  if (lower.includes("tmall")) return "Tmall";
  if (lower.includes("reddit")) return "Reddit";
  if (lower.includes("tiktok")) return "TikTok";
  if (lower.includes("discord")) return "Discord";
  return "Other";
}

function setToast(message) {
  state.toast = message;
  saveState();
  render();
  setTimeout(() => {
    state.toast = "";
    saveState();
    renderToast();
  }, 2800);
}

function statusLabel(status) {
  const labels = {
    saved: "Saved",
    needs_details: "Needs details",
    waiting_purchase: "Waiting for purchase",
    purchasing: "Purchasing",
    seller_shipped: "Seller shipped",
    arrived: "Arrived at warehouse",
    qc_ready: "QC photos ready",
    approved: "QC approved",
    ready_to_ship: "Ready to ship",
    parcel_submitted: "In parcel",
    shipping_due: "Shipping due",
    payment_pending: "Payment pending",
    paid: "Shipping paid",
    processing: "Processing",
    dispatched: "Dispatched",
    in_transit: "In transit",
    tracking_pending: "Tracking pending",
    delivered: "Delivered",
    cancelled: "Cancelled",
    extra_photo_requested: "Extra photo requested",
    locked: "Locked",
    revoked: "Revoked",
    expired: "Expired",
    available: "Available",
    used: "Used"
  };
  return labels[status] || status;
}

function statusClass(status) {
  if (["ready_to_ship", "approved", "paid", "available", "dispatched", "in_transit", "delivered"].includes(status)) return "good";
  if (["needs_details", "qc_ready", "extra_photo_requested", "shipping_due", "payment_pending", "processing", "tracking_pending", "locked"].includes(status)) return "warn";
  if (["expired", "cancelled", "failed"].includes(status)) return "bad";
  return "";
}

async function apiRequest(path, options = {}) {
  const baseUrl = apiState.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      "x-device-id": deviceId,
      ...(options.version ? { "if-match": `"${options.version}"` } : {}),
      ...(apiState.accessToken && !options.anonymous ? { authorization: `Bearer ${apiState.accessToken}` } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.error?.message || `API request failed with ${response.status}`;
    if (response.status === 401 && !options.noRefresh && apiState.refreshToken && path !== "/auth/refresh") {
      const refreshed = await refreshApiSession();
      if (refreshed) return apiRequest(path, { ...options, noRefresh: true });
    }
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.details = payload?.error?.details;
    throw error;
  }
  return payload;
}

async function refreshApiSession() {
  try {
    const payload = await apiRequest("/auth/refresh", {
      method: "POST", body: { refresh_token: apiState.refreshToken }, anonymous: true, noRefresh: true
    });
    applySession(payload);
    return true;
  } catch {
    clearApiSession();
    return false;
  }
}

function applySession(payload) {
  apiState.accessToken = payload.session.access_token;
  apiState.refreshToken = payload.session.refresh_token;
  apiState.userEmail = payload.user.email;
  apiState.connected = true;
  apiState.error = "";
  saveApiState();
}

function clearApiSession() {
  apiState.accessToken = "";
  apiState.refreshToken = "";
  apiState.connected = false;
  saveApiState();
}

async function connectApiAccount(mode, formData) {
  apiState.loading = true;
  apiState.error = "";
  authFlow.loading = true;
  authFlow.error = "";
  saveApiState();
  render();

  try {
    const payload = await apiRequest(mode === "register" ? "/auth/register" : "/auth/login", {
      method: "POST", anonymous: true, noRefresh: true,
      body: {
        email: formData.get("email"),
        password: formData.get("password"),
        display_name: formData.get("display_name") || undefined,
        device_label: navigator.platform || "Browser"
      }
    });
    authFlow.email = String(formData.get("email") || "");
    authFlow.password = String(formData.get("password") || "");
    authFlow.verificationToken = payload.verification_token || "";
    authFlow.resendAvailableAt = Date.now() + 60000;
    if (mode === "register") {
      route("verifyEmail");
    } else if (payload.device_verification_required) {
      route("verifyDevice");
    } else {
      applySession(payload);
      await finishAuthentication();
    }
  } catch (error) {
    apiState.connected = false;
    apiState.error = error.message;
    authFlow.error = error.message;
    saveApiState();
    render();
  } finally {
    apiState.loading = false;
    authFlow.loading = false;
    saveApiState();
    render();
  }
}

async function disconnectApiAccount() {
  if (hasApiSession()) {
    try { await apiRequest("/auth/logout", { method: "POST", body: {}, noRefresh: true }); } catch { /* Local sign-out still succeeds. */ }
  }
  apiState = defaultApiState();
  saveApiState();
  accountState = { account: null, addresses: [], loading: false, loaded: false, error: "", editingAddressId: "" };
  state.links = [];
  state.items = [];
  state.qcItems = [];
  state.orders = [];
  state.parcels = [];
  state.shippingLines = [];
  state.wallet = defaultState().wallet;
  state.coupons = [];
  state.policies = [];
  saveState();
  route("login");
}

async function finishAuthentication() {
  authFlow = { email: "", password: "", verificationToken: "", resendAvailableAt: 0, loading: false, error: "" };
  accountState.loaded = false;
  await syncWorkspaceFromApi(false);
  const destination = PROTECTED_VIEWS.has(returnView) ? returnView : "account";
  returnView = "dashboard";
  route(destination);
  setToast("Account connected securely.");
}

async function verifyAuthFlow(kind, formData) {
  authFlow.loading = true;
  authFlow.error = "";
  render();
  try {
    const payload = await apiRequest(kind === "email" ? "/auth/verify-email" : "/auth/verify-device", {
      method: "POST", anonymous: true, noRefresh: true,
      body: { token: formData.get("token"), device_label: navigator.platform || "Browser" }
    });
    if (kind === "email") {
      setToast("Email verified. You can sign in now.");
      authFlow.verificationToken = "";
      route("login");
    } else {
      applySession(payload);
      await finishAuthentication();
    }
  } catch (error) {
    authFlow.error = error.message;
    render();
  } finally {
    authFlow.loading = false;
    render();
  }
}

async function resendVerification(kind) {
  if (Date.now() < authFlow.resendAvailableAt) return;
  authFlow.loading = true;
  authFlow.error = "";
  render();
  try {
    if (kind === "email") {
      const payload = await apiRequest("/auth/resend-verification", {
        method: "POST", anonymous: true, noRefresh: true, body: { email: authFlow.email }
      });
      authFlow.verificationToken = payload.verification_token || "";
    } else {
      if (!authFlow.password) throw new Error("Return to sign in to send another device code.");
      const payload = await apiRequest("/auth/login", {
        method: "POST", anonymous: true, noRefresh: true,
        body: { email: authFlow.email, password: authFlow.password, device_label: navigator.platform || "Browser" }
      });
      authFlow.verificationToken = payload.verification_token || "";
    }
    authFlow.resendAvailableAt = Date.now() + 60000;
    setToast("Verification email sent.");
  } catch (error) {
    authFlow.error = error.message;
  } finally {
    authFlow.loading = false;
    render();
  }
}

async function syncWorkspaceFromApi(showToastOnSuccess = true) {
  if (!hasApiSession()) {
    apiState.error = "Connect a client API account before loading workspace data.";
    saveApiState();
    render();
    return;
  }

  apiState.loading = true;
  apiState.error = "";
  saveApiState();
  render();

  try {
    const [links, items, orders, policies, qc, parcels, shippingLines, wallet] = await Promise.all([
      apiRequest("/links"),
      apiRequest("/haul-items"),
      apiRequest("/orders"),
      apiRequest("/policies"),
      apiRequest("/qc/items"),
      apiRequest("/parcels"),
      apiRequest("/shipping-lines"),
      apiRequest("/wallet")
    ]);
    const mappedItems = items.items.map(mapApiItem);
    const itemsById = new Map(mappedItems.map((item) => [item.id, item]));
    const mappedQcItems = (qc.items || []).map((entry) => mapApiQcItem(
      entry,
      itemsById.get(entry.warehouse_item?.haul_item_id)
    ));
    const qcByHaulId = new Map(mappedQcItems.map((item) => [item.id, item]));
    state.links = links.links.map(mapApiLink);
    state.items = mappedItems.map((item) => {
      const qcItem = qcByHaulId.get(item.id);
      if (!qcItem) return item;
      return {
        ...item,
        ...qcItem,
        linkId: item.linkId || qcItem.linkId,
        title: item.title || qcItem.title,
        spec: item.spec || qcItem.spec,
        price: item.price || qcItem.price,
        quantity: item.quantity || qcItem.quantity,
        note: item.note || qcItem.note,
        source: item.source || qcItem.source,
        domain: item.domain || qcItem.domain,
        createdAt: item.createdAt || qcItem.createdAt
      };
    });
    const syncedItemIds = new Set(state.items.map((item) => item.id));
    state.items.push(...mappedQcItems.filter((item) => !syncedItemIds.has(item.id)));
    state.qcItems = mappedQcItems;
    state.orders = orders.orders.map(mapApiOrder);
    state.parcels = (parcels.parcels || []).map(mapApiParcel);
    state.shippingLines = (shippingLines.lines || []).map(mapApiShippingLine);
    state.wallet = mapApiWallet(wallet);
    state.coupons = (wallet.coupons || []).map(mapApiUserCoupon);
    state.policies = policies.policies || [];
    apiState.connected = true;
    apiState.error = "";
    saveState();
    saveApiState();
    if (showToastOnSuccess) setToast("Workspace synced from API.");
  } catch (error) {
    apiState.connected = false;
    apiState.error = error.message;
    saveApiState();
    render();
  } finally {
    apiState.loading = false;
    saveApiState();
    render();
  }
}

function requireApiSession() {
  if (!hasApiSession()) {
    throw new Error("Connect a client API account before using this workflow.");
  }
}

function mapApiLink(link) {
  return {
    id: link.id,
    url: link.url,
    domain: link.domain,
    platform: link.platform,
    status: link.status,
    title: link.title || "",
    price: link.price || "",
    spec: link.spec || "",
    quantity: link.quantity || 1,
    note: link.note || "",
    parseError: link.parse_error || "",
    createdAt: link.created_at ? new Date(link.created_at).toLocaleString() : nowLabel()
  };
}

function mapApiItem(item) {
  return {
    id: item.id,
    linkId: item.saved_link_id,
    title: item.title,
    spec: item.spec,
    price: item.price,
    quantity: item.quantity,
    note: item.note || "",
    source: item.source_platform,
    domain: item.source_domain,
    status: item.status,
    qcStatus: "pending",
    weight: "",
    createdAt: item.created_at ? new Date(item.created_at).toLocaleString() : nowLabel()
  };
}

function mapApiOrder(order) {
  return {
    id: order.id,
    itemId: order.haul_item_id,
    status: order.status === "submitted" ? "purchasing" : order.status,
    exception: order.exception || "",
    createdAt: order.created_at ? new Date(order.created_at).toLocaleString() : nowLabel(),
    updatedAt: order.updated_at ? new Date(order.updated_at).toLocaleString() : nowLabel(),
    history: order.history || []
  };
}

function mapApiQcItem(entry, baseItem = {}) {
  const warehouseItem = entry.warehouse_item || {};
  const photos = (entry.photos || []).map(mapApiQcPhoto);
  const weight = warehouseItem.weight_kg || (warehouseItem.weight_grams ? warehouseItem.weight_grams / 1000 : "");
  const lockedShippingStatus = ["parcel_submitted", "shipping_due", "payment_pending", "paid", "processing", "dispatched", "in_transit", "delivered"].includes(baseItem.status);
  const status = lockedShippingStatus
    ? baseItem.status
    : warehouseItem.status === "ready_to_ship"
      ? "ready_to_ship"
      : "qc_ready";
  const qcStatus = warehouseItem.status === "ready_to_ship"
    ? "approved"
    : warehouseItem.status === "extra_photo_requested"
      ? "extra_photo_requested"
      : photos.length
        ? "ready"
        : "pending";

  return {
    id: warehouseItem.haul_item_id || warehouseItem.id,
    warehouseItemId: warehouseItem.id,
    linkId: baseItem.linkId || "",
    title: baseItem.title || `Warehouse item ${String(warehouseItem.id || "").slice(0, 8)}`,
    spec: baseItem.spec || "QC review item",
    price: baseItem.price || 0,
    quantity: baseItem.quantity || 1,
    note: baseItem.note || "",
    source: baseItem.source || "Warehouse",
    domain: baseItem.domain || "GOATEDBUY",
    status,
    qcStatus,
    weight: weight ? Number(weight).toFixed(2).replace(/\.?0+$/, "") : "",
    qcPhotos: photos,
    storage: warehouseItem.storage || {},
    receivedAt: warehouseItem.received_at || "",
    createdAt: baseItem.createdAt || (warehouseItem.received_at ? new Date(warehouseItem.received_at).toLocaleString() : nowLabel())
  };
}

function mapApiQcPhoto(photo) {
  return {
    id: photo.id,
    fileName: photo.file_name || "QC photo",
    contentType: photo.content_type || "",
    sizeBytes: photo.size_bytes || 0,
    sortOrder: photo.sort_order || 0,
    signedUrl: photo.signed_url || "",
    createdAt: photo.created_at || ""
  };
}

function mapApiShippingLine(line) {
  return {
    id: line.id,
    code: line.code,
    name: line.name,
    country: line.destination_country,
    status: line.status,
    serviceLevel: line.service_level,
    currency: line.currency,
    deliveryMinDays: line.delivery_min_days,
    deliveryMaxDays: line.delivery_max_days
  };
}

function mapApiParcel(parcel) {
  return {
    id: parcel.id,
    itemIds: (parcel.items || []).map((item) => item.haul_item_id),
    warehouseItemIds: (parcel.items || []).map((item) => item.warehouse_item_id),
    itemCount: (parcel.items || []).length,
    country: parcel.destination_country || "Destination pending",
    lineId: parcel.shipping_line_id || "",
    quoteId: parcel.quote_id || "",
    line: parcel.shipping_line_id || "Line pending",
    estimated: parcel.final_fee || 0,
    finalFee: parcel.final_fee || 0,
    status: parcel.status,
    tracking: parcel.tracking_number || "",
    createdAt: parcel.created_at ? new Date(parcel.created_at).toLocaleString() : nowLabel(),
    paidAt: parcel.paid_at ? new Date(parcel.paid_at).toLocaleString() : "",
    items: parcel.items || []
  };
}

function mapApiWallet(payload) {
  return {
    id: payload.wallet?.id || "",
    balance: payload.wallet?.balance || 0,
    balance_cents: payload.wallet?.balance_cents || 0,
    currency: payload.wallet?.currency || "USD",
    status: payload.wallet?.status || "active",
    transactions: (payload.transactions || []).map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount || 0,
      amount_cents: transaction.amount_cents || 0,
      balanceAfter: transaction.balance_after || 0,
      reason: transaction.reason || "",
      sourceType: transaction.source_type || "",
      createdAt: transaction.created_at ? new Date(transaction.created_at).toLocaleString() : nowLabel()
    }))
  };
}

function mapApiUserCoupon(userCoupon) {
  const coupon = userCoupon.coupon || {};
  const amount = coupon.amount ?? (coupon.amount_cents ? coupon.amount_cents / 100 : 0);
  const lineRule = coupon.eligible_shipping_line_codes?.length
    ? `Applies to ${coupon.eligible_shipping_line_codes.join(", ")}`
    : "Applies to eligible shipping lines.";
  return {
    id: userCoupon.id,
    code: coupon.code || "",
    type: coupon.title || "Shipping coupon",
    amount,
    status: userCoupon.status || "available",
    rule: coupon.discount_type === "percent" ? `${coupon.percent_off}% off · ${lineRule}` : lineRule,
    createdAt: userCoupon.redeemed_at ? new Date(userCoupon.redeemed_at).toLocaleString() : nowLabel(),
    coupon,
    discountCents: userCoupon.discount_cents || 0,
    lockedParcelId: userCoupon.locked_parcel_id || "",
    usedParcelId: userCoupon.used_parcel_id || ""
  };
}

function itemById(id) {
  return state.items.find((item) => item.id === id);
}

function orderByItem(id) {
  return state.orders.find((order) => order.itemId === id);
}

async function createSavedLink(rawUrl, openDraft = true) {
  if (hasApiSession()) {
    const result = await apiRequest("/links", {
      method: "POST",
      body: { url: rawUrl }
    });
    state.draftLinkId = result.link.id;
    await syncWorkspaceFromApi(false);
    if (openDraft) route("links");
    setToast(result.existing ? "Link already exists in Link Intake." : "Link saved to API.");
    return result.link;
  }

  requireApiSession();
  const parsed = normalizeUrl(rawUrl);
  const existing = state.links.find((link) => link.url === parsed.href);
  if (existing) {
    state.draftLinkId = existing.id;
    if (openDraft) route("links");
    setToast("Link already exists in Link Intake.");
    return existing;
  }

  const link = {
    id: uid("link"),
    url: parsed.href,
    domain: parsed.hostname.replace(/^www\./, ""),
    platform: platformFromHost(parsed.hostname),
    status: "needs_details",
    title: "",
    price: "",
    spec: "",
    quantity: 1,
    note: "",
    createdAt: nowLabel()
  };
  state.links.unshift(link);
  state.draftLinkId = link.id;
  saveState();
  if (openDraft) route("links");
  setToast("Link saved. Add item details to build your haul.");
  return link;
}

async function addLinkToHaul(linkId, formData) {
  const link = state.links.find((entry) => entry.id === linkId);
  if (!link) return;

  const title = formData.get("title").trim();
  const spec = formData.get("spec").trim();
  const price = Number(formData.get("price"));
  const quantity = Number(formData.get("quantity"));
  const note = formData.get("note").trim();

  if (!title || !spec || !price || price <= 0 || !quantity || quantity <= 0) {
    setToast("Title, spec, price, and quantity are required before adding to My Haul.");
    return;
  }

  if (hasApiSession()) {
    await apiRequest(`/links/${linkId}`, {
      method: "PATCH",
      body: { title, spec, price, quantity, note }
    });
    const result = await apiRequest(`/links/${linkId}/add-to-haul`, {
      method: "POST"
    });
    await syncWorkspaceFromApi(false);
    route("haul");
    setToast(result.existing ? "Item already exists in My Haul." : "Item added to My Haul via API.");
    return;
  }

  requireApiSession();
  const item = {
    id: uid("item"),
    linkId,
    title,
    spec,
    price,
    quantity,
    note,
    source: link.platform,
    domain: link.domain,
    status: "waiting_purchase",
    qcStatus: "pending",
    weight: "",
    createdAt: nowLabel()
  };

  link.title = title;
  link.price = price;
  link.spec = spec;
  link.quantity = quantity;
  link.note = note;
  link.status = "added_to_haul";
  state.items.unshift(item);
  state.draftLinkId = null;
  saveState();
  route("haul");
  setToast("Item added to My Haul.");
}

async function submitPurchase(itemId) {
  if (hasApiSession()) {
    const result = await apiRequest("/purchase-orders", {
      method: "POST",
      body: { haul_item_id: itemId }
    });
    await syncWorkspaceFromApi(false);
    render();
    setToast(result.existing ? "Purchase order already exists." : "Purchase order submitted via API.");
    return;
  }

  requireApiSession();
  const item = itemById(itemId);
  if (!item || orderByItem(itemId)) return;
  item.status = "purchasing";
  state.orders.unshift({
    id: uid("order"),
    itemId,
    status: "purchasing",
    exception: "",
    createdAt: nowLabel(),
    updatedAt: nowLabel()
  });
  saveState();
  render();
  setToast("Purchase order submitted.");
}

function advanceOrder(orderId) {
  const order = state.orders.find((entry) => entry.id === orderId);
  if (!order) return;
  const item = itemById(order.itemId);
  const flow = ["purchasing", "seller_shipped", "arrived", "qc_ready"];
  const next = flow[flow.indexOf(order.status) + 1];
  if (!next) return;
  order.status = next;
  order.updatedAt = nowLabel();
  if (item) {
    item.status = next;
    if (next === "qc_ready") item.qcStatus = "ready";
  }
  saveState();
  render();
  setToast(`Order updated to ${statusLabel(next)}.`);
}

function markOrderException(orderId, type) {
  const order = state.orders.find((entry) => entry.id === orderId);
  if (!order) return;
  order.exception = type;
  order.updatedAt = nowLabel();
  saveState();
  render();
}

async function approveQc(itemId, weight) {
  const item = itemById(itemId);
  if (!item) return;
  if (hasApiSession() && item.warehouseItemId) {
    if (!item.qcPhotos?.length) {
      setToast("QC photos are not uploaded yet.");
      return;
    }
    if (!item.weight) {
      setToast("Warehouse weight is required before approving QC.");
      return;
    }
    await apiRequest(`/qc/items/${item.warehouseItemId}/approve`, { method: "POST" });
    await syncWorkspaceFromApi(false);
    render();
    setToast("QC approved. Item is ready to ship.");
    return;
  }

  requireApiSession();
  const parsedWeight = Number(weight);
  if (!parsedWeight || parsedWeight <= 0) {
    setToast("Add warehouse weight before approving QC for shipping.");
    return;
  }
  item.weight = parsedWeight;
  item.qcStatus = "approved";
  item.status = "ready_to_ship";
  saveState();
  render();
  setToast("QC approved. Item is ready to ship.");
}

async function requestExtraPhoto(itemId) {
  const item = itemById(itemId);
  if (!item) return;
  if (hasApiSession() && item.warehouseItemId) {
    await apiRequest(`/qc/items/${item.warehouseItemId}/extra-photo`, {
      method: "POST",
      body: { reason: "User requested one more QC detail photo from the client workspace." }
    });
    await syncWorkspaceFromApi(false);
    render();
    setToast("Extra photo request sent to warehouse.");
    return;
  }

  requireApiSession();
  item.qcStatus = "extra_photo_requested";
  saveState();
  render();
  setToast("Extra photo request recorded.");
}

async function addCoupon(code) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    setToast("Enter a coupon or creator code.");
    return;
  }
  if (hasApiSession()) {
    await apiRequest("/coupons/redeem-code", {
      method: "POST",
      body: { code: normalized }
    });
    await syncWorkspaceFromApi(false);
    render();
    setToast("Coupon redeemed.");
    return;
  }

  requireApiSession();
  if (state.coupons.some((coupon) => coupon.code === normalized && coupon.status === "available")) {
    setToast("This code is already available in Wallet.");
    return;
  }
  state.coupons.unshift({
    id: uid("coupon"),
    code: normalized,
    type: "Shipping coupon",
    amount: 8,
    status: "available",
    rule: "Applies to eligible shipping lines.",
    createdAt: nowLabel()
  });
  saveState();
  render();
  setToast("Code added to Wallet.");
}

async function claimWelcomeGift() {
  if (hasApiSession()) {
    const result = await apiRequest("/welcome-gift/claim", { method: "POST" });
    await syncWorkspaceFromApi(false);
    render();
    setToast(result.existing ? "Welcome Gift already claimed." : "Welcome Gift claimed.");
    return;
  }

  await addCoupon("WELCOME10");
}

function estimateShipping(items, line) {
  const weight = items.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const multipliers = {
    "Balanced Air": 12,
    "Economy Line": 8,
    "Express Line": 18
  };
  const base = line === "Express Line" ? 18 : 12;
  return Math.max(base, weight * (multipliers[line] || 12) + base);
}

function selectedReadyItems(formData) {
  const selectedIds = formData.getAll("item").filter(Boolean);
  const items = selectedIds.map(itemById).filter(Boolean);
  if (!items.length) {
    setToast("Select at least one ready to ship item.");
    return [];
  }
  if (items.some((item) => item.status !== "ready_to_ship" || !item.weight)) {
    setToast("Only ready to ship items with warehouse weight can be submitted.");
    return [];
  }
  return items;
}

function addressFromForm(formData, country) {
  return {
    recipient_name: formData.get("recipientName"),
    line1: formData.get("addressLine1"),
    city: formData.get("city"),
    region: formData.get("region"),
    postal_code: formData.get("postalCode"),
    country,
    phone: formData.get("phone")
  };
}

async function submitParcel(formData) {
  const items = selectedReadyItems(formData);
  if (!items.length) return;
  const country = formData.get("country");
  const line = formData.get("line");

  if (hasApiSession()) {
    const warehouseItemIds = items.map((item) => item.warehouseItemId).filter(Boolean);
    if (warehouseItemIds.length !== items.length) {
      setToast("Warehouse item ids are missing. Sync once before submitting a parcel.");
      return;
    }
    const draft = await apiRequest("/parcels/draft", {
      method: "POST",
      body: { warehouse_item_ids: warehouseItemIds }
    });
    const preview = await apiRequest("/shipping/preview", {
      method: "POST",
      body: {
        parcel_id: draft.parcel.id,
        country,
        dimensions_cm: {
          length_cm: Number(formData.get("lengthCm") || 0) || undefined,
          width_cm: Number(formData.get("widthCm") || 0) || undefined,
          height_cm: Number(formData.get("heightCm") || 0) || undefined
        }
      }
    });
    const quote = preview.quotes.find((entry) => entry.available && (entry.line.code === line || entry.line.name === line));
    if (!quote) {
      const unavailable = preview.quotes.find((entry) => entry.line.code === line || entry.line.name === line);
      const reason = unavailable?.reasons?.[0]?.message || "Selected shipping line is unavailable. Retry with another line.";
      setToast(reason);
      return;
    }
    const submitted = await apiRequest("/parcels", {
      method: "POST",
      body: {
        parcel_id: draft.parcel.id,
        quote_id: quote.quote_id,
        address: addressFromForm(formData, country)
      }
    });
    const couponId = formData.get("coupon");
    if (couponId) {
      try {
        await apiRequest("/checkout/apply-coupon", {
          method: "POST",
          body: {
            parcel_id: submitted.parcel.id,
            user_coupon_id: couponId
          }
        });
      } catch (error) {
        await syncWorkspaceFromApi(false);
        render();
        setToast(error.message);
        return;
      }
    }
    state.shippingCountry = country;
    state.selectedLine = line;
    await syncWorkspaceFromApi(false);
    render();
    setToast(couponId ? "Parcel submitted and coupon locked." : "Parcel submitted with a fresh shipping quote.");
    return;
  }

  requireApiSession();
  const selectedIds = items.map((item) => item.id);
  const couponId = formData.get("coupon");
  const coupon = state.coupons.find((entry) => entry.id === couponId && entry.status === "available");
  const estimated = estimateShipping(items, line);
  const discount = coupon ? coupon.amount : 0;
  const finalFee = Math.max(0, estimated - discount);

  const parcel = {
    id: uid("parcel"),
    itemIds: selectedIds,
    country,
    line,
    estimated,
    finalFee,
    couponId: coupon?.id || "",
    status: "shipping_due",
    tracking: "",
    createdAt: nowLabel()
  };
  state.parcels.unshift(parcel);
  items.forEach((item) => {
    item.status = "parcel_submitted";
  });
  if (coupon) coupon.status = "used";
  state.shippingCountry = country;
  state.selectedLine = line;
  saveState();
  render();
  setToast("Parcel submitted. Final shipping is ready for payment.");
}

async function payParcel(parcelId) {
  if (hasApiSession()) {
    await apiRequest("/shipping-payments", {
      method: "POST",
      body: {
        parcel_id: parcelId,
        idempotency_key: `client-${parcelId}-${Date.now()}`
      }
    });
    await syncWorkspaceFromApi(false);
    render();
    setToast("Shipping payment intent created. Waiting for payment confirmation.");
    return;
  }

  requireApiSession();
  const parcel = state.parcels.find((entry) => entry.id === parcelId);
  if (!parcel) return;
  parcel.status = "tracking_pending";
  parcel.tracking = "";
  parcel.paidAt = nowLabel();
  parcel.itemIds.forEach((id) => {
    const item = itemById(id);
    if (item) item.status = "tracking_pending";
  });
  saveState();
  render();
  setToast("Shipping paid. Tracking will appear after dispatch.");
}

async function refreshTracking(parcelId) {
  requireApiSession();
  const result = await apiRequest(`/parcels/${parcelId}/tracking`);
  const parcel = state.parcels.find((entry) => entry.id === parcelId);
  if (parcel) {
    parcel.tracking = result.tracking.tracking_number || "";
    parcel.trackingStatus = result.tracking.status;
    parcel.trackingEvents = result.tracking.events || [];
    saveState();
    render();
  }
  setToast(result.tracking.tracking_number ? `Tracking: ${result.tracking.tracking_number}` : "Tracking is pending.");
}

function resetWorkspace() {
  if (!confirm("Clear local workspace data?")) return;
  state = defaultState();
  saveState();
  route("dashboard");
}

function counts() {
  return {
    links: state.links.filter((link) => link.status !== "added_to_haul").length,
    haul: state.items.length,
    orders: state.orders.length,
    qc: state.items.filter((item) => item.status === "qc_ready" || item.qcStatus === "extra_photo_requested").length,
    shipping: state.items.filter((item) => item.status === "ready_to_ship").length,
    parcels: state.parcels.length,
    coupons: state.coupons.filter((coupon) => coupon.status === "available").length
  };
}

function renderNav() {
  const c = counts();
  const countMap = {
    links: c.links,
    haul: c.haul,
    orders: c.orders,
    qc: c.qc,
    shipping: c.shipping,
    wallet: c.coupons
  };
  nav.innerHTML = navItems.map(([id, labelKey, icon]) => `
    <button class="${id === currentView ? "active" : ""}" data-route="${id}">
      <i data-lucide="${icon}" aria-hidden="true"></i>
      <span class="nav-label">${i18n.t(labelKey)}</span>
      ${countMap[id] ? `<span class="count">${countMap[id]}</span>` : ""}
    </button>
  `).join("");
  nav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => route(button.dataset.route));
  });
}

function route(id, options = {}) {
  let destination = ROUTE_PATHS[id] ? id : "dashboard";
  if (PROTECTED_VIEWS.has(destination) && !hasApiSession()) {
    returnView = destination;
    destination = "login";
  }
  currentView = destination;
  const hash = `#${ROUTE_PATHS[destination]}`;
  if (location.hash !== hash) {
    if (options.replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  render();
  if (!options.noScroll) window.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
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

function itemCard(item, extra = "") {
  return `
    <article class="card item-card">
      <div class="item-visual">Item<br>photo<br>pending</div>
      <div class="item-main">
        <div class="card-head">
          <div>
            <div class="item-title">${escapeHtml(item.title)}</div>
            <p class="subtle">${escapeHtml(item.spec)} · Qty ${item.quantity} · ${money(item.price)} · ${escapeHtml(item.source)}</p>
          </div>
          <span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span>
        </div>
        <div class="item-meta">
          <span class="chip">${escapeHtml(item.domain)}</span>
          ${item.weight ? `<span class="chip">${item.weight} kg</span>` : ""}
          <span class="chip">${escapeHtml(item.createdAt)}</span>
        </div>
        ${extra}
      </div>
    </article>
  `;
}

function renderDashboard() {
  const c = counts();
  // Real next-step, derived from the user's own data (no fabrication).
  const next = c.parcels > 0
    ? { copy: "Track your parcel across 700+ routes.", cta: "Open shipping", view: "shipping" }
    : c.haul > 0
      ? { copy: "Combine arrived items into one smart parcel.", cta: "Build parcel", view: "shipping" }
      : c.orders > 0
        ? { copy: "Review QC photos and approve your items.", cta: "Open QC", view: "qc" }
        : c.links > 0
          ? { copy: "Turn a saved link into an order.", cta: "Open links", view: "links" }
          : { copy: "Paste your first product link to start a haul.", cta: "Start an order", view: "links" };
  return `
    <div class="dl-v2 dash-v2">
      <!-- 01 HERO (full-bleed, image background) -->
      <section class="hero-full" style="background-image:url('./assets/gb-hero-warehouse.png')">
        <div class="wrap hero-full-inner">
          <div class="hero-full-copy" data-reveal>
            <h1><em>GOATED</em> BUY.</h1>
            <p class="sub">China at Your Fingertips,<br>Worldwide Delivery.</p>
            <form class="hero-search" data-action="paste">
              <i class="lk" data-lucide="link-2" aria-hidden="true"></i>
              <input name="url" type="url" placeholder="Enter Taobao, 1688, or Micro link" aria-label="Item link">
              <div class="chips" aria-hidden="true"><span>店</span><span>微</span><span>淘</span></div>
              <button class="btn-search" type="submit"><i data-lucide="search" aria-hidden="true"></i>Search</button>
            </form>
            <div class="hero-steps">
              <div class="st"><span class="num">1</span><b>Place orders</b><small>Paste an item link to submit an order</small></div>
              <div class="st"><span class="num">2</span><b>QC &amp; storage</b><small>3–5 free QC photos &amp; 90 free storage</small></div>
              <div class="st"><span class="num">3</span><b>Submit parcels</b><small>Bundle packaging &amp; check the parcel</small></div>
              <div class="st"><span class="num">4</span><b>INTL ship</b><small>Cheaper line with 150+ shipping lines</small></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 02 PROOF ribbon -->
      <section class="proof"><div class="wrap in">
        <div class="p"><b>3–5</b><span>QC photos before you ship</span></div>
        <div class="p"><b>90 days</b><span>free warehouse storage</span></div>
        <div class="p"><b>700+</b><span>routes to 220+ countries</span></div>
        <div class="p"><b>1 parcel</b><span>from many separate orders</span></div>
      </div></section>

      <!-- 03 JOURNEY spine (climax) -->
      <section class="section"><div class="wrap">
        <div class="section-head" data-reveal>
          <span class="eyebrow">China to your doorstep</span>
          <h2>One journey. Seven clear moves.</h2>
          <p>Not a pile of steps — a single parcel moving through one system. Follow it from source to delivery.</p>
        </div>
        <div class="spine-scroll" data-reveal>
          <svg class="spine" viewBox="0 0 960 180" aria-label="Journey route">
            <path id="spineTrack" d=""></path><path id="spineProg" d=""></path>
            <g id="spineNodes"></g>
            <g id="spineParcel" opacity="0">
              <ellipse cx="0" cy="22" rx="14" ry="4" fill="rgba(23,25,29,.14)"></ellipse>
              <path d="M0,-11 L15,-4 L0,3 L-15,-4 Z" fill="#F7B0A6"></path>
              <path d="M-15,-4 L0,3 L0,18 L-15,11 Z" fill="#F0503D"></path>
              <path d="M15,-4 L0,3 L0,18 L15,11 Z" fill="#C7361F"></path>
              <path d="M0,-11 L0,3 M0,3 L0,18" stroke="#FBFAF8" stroke-width="2" stroke-linecap="round"></path>
            </g>
          </svg>
          <div class="spine-details" id="spineDetails"></div>
        </div>
      </div></section>

      <!-- 04 FEATURES bento -->
      <section class="section"><div class="wrap">
        <div class="section-head" data-reveal><span class="eyebrow">From checkout to doorstep</span><h2>Everything your haul needs</h2><p>Clear checkpoints, visible costs, and control at every stage.</p></div>
        <div class="bento" data-reveal>
          <div class="cell card-primary b-buy">
            <div><span class="tagi">Buy</span><h3 style="margin-top:8px">Paste it. We purchase it.</h3><p class="lead">Drop any China-marketplace link. A dedicated agent buys it for you and routes it to our warehouse — no China account needed.</p></div>
            <button class="btn btn-ghost" type="button" data-route-button="links" style="align-self:flex-start">Submit a link <i data-lucide="arrow-up-right" aria-hidden="true"></i></button>
          </div>
          <div class="cell card-secondary b-qc">
            <div><span class="tagi">Check</span><h3 style="margin-top:8px">See it first.</h3><p class="lead">3–5 QC photos per item.</p>
              <button class="btn btn-ghost" type="button" data-route-button="qc" style="margin-top:10px">Open QC Center <i data-lucide="arrow-up-right" aria-hidden="true"></i></button></div>
            <div class="qc-mosaic">
              <div class="qc-shot"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="var(--c-ship)" stroke-width="1.8"/></svg></div>
              <div class="qc-shot"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="none" stroke="var(--c-air)" stroke-width="1.8"/></svg></div>
              <div class="qc-shot"><svg viewBox="0 0 24 24"><path d="M12 5l7 13H5z" fill="none" stroke="var(--c-amber)" stroke-width="1.8" stroke-linejoin="round"/></svg></div>
              <div class="qc-shot ok"><span class="qc-badge">✓</span><svg viewBox="0 0 24 24"><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--c-success)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            </div>
          </div>
          <div class="cell card-secondary b-ship">
            <div><span class="tagi">Ship</span><h3 style="margin-top:8px">One smart parcel.</h3><p class="lead">Combine many orders; pick the best of 700+ routes.</p></div>
            <button class="btn btn-ghost" type="button" data-route-button="shipping" style="align-self:flex-start">Plan shipping <i data-lucide="arrow-up-right" aria-hidden="true"></i></button>
          </div>
          <div class="cell b-stat">
            <div><div class="big">700+</div><span>shipping routes</span></div>
            <div><div class="big a">220+</div><span>countries &amp; regions</span></div>
          </div>
        </div>
      </div></section>

      <!-- 05 WORKSPACE dashboard (dark, real data) -->
      <section class="section work"><div class="wrap">
        <div class="section-head" data-reveal><span class="eyebrow" style="color:#FF8A7A">Your workspace</span><h2 style="color:#fff">Every order, one clear board</h2><p style="color:#AEB6BF">Not a screenshot — a real control surface for your whole haul.</p></div>
        <div class="dash" data-reveal>
          <div class="dh"><b>Workspace overview</b><span class="inline-chip plain" style="background:#181B20;color:#8A929B">synced just now</span></div>
          <div class="tiles">
            <div class="tile"><div class="t">Saved links</div><div class="v">${c.links}</div><span class="pill b">ready to order</span></div>
            <div class="tile"><div class="t">Haul items</div><div class="v">${c.haul}</div><span class="pill g">in warehouse</span></div>
            <div class="tile"><div class="t">Orders</div><div class="v">${c.orders}</div><span class="pill a">tracked</span></div>
            <div class="tile"><div class="t">Parcels</div><div class="v">${c.parcels}</div><span class="pill b">international</span></div>
          </div>
          <div class="next-strip">
            <div class="ico"><i data-lucide="arrow-right" aria-hidden="true"></i></div>
            <div><h4>Next step</h4><p>${next.copy}</p></div>
            <button class="btn btn-primary" type="button" data-route-button="${next.view}">${next.cta}</button>
          </div>
        </div>
      </div></section>

      <!-- 06 TRUST -->
      <section class="section"><div class="wrap">
        <div class="section-head" data-reveal><span class="eyebrow">Buyer protection</span><h2>What's protected, said plainly</h2></div>
        <div class="trust-grid" data-reveal>
          <div class="card-secondary"><h3>Transparent fees</h3><p>Service fee shown up front; international shipping billed at real cost. No hidden markup on goods.</p></div>
          <div class="card-secondary"><h3>QC before shipping</h3><p>Every item is inspected and photographed on arrival. Defects are reported before you pay to ship.</p></div>
          <div class="card-secondary"><h3>90 days free storage</h3><p>Consolidate at your pace. Storage is free for 90 days; nothing ships until you approve it.</p></div>
          <div class="card-secondary"><h3>Refunds &amp; returns</h3><p>Out of stock or price changed? Cancel the affected sub-order; siblings keep moving. Refunds to wallet.</p></div>
          <div class="card-secondary"><h3>Private by default</h3><p>Your account data stays behind your session. New devices require email confirmation.</p></div>
          <div class="card-secondary"><h3>Real tracking</h3><p>Live logistics status from warehouse to doorstep across 700+ routes — one place to watch it all.</p></div>
        </div>
      </div></section>

      <!-- 06b COMMUNITY (restored entry) -->
      <section class="section" style="padding-top:0"><div class="wrap">
        <div class="card-primary" data-reveal style="display:flex;align-items:center;justify-content:space-between;gap:var(--s-5);flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:16px">
            <div style="width:46px;height:46px;border-radius:13px;background:var(--c-coral-wash);color:var(--c-coral-deep);display:grid;place-items:center;flex:none"><i data-lucide="messages-square" aria-hidden="true"></i></div>
            <div><span class="eyebrow">GoatedBuy community</span><h3 style="margin:3px 0 0;font-size:var(--t-h3)">First haul questions are welcome</h3><p class="muted" style="margin:4px 0 0;font-size:14px">Talk through QC details, shipping routes, and parcel planning with other buyers.</p></div>
          </div>
          <button class="btn btn-primary" type="button" data-route-button="community">Explore community <i data-lucide="arrow-right" aria-hidden="true"></i></button>
        </div>
      </div></section>

      <!-- brand lockup (full logo) -->
      <section class="section" style="padding:var(--s-6) 0"><div class="wrap" style="text-align:center">
        <img class="brand-full" src="./assets/gb-logo-full.jpg" alt="GOATEDBUY" loading="lazy" data-reveal>
      </div></section>

      <!-- 07 CTA -->
      <section class="cta"><div class="in">
        <h2 data-reveal>Keep the next move obvious.</h2>
        <p data-reveal>New buyers get a welcome coupon and 90 days of free storage. Paste a link and we'll take it from there.</p>
        <form class="paste" data-action="paste" data-reveal style="max-width:520px">
          <input name="url" type="url" placeholder="Paste your product link" aria-label="Item link">
          <button class="btn btn-inverse" type="submit">Start order</button>
        </form>
      </div></section>
    </div>
  `;
}

function renderGuide() {
  return `
    <div class="dl-v2 guide-v2">
      <!-- The journey spine IS the guide: how a parcel travels, source to doorstep -->
      <section><div class="wrap">
        <div class="section-head left" data-reveal>
          <span class="eyebrow">New user guide</span>
          <h2>How your parcel travels</h2>
          <p>From a pasted link in China to your doorstep — one parcel, seven clear moves. Nothing ships until you approve it.</p>
        </div>
        <div class="spine-scroll" data-reveal>
          <svg class="spine" viewBox="0 0 960 180" aria-label="Journey route">
            <path id="spineTrack" d=""></path><path id="spineProg" d=""></path>
            <g id="spineNodes"></g>
            <g id="spineParcel" opacity="0">
              <ellipse cx="0" cy="22" rx="14" ry="4" fill="rgba(23,25,29,.14)"></ellipse>
              <path d="M0,-11 L15,-4 L0,3 L-15,-4 Z" fill="#F7B0A6"></path>
              <path d="M-15,-4 L0,3 L0,18 L-15,11 Z" fill="#F0503D"></path>
              <path d="M15,-4 L0,3 L0,18 L15,11 Z" fill="#C7361F"></path>
              <path d="M0,-11 L0,3 M0,3 L0,18" stroke="#FBFAF8" stroke-width="2" stroke-linecap="round"></path>
            </g>
          </svg>
          <div class="spine-details" id="spineDetails"></div>
        </div>
      </div></section>

      <section class="section"><div class="wrap">
        <div class="two-up">
          <div class="card-primary">
            <span class="inline-chip">Welcome gift</span>
            <h3 style="margin:12px 0 6px;font-size:var(--t-h3)">WELCOME10</h3>
            <p class="muted" style="margin:0 0 18px">A $8 demo shipping coupon for eligible lines. In production this connects to coupon APIs and eligibility rules.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn btn-primary" type="button" data-welcome-gift><i data-lucide="gift" aria-hidden="true"></i>Claim welcome gift</button>
              <button class="btn btn-ghost" type="button" data-route-button="wallet">Open wallet</button>
            </div>
          </div>
          <div class="card-secondary">
            <h3 style="font-size:16px;display:flex;align-items:center;gap:8px"><i data-lucide="warehouse" aria-hidden="true"></i>90 days free storage</h3>
            <p class="muted" style="font-size:14px;margin-top:10px">Items get 90 days of free warehouse storage after arrival, so you can wait for multiple items and submit one combined parcel. Ready when you are.</p>
          </div>
        </div>
      </div></section>
    </div>
  `;
}

function renderCommunity() {
  return `
    <div class="dl-v2 content-v2">
      <section class="section"><div class="wrap">
        <div class="section-head left" data-reveal>
          <span class="eyebrow">Community</span>
          <h2>Talk it through with other buyers</h2>
          <p>Get first-haul help, QC discussion, and shipping questions — without turning GOATEDBUY into an official finds shelf.</p>
        </div>
        <div class="two-up" data-reveal>
          <div class="card-primary">
            <span class="inline-chip">Discord</span>
            <h3 style="margin:12px 0 6px;font-size:var(--t-h3)">Join the community</h3>
            <p class="muted" style="margin:0 0 18px">first-haul-help, qc-help, shipping-help, haul-reviews, and creator-codes channels.</p>
            <a class="btn btn-primary" href="https://discord.com" target="_blank" rel="noreferrer"><i data-lucide="messages-square" aria-hidden="true"></i>Join Discord</a>
          </div>
          <div class="card-secondary">
            <h3 style="font-size:16px;display:flex;align-items:center;gap:8px"><i data-lucide="send" aria-hidden="true"></i>Telegram<span class="inline-chip plain" style="margin-left:auto">Placeholder</span></h3>
            <p class="muted" style="font-size:14px;margin:10px 0 16px">Quick updates and shipping notices. Production should use the official configured channel.</p>
            <a class="btn btn-ghost" href="https://telegram.org" target="_blank" rel="noreferrer">Open Telegram</a>
          </div>
        </div>
        <div class="trust-grid" data-reveal style="grid-template-columns:1fr 1fr;margin-top:var(--s-5)">
          <div class="card-secondary"><h3>No official finds</h3><p>The client can discuss links, but GOATEDBUY does not officially recommend or endorse products.</p></div>
          <div class="card-secondary"><h3>Workflow first</h3><p>GOATEDBUY focuses on purchasing, warehouse handling, QC photos, consolidation, shipping, and support.</p></div>
        </div>
      </div></section>
    </div>
  `;
}

function nextActionMarkup() {
  const qc = state.items.find((item) => item.status === "qc_ready" || item.qcStatus === "extra_photo_requested");
  if (qc) return `<div class="next-action-icon"><i data-lucide="scan-search" aria-hidden="true"></i></div><div><h3>Review QC photos</h3><p>${escapeHtml(qc.title)} is waiting for your approval.</p></div><button class="primary-button" data-route-button="qc">Open QC Center</button>`;
  const ship = state.items.find((item) => item.status === "ready_to_ship");
  if (ship) return `<div class="next-action-icon"><i data-lucide="package-plus" aria-hidden="true"></i></div><div><h3>Build your parcel</h3><p>At least one item is ready for international shipping.</p></div><button class="primary-button" data-route-button="shipping">Open Shipping</button>`;
  const saved = state.links.find((link) => link.status === "needs_details");
  if (saved) return `<div class="next-action-icon"><i data-lucide="list-plus" aria-hidden="true"></i></div><div><h3>Complete item details</h3><p>${escapeHtml(saved.domain)} needs a title, spec, price, and quantity.</p></div><button class="primary-button" data-route-button="links">Open Link Intake</button>`;
  return `<div class="next-action-icon"><i data-lucide="link-2" aria-hidden="true"></i></div><div><h3>Paste your first item link</h3><p>Start with a product URL from your favorite Chinese marketplace.</p></div><button class="primary-button" data-focus-paste>Paste link</button>`;
}

function renderLinks() {
  const draft = state.links.find((link) => link.id === state.draftLinkId) || state.links.find((link) => link.status !== "added_to_haul");
  return `
    <div class="dl-v2 tx-v2 grid two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Link Intake</h2>
            <p class="subtle">Paste Taobao, 1688, Weidian/Micro, Yupoo, or other Chinese product links to submit a proxy order.</p>
          </div>
        </div>
        <form class="paste-row" data-action="paste">
          <input name="url" type="url" placeholder="Paste Chinese item link" aria-label="Item link">
          <button class="primary-button" type="submit">Parse link</button>
        </form>
        <div class="list" style="margin-top:14px">
          ${state.links.length ? state.links.map((link) => linkCard(link)).join("") : empty("No saved links", "Paste an item link to start your haul.")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Item details</h2>
            <p class="subtle">Parsed links still need user-confirmed title, spec, price, and quantity.</p>
          </div>
        </div>
        ${draft ? detailForm(draft) : empty("Select a link", "Saved links that need details will appear here.")}
      </section>
    </div>
  `;
}

function linkCard(link) {
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${escapeHtml(link.title || link.domain)}</h3>
          <p class="subtle">${escapeHtml(link.url)}</p>
        </div>
        <span class="status ${statusClass(link.status)}">${statusLabel(link.status)}</span>
      </div>
      <div class="item-meta">
        <span class="chip">${escapeHtml(link.platform)}</span>
        <span class="chip">${escapeHtml(link.createdAt)}</span>
      </div>
      <div class="actions">
        ${link.status !== "added_to_haul" ? `<button class="secondary-button" data-edit-link="${link.id}">Edit details</button>` : ""}
        <button class="danger-button" data-delete-link="${link.id}">Delete</button>
      </div>
    </article>
  `;
}

function detailForm(link) {
  return `
    <form data-action="add-to-haul" data-link-id="${link.id}">
      <div class="form-grid">
        <div class="field full">
          <label>Source URL</label>
          <input value="${escapeHtml(link.url)}" disabled>
        </div>
        <div class="field full">
          <label>Item title</label>
          <input name="title" value="${escapeHtml(link.title)}" placeholder="User-confirmed item title">
        </div>
        <div class="field">
          <label>Spec</label>
          <input name="spec" value="${escapeHtml(link.spec)}" placeholder="Size, color, version">
        </div>
        <div class="field">
          <label>Price</label>
          <input name="price" type="number" min="0" step="0.01" value="${escapeHtml(link.price)}" placeholder="0.00">
        </div>
        <div class="field">
          <label>Quantity</label>
          <input name="quantity" type="number" min="1" step="1" value="${escapeHtml(link.quantity || 1)}">
        </div>
        <div class="field">
          <label>Source platform</label>
          <input value="${escapeHtml(link.platform)}" disabled>
        </div>
        <div class="field full">
          <label>Notes</label>
          <textarea name="note" placeholder="Optional buying notes">${escapeHtml(link.note)}</textarea>
        </div>
      </div>
      <div class="actions">
        <button class="primary-button" type="submit">Add to My Haul</button>
      </div>
    </form>
  `;
}

function renderHaul() {
  const groups = [
    ["Waiting for purchase", state.items.filter((item) => item.status === "waiting_purchase")],
    ["In progress", state.items.filter((item) => ["purchasing", "seller_shipped", "arrived"].includes(item.status))],
    ["QC ready", state.items.filter((item) => item.status === "qc_ready")],
    ["Ready to ship", state.items.filter((item) => item.status === "ready_to_ship")],
    ["In parcel", state.items.filter((item) => ["parcel_submitted", "tracking_pending"].includes(item.status))]
  ];

  return `
    <div class="dl-v2 tx-v2 grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>My Haul</h2>
            <p class="subtle">Cart is reframed as a haul workflow with status groups.</p>
          </div>
          <button class="primary-button" data-route-button="links">Paste link</button>
        </div>
        ${state.items.length ? groups.map(([title, items]) => `
          <div class="card" style="margin-top:12px">
            <div class="card-head"><h3>${title}</h3><span class="status">${items.length}</span></div>
            <div class="list">
              ${items.length ? items.map((item) => {
                const extra = item.status === "waiting_purchase"
                  ? `<div class="actions"><button class="primary-button" data-submit-purchase="${item.id}">Submit purchase</button></div>`
                  : "";
                return itemCard(item, extra);
              }).join("") : `<p class="subtle">No items in this status.</p>`}
            </div>
          </div>
        `).join("") : empty("Your haul is empty", "Paste an item link to start.")}
      </section>
    </div>
  `;
}

function renderOrders() {
  return `
    <div class="dl-v2 tx-v2"><section class="panel">
      <div class="panel-head">
        <div>
          <h2>Orders</h2>
          <p class="subtle">Purchase status stays separate from international shipping.</p>
        </div>
      </div>
      ${state.orders.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Status</th><th>Exception</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              ${state.orders.map((order) => {
                const item = itemById(order.itemId);
                return `
                  <tr>
                    <td><strong>${escapeHtml(item?.title || "Item")}</strong><br><span class="subtle">${escapeHtml(item?.spec || "")}</span></td>
                    <td><span class="status ${statusClass(order.status)}">${statusLabel(order.status)}</span></td>
                    <td>${order.exception ? `<span class="status bad">${escapeHtml(order.exception)}</span>` : `<span class="subtle">None</span>`}</td>
                    <td>${escapeHtml(order.updatedAt)}</td>
                    <td>
                      <div class="actions" style="margin:0">
                        ${order.status !== "qc_ready" ? `<button class="secondary-button" data-advance-order="${order.id}">Advance status</button>` : ""}
                        <select data-exception-order="${order.id}" aria-label="Order exception">
                          <option value="">No exception</option>
                          <option value="out_of_stock" ${order.exception === "out_of_stock" ? "selected" : ""}>Out of stock</option>
                          <option value="price_changed" ${order.exception === "price_changed" ? "selected" : ""}>Price changed</option>
                          <option value="seller_no_ship" ${order.exception === "seller_no_ship" ? "selected" : ""}>Seller not shipped</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      ` : empty("No orders yet", "Submit purchase from My Haul to create the first order.")}
    </section></div>
  `;
}

function renderQcPhotos(item) {
  const photos = item.qcPhotos || [];
  if (photos.length) {
    return photos.map((photo) => `
      <a class="qc-photo" href="${escapeHtml(photo.signedUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(photo.fileName)}">
        <img src="${escapeHtml(photo.signedUrl)}" alt="${escapeHtml(photo.fileName)}">
      </a>
    `).join("");
  }

  return ["QC front", "QC back", "QC tag", "QC detail", "QC package"]
    .map((label) => `<div class="qc-photo">${label}</div>`)
    .join("");
}

function renderStorageChips(item) {
  const storage = item.storage || {};
  const photoCount = item.qcPhotos?.length || "3-5";
  const storageLabel = storage.free_until
    ? `${storage.expired ? "Storage expired" : `${storage.days_left} days left`} · until ${new Date(storage.free_until).toLocaleDateString()}`
    : "90 days free storage";
  return `
    <span class="chip">${photoCount} QC photos</span>
    <span class="chip">${escapeHtml(storageLabel)}</span>
    <span class="chip">${item.weight ? `${escapeHtml(item.weight)} kg warehouse weight` : "Warehouse weight required"}</span>
  `;
}

function renderQc() {
  const qcItems = state.items.filter((item) => item.status === "qc_ready" || item.qcStatus === "extra_photo_requested");
  return `
    <div class="dl-v2 tx-v2"><section class="panel">
        <div class="panel-head">
          <div>
            <h2>QC Center</h2>
          <p class="subtle">After warehouse arrival, users get 3-5 QC photos, weight updates, and 90 days of free storage before international shipping.</p>
          </div>
        </div>
      <div class="list">
        ${qcItems.length ? qcItems.map((item) => `
          ${itemCard(item, `
            <div class="qc-grid">
              ${renderQcPhotos(item)}
            </div>
            <div class="item-meta">${renderStorageChips(item)}</div>
            <form class="actions" data-action="approve-qc" data-item-id="${item.id}">
              <input name="weight" type="number" min="0" step="0.01" placeholder="Warehouse weight kg" value="${escapeHtml(item.weight)}" style="max-width:190px" ${hasApiSession() ? "disabled" : ""}>
              <button class="primary-button" type="submit">Approve QC</button>
              <button class="secondary-button" type="button" data-extra-photo="${item.id}">Request extra photo</button>
              <button class="secondary-button" type="button" data-route-button="trust">Read QC policy</button>
            </form>
          `)}
        `).join("") : empty("No QC photos ready yet", "Items will appear here after warehouse arrival and QC upload.")}
      </div>
    </section></div>
  `;
}

function renderShipping() {
  const ready = state.items.filter((item) => item.status === "ready_to_ship");
  const activeParcels = state.parcels.filter((parcel) => !["delivered", "cancelled"].includes(parcel.status));
  const availableCoupons = state.coupons.filter((coupon) => coupon.status === "available");
  const lineById = new Map(state.shippingLines.map((line) => [line.id, line]));
  const lineOptions = state.shippingLines.filter((line) => line.status === "active");
  const fallbackLines = [
    { code: "Balanced Air", name: "Balanced Air", country: "United States" },
    { code: "Economy Line", name: "Economy Line", country: "United States" },
    { code: "Express Line", name: "Express Line", country: "United States" }
  ];
  const lines = lineOptions.length ? lineOptions : fallbackLines;
  return `
    <div class="dl-v2 tx-v2 grid two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Shipping / Parcel</h2>
            <p class="subtle">Combine multiple warehouse items, inspect the parcel, then choose from 700+ international shipping routes from China to overseas.</p>
          </div>
        </div>
        <div class="metric-row" style="margin-bottom:14px">
          <div class="metric"><strong>700+</strong><span>Shipping routes</span></div>
          <div class="metric"><strong>3</strong><span>Demo line groups</span></div>
          <div class="metric"><strong>90</strong><span>Free storage days</span></div>
          <div class="metric"><strong>Final</strong><span>Confirmed before payment</span></div>
        </div>
        ${ready.length ? `
          <form data-action="submit-parcel">
            <div class="list">
              ${ready.map((item) => `
                <label class="card item-card">
                  <input type="checkbox" name="item" value="${item.id}" style="margin-top:28px">
                  <div class="item-main">
                    <div class="card-head">
                      <div>
                        <div class="item-title">${escapeHtml(item.title)}</div>
                        <p class="subtle">${escapeHtml(item.spec)} · ${item.weight} kg</p>
                      </div>
                      <span class="status good">Ready to ship</span>
                    </div>
                  </div>
                </label>
              `).join("")}
            </div>
            <div class="form-grid" style="margin-top:14px">
              <div class="field">
                <label>Destination country</label>
                <select name="country">
                  ${["United States", "United Kingdom", "Canada", "Germany", "France", "Australia"].map((country) => `<option ${country === state.shippingCountry ? "selected" : ""}>${country}</option>`).join("")}
                </select>
              </div>
	              <div class="field">
	                <label>Shipping line</label>
	                <select name="line">
	                  ${lines.map((line) => `<option value="${escapeHtml(line.code)}" ${line.code === state.selectedLine || line.name === state.selectedLine ? "selected" : ""}>${escapeHtml(line.name)} · ${escapeHtml(line.country)}</option>`).join("")}
	                </select>
	              </div>
	              <div class="field">
	                <label>Recipient</label>
	                <input name="recipientName" placeholder="Full name">
	              </div>
	              <div class="field">
	                <label>Phone</label>
	                <input name="phone" placeholder="+1 555 0100">
	              </div>
	              <div class="field full">
	                <label>Address line</label>
	                <input name="addressLine1" placeholder="Street address">
	              </div>
	              <div class="field">
	                <label>City</label>
	                <input name="city" placeholder="City">
	              </div>
	              <div class="field">
	                <label>Region</label>
	                <input name="region" placeholder="State / province">
	              </div>
	              <div class="field">
	                <label>Postal code</label>
	                <input name="postalCode" placeholder="Postal code">
	              </div>
	              <div class="field">
	                <label>Parcel size cm</label>
	                <div class="inline-inputs">
	                  <input name="lengthCm" type="number" min="0" step="1" placeholder="L">
	                  <input name="widthCm" type="number" min="0" step="1" placeholder="W">
	                  <input name="heightCm" type="number" min="0" step="1" placeholder="H">
	                </div>
	              </div>
	              <div class="field full">
	                <label>Coupon</label>
                <select name="coupon">
                  <option value="">No coupon</option>
                  ${availableCoupons.map((coupon) => `<option value="${coupon.id}">${escapeHtml(coupon.code)} · ${money(coupon.amount)} off</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="actions">
              <button class="primary-button" type="submit">Submit parcel</button>
              <button class="secondary-button" type="button" data-route-button="trust">Shipping rules</button>
            </div>
          </form>
        ` : empty("No items ready to ship", "Approve QC with warehouse weight before building a parcel.")}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Parcels</h2>
            <p class="subtle">Tracking appears after dispatch. No fake tracking numbers are shown.</p>
          </div>
        </div>
        <div class="list">
	          ${activeParcels.length ? activeParcels.map((parcel) => `
	            <article class="card">
	              <div class="card-head">
	                <div>
	                  <h3>${escapeHtml(parcel.country)} · ${escapeHtml(lineById.get(parcel.lineId)?.name || parcel.line)}</h3>
	                  <p class="subtle">${parcel.itemCount || parcel.itemIds.length} item(s) · created ${escapeHtml(parcel.createdAt)}</p>
	                </div>
	                <span class="status ${statusClass(parcel.status)}">${statusLabel(parcel.status)}</span>
	              </div>
	              <div class="metric-row">
	                <div class="metric"><strong>${parcel.quoteId ? escapeHtml(parcel.quoteId.slice(0, 8)) : "Draft"}</strong><span>Quote</span></div>
	                <div class="metric"><strong>${money(parcel.finalFee)}</strong><span>Final before payment</span></div>
	                <div class="metric"><strong>${parcel.tracking || "Pending"}</strong><span>Tracking</span></div>
	                <div class="metric"><strong>${escapeHtml(lineById.get(parcel.lineId)?.name || parcel.line)}</strong><span>Line</span></div>
	              </div>
	              <div class="actions">
	                ${parcel.status === "shipping_due" ? `<button class="primary-button" data-pay-parcel="${parcel.id}">Pay shipping</button>` : ""}
	                <button class="secondary-button" data-refresh-tracking="${parcel.id}">Refresh tracking</button>
	              </div>
	            </article>
	          `).join("") : empty("No parcels yet", "Submitted parcels will appear here.")}
        </div>
      </section>
    </div>
  `;
}

function renderWallet() {
  const wallet = state.wallet || defaultState().wallet;
  const transactions = wallet.transactions || [];
  return `
    <div class="dl-v2 tx-v2 grid two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Wallet / Coupon</h2>
            <p class="subtle">Coupons show status and usage rules before payment.</p>
          </div>
        </div>
        <form class="paste-row" data-action="add-coupon">
          <input name="code" placeholder="Enter creator or coupon code" aria-label="Coupon code">
          <button class="primary-button" type="submit">Add code</button>
        </form>
        <div class="list" style="margin-top:14px">
          ${state.coupons.length ? state.coupons.map((coupon) => `
            <article class="card">
              <div class="card-head">
                <div>
	                  <h3>${escapeHtml(coupon.code)}</h3>
	                  <p class="subtle">${escapeHtml(coupon.type)} · ${escapeHtml(coupon.rule)}</p>
	                </div>
	                <span class="status ${statusClass(coupon.status)}">${statusLabel(coupon.status)}</span>
	              </div>
	              <div class="metric-row">
	                <div class="metric"><strong>${money(coupon.amount)}</strong><span>Amount</span></div>
	                <div class="metric"><strong>${coupon.status}</strong><span>Status</span></div>
	                <div class="metric"><strong>${escapeHtml(coupon.createdAt)}</strong><span>Added</span></div>
	                <div class="metric"><strong>${coupon.lockedParcelId || coupon.usedParcelId ? "Parcel" : "Shipping"}</strong><span>${escapeHtml(coupon.lockedParcelId || coupon.usedParcelId || "Applies to eligible lines")}</span></div>
	              </div>
	            </article>
	          `).join("") : empty("No available coupons", "Add a creator or coupon code when you have one.")}
        </div>
      </section>
      <section class="panel">
	        <div class="panel-head">
	          <div>
	            <h2>Credit</h2>
	            <p class="subtle">Wallet credit and coupon locks are synced from the backend.</p>
	          </div>
	        </div>
	        <div class="metric-row">
	          <div class="metric"><strong>${money(wallet.balance)}</strong><span>Credit balance</span></div>
	          <div class="metric"><strong>${counts().coupons}</strong><span>Available coupons</span></div>
	          <div class="metric"><strong>${state.coupons.filter((coupon) => coupon.status === "used").length}</strong><span>Used coupons</span></div>
	          <div class="metric"><strong>${state.coupons.filter((coupon) => coupon.status === "locked").length}</strong><span>Locked</span></div>
	        </div>
	        <div class="list" style="margin-top:14px">
	          ${transactions.length ? transactions.map((transaction) => `
	            <article class="card">
	              <div class="card-head">
	                <div>
	                  <h3>${money(transaction.amount)}</h3>
	                  <p class="subtle">${escapeHtml(transaction.reason)}</p>
	                </div>
	                <span class="status ${transaction.amount_cents >= 0 ? "good" : "warn"}">${escapeHtml(transaction.sourceType)}</span>
	              </div>
	              <div class="item-meta">
	                <span class="chip">Balance ${money(transaction.balanceAfter)}</span>
	                <span class="chip">${escapeHtml(transaction.createdAt)}</span>
	              </div>
	            </article>
	          `).join("") : empty("No wallet activity", "Credit adjustments and refunds will appear here.")}
	        </div>
	      </section>
	    </div>
	  `;
}

function renderCreator() {
  if (!apiState.connected) {
    return `
      <div class="dl-v2 tx-v2"><section class="panel">
        <div class="panel-head"><div><h2>Creator</h2><p class="subtle">Creator dashboards load from the live backend. Connect an API account to view your attribution.</p></div></div>
        ${empty("Not connected", "Connect a backend API account above to load your creator dashboard.")}
      </section></div>
    `;
  }
  const creator = state.creator || { loaded: false, error: "", data: null };
  const body = creator.error
    ? empty("Dashboard unavailable", creator.error)
    : creator.data
      ? renderCreatorDashboard(creator.data)
      : empty("No data yet", creator.loaded ? "No creator dashboard is linked to this account." : "Load your dashboard to see aggregate attribution counts.");
  return `
    <div class="dl-v2 tx-v2"><section class="panel">
      <div class="panel-head">
        <div>
          <h2>Creator Dashboard</h2>
          <p class="subtle">Aggregate attribution only. Buyer addresses, order details, and QC are never shown here.</p>
        </div>
        <button class="ghost" data-creator-refresh>${creator.loaded ? "Refresh" : "Load dashboard"}</button>
      </div>
      ${body}
    </section></div>
  `;
}

function renderCreatorDashboard(data) {
  const stats = data.stats || { visits: 0, signups: 0, orders: 0 };
  const campaigns = data.campaigns || [];
  return `
    <div class="stat-row">
      <article class="card"><div class="item-title">${stats.visits}</div><p class="subtle">Visits</p></article>
      <article class="card"><div class="item-title">${stats.signups}</div><p class="subtle">Signups</p></article>
      <article class="card"><div class="item-title">${stats.orders}</div><p class="subtle">Orders</p></article>
    </div>
    <h3 style="margin-top:16px">Campaigns</h3>
    ${campaigns.length
      ? campaigns.map((campaign) => `
        <article class="card">
          <div class="card-head">
            <div class="item-title">${escapeHtml(campaign.name || campaign.code)}</div>
            <span class="status">${escapeHtml(campaign.status)}</span>
          </div>
          <p class="subtle">Code ${escapeHtml(campaign.code)}</p>
        </article>
      `).join("")
      : empty("No campaigns", "No campaigns are attached to this creator yet.")}
  `;
}

async function loadCreatorDashboard() {
  state.creator = { loaded: true, error: "", data: null };
  try {
    const payload = await apiRequest("/creator/dashboard");
    state.creator = { loaded: true, error: "", data: payload };
    setToast("Creator dashboard loaded.");
  } catch (error) {
    state.creator = { loaded: true, error: error.message, data: null };
  }
  saveState();
  render();
}

function renderTrust() {
  const cards = state.policies.length
    ? state.policies.map((policy) => [policy.title, policy.body])
    : policyCards;
  return `
    <div class="dl-v2 content-v2">
      <section class="section"><div class="wrap">
        <div class="section-head left" data-reveal>
          <span class="eyebrow">Buyer protection</span>
          <h2>Trust Center</h2>
          <p>Rules stay accessible from key workflow pages and keep GOATEDBUY's neutral agent boundary clear.</p>
        </div>
        <div class="trust-grid" data-reveal>
          ${cards.map(([title, body]) => `
            <div class="card-secondary"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div>
          `).join("")}
        </div>
      </div></section>
    </div>
  `;
}

// Social login providers shown on the sign-in / register screens, in display order.
const OAUTH_DISPLAY = [
  { id: "google", label: "Google" },
  { id: "discord", label: "Discord" }
];
let oauthProviderState = { loaded: false, configured: new Set() };

function oauthBrandMark(id) {
  switch (id) {
    case "google":
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.7 3.2-7.8Z"/><path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.6-2.7c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.1-1.9-6-4.4H2.3v2.8A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M6 14.4a6.6 6.6 0 0 1 0-4.2V7.4H2.3a11 11 0 0 0 0 9.8L6 14.4Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.4L6 10.2c.9-2.6 3.2-4.8 6-4.8Z"/></svg>`;
    case "apple":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.9-1.4-.1-2.8.8-3.5.8-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.5 3 2.4 1.2-.1 1.6-.8 3.1-.8 1.4 0 1.8.8 3.1.8 1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.5-1-2.5-3.9ZM14.1 5.6c.7-.8 1.1-2 1-3.1-1 0-2.1.7-2.8 1.5-.6.7-1.1 1.9-1 3 1.1.1 2.1-.6 2.8-1.4Z"/></svg>`;
    case "discord":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="#5865F2" aria-hidden="true"><path d="M19.3 5.4A17 17 0 0 0 15.1 4l-.2.4a15.7 15.7 0 0 1 3.7 1.2 15.9 15.9 0 0 0-13.2 0A15.7 15.7 0 0 1 9.1 4.4L8.9 4a17 17 0 0 0-4.2 1.4C2 9.3 1.3 13.1 1.6 16.9a17 17 0 0 0 5.2 2.6l.4-.6a11 11 0 0 1-1.8-.9l.4-.3a12 12 0 0 0 10.3 0l.4.3c-.6.4-1.2.7-1.8.9l.4.6a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.2-3.4-11.5ZM8.5 14.7c-1 0-1.9-.9-1.9-2.1 0-1.1.8-2.1 1.9-2.1s1.9 1 1.9 2.1c0 1.2-.8 2.1-1.9 2.1Zm7 0c-1 0-1.9-.9-1.9-2.1 0-1.1.8-2.1 1.9-2.1s1.9 1 1.9 2.1c0 1.2-.8 2.1-1.9 2.1Z"/></svg>`;
    case "facebook":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="#1877F2" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.5V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"/></svg>`;
    case "github":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.7 1 .7 2v3c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"/></svg>`;
    case "microsoft":
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#F25022" d="M3 3h8.5v8.5H3z"/><path fill="#7FBA00" d="M12.5 3H21v8.5h-8.5z"/><path fill="#00A4EF" d="M3 12.5h8.5V21H3z"/><path fill="#FFB900" d="M12.5 12.5H21V21h-8.5z"/></svg>`;
    default:
      return "";
  }
}

function renderOAuthButtons() {
  const buttons = OAUTH_DISPLAY.map(({ id, label }) => {
    return `<button type="button" class="oauth-button" data-oauth="${id}" ${authFlow.loading ? "disabled" : ""}>
      <span class="oauth-mark">${oauthBrandMark(id)}</span><span>Continue with ${label}</span>
    </button>`;
  }).join("");
  return `<div class="oauth-block"><div class="oauth-divider"><span>or continue with</span></div><div class="oauth-buttons">${buttons}</div></div>`;
}

// Called at boot: pull tokens the OAuth callback left in the URL fragment, adopt them
// as the session, then strip them from the address bar so they never linger in history.
function consumeOAuthRedirect() {
  const hash = location.hash || "";
  if (!hash.includes("access_token=")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const access = params.get("access_token") || "";
  if (!access) return null;
  apiState.accessToken = access;
  apiState.refreshToken = params.get("refresh_token") || "";
  apiState.connected = true;
  apiState.error = "";
  saveApiState();
  const provider = params.get("provider") || "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return { provider };
}

async function loadOAuthProviders() {
  try {
    const res = await apiRequest("/auth/oauth/providers", { anonymous: true, noRefresh: true });
    oauthProviderState = {
      loaded: true,
      configured: new Set((res.providers || []).filter((p) => p.configured).map((p) => p.provider))
    };
  } catch {
    oauthProviderState = { ...oauthProviderState, loaded: true };
  }
}

function startOAuth(provider) {
  const meta = OAUTH_DISPLAY.find((p) => p.id === provider);
  const label = meta ? meta.label : provider;
  if (!oauthProviderState.configured.has(provider)) {
    setToast(`${label} sign-in isn't configured on this server yet — add its OAuth client credentials to the backend.`);
    render();
    return;
  }
  const base = apiState.baseUrl.replace(/\/+$/, "");
  window.location.href = `${base}/auth/oauth/${provider}/start`;
}

function renderLogin() {
  return `
    <div class="dl-v2 signin-v2">
      <div class="signin-net-bg" aria-hidden="true">
        <svg class="signin-net" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" fill="none">
          <path id="gbNetA" d="M120 600 C 380 470 620 380 840 400 C 1030 418 1180 520 1380 300" stroke="var(--c-coral)" stroke-width="1.6" stroke-opacity=".18" stroke-dasharray="1.5 8" stroke-linecap="round"/>
          <path d="M80 420 C 360 470 660 520 940 400 C 1160 310 1300 340 1440 300" stroke="var(--c-ship)" stroke-width="1.4" stroke-opacity=".10" stroke-dasharray="1.5 9" stroke-linecap="round"/>
          <path d="M200 700 C 520 640 820 620 1080 560 C 1260 520 1360 560 1440 520" stroke="var(--c-coral)" stroke-width="1.2" stroke-opacity=".08" stroke-dasharray="1.5 10" stroke-linecap="round"/>
          <g>
            <circle cx="840" cy="400" r="26" fill="var(--c-coral)" opacity=".05"></circle><circle cx="840" cy="400" r="4.5" fill="var(--c-coral)" opacity=".45"></circle>
            <circle cx="1180" cy="470" r="20" fill="var(--c-ship)" opacity=".05"></circle><circle cx="1180" cy="470" r="4" fill="var(--c-ship)" opacity=".4"></circle>
            <circle cx="360" cy="470" r="18" fill="var(--c-coral)" opacity=".05"></circle><circle cx="360" cy="470" r="3.5" fill="var(--c-coral)" opacity=".4"></circle>
          </g>
          <circle r="4.5" fill="var(--c-coral)"><animateMotion dur="7s" repeatCount="indefinite"><mpath href="#gbNetA"></mpath></animateMotion></circle>
        </svg>
      </div>
      <div class="signin-left">
        <div class="signin-left-inner">
          <span class="eyebrow">Welcome back</span>
          <h1>Your global shipping <em>workspace</em></h1>
          <p class="lede">One live account for orders, warehouse, parcels and shipping — tracked end to end.</p>
          <div class="wk-stack" aria-hidden="true">
            <div class="wk-card wk-today">
              <div class="wk-head"><b>Today's shipments</b><span class="wk-live"><i></i>Live</span></div>
              <div class="wk-stats">
                <div><div class="wv">342</div><div class="wl">Packages</div></div>
                <div><div class="wv">16</div><div class="wl">Warehouses</div></div>
                <div><div class="wv">98.4%</div><div class="wl">Delivered today</div></div>
              </div>
            </div>
            <div class="wk-card wk-track">
              <div class="wk-head"><b>Live tracking</b><span class="wk-tn">GB1234567890</span></div>
              <div class="wk-route"><span class="rline"><span class="rprog"></span></span><span class="rparcel"></span>
                <div class="rnodes">
                  <div class="rn done"><span class="rd"></span>Shanghai</div>
                  <div class="rn cur"><span class="rd"></span>US&nbsp;Warehouse</div>
                  <div class="rn"><span class="rd"></span>Out&nbsp;for&nbsp;delivery</div>
                </div>
              </div>
              <div class="wk-eta">ETA <b>Jul&nbsp;15</b> · Air freight · 2.4&nbsp;kg</div>
            </div>
            <div class="wk-card wk-orders">
              <div class="wk-row"><span class="oid"><i data-lucide="package"></i>GB12345</span><span class="ochip proc">Processing</span></div>
              <div class="wk-row"><span class="oid"><i data-lucide="package"></i>GB66771</span><span class="ochip pack">Packed</span></div>
              <div class="wk-row"><span class="oid"><i data-lucide="package"></i>GB88192</span><span class="ochip tran">In transit</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="signin-right">
        <div class="signin-card">
          <div class="signin-brand"><img src="./assets/gb-logo-symbol.jpg" alt="GOATEDBUY"></div>
          <h2>Sign in to your account</h2>
          <p class="signin-sub">Welcome back! Please enter your details.</p>
          <form class="signin-form" data-action="account-login">
            ${authErrorMarkup()}
            <label class="signin-field"><i class="fi" data-lucide="mail" aria-hidden="true"></i><input name="email" type="email" autocomplete="email" required placeholder="Email address" value="${escapeHtml(authFlow.email)}"></label>
            <label class="signin-field"><i class="fi" data-lucide="lock" aria-hidden="true"></i><input name="password" type="password" autocomplete="current-password" required minlength="10" placeholder="Password"></label>
            <div class="signin-forgot"><button type="button" class="link-btn" data-route-button="guide">Forgot password?</button></div>
            <button class="signin-btn" type="submit" ${authFlow.loading ? "disabled" : ""}>${i18n.t("account.sign_in")}</button>
          </form>
          ${renderOAuthButtons()}
          <p class="signin-switch">New to GOATEDBUY? <button type="button" data-route-button="register">Create account <i data-lucide="arrow-right" aria-hidden="true"></i></button></p>
        </div>
        <div class="signin-trustrow">
          <span><i data-lucide="lock" aria-hidden="true"></i>256-bit SSL</span>
          <span><i data-lucide="shield-check" aria-hidden="true"></i>10,000+ customers</span>
          <span><i data-lucide="star" aria-hidden="true"></i>4.8/5 rating</span>
        </div>
      </div>
    </div>
  `;
}

function renderRegister() {
  return renderAuthLayout({
    eyebrow: "Buyer account",
    title: "Create your account",
    body: "Your email must be verified before any private workspace session is issued.",
    content: `
      <form class="account-form" data-action="account-register">
        ${authErrorMarkup()}
        <label class="field"><span>Display name</span><input name="display_name" autocomplete="name" maxlength="80"></label>
        <label class="field"><span>${i18n.t("auth.email")}</span><input name="email" type="email" autocomplete="email" required value="${escapeHtml(authFlow.email)}"></label>
        <label class="field"><span>${i18n.t("auth.password")}</span><input name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="128"><small>10-128 characters</small></label>
        <button class="primary-button" type="submit" ${authFlow.loading ? "disabled" : ""}>${i18n.t("account.register")}</button>
      </form>
      ${renderOAuthButtons()}
      <p class="auth-switch">Already registered? <button type="button" data-route-button="login">${i18n.t("account.sign_in")}</button></p>
    `
  });
}

function renderVerifyEmail() {
  return renderVerification("email", "Check your email", "Enter the one-time registration token sent to your email. The token expires automatically and works once.");
}

function renderVerifyDevice() {
  return renderVerification("device", "Verify this device", "This browser is new or its seven-day trust period expired. Complete the email check before a session is created.");
}

function renderVerification(kind, title, body) {
  const seconds = Math.max(0, Math.ceil((authFlow.resendAvailableAt - Date.now()) / 1000));
  const developmentToken = runtimeConfig.environment !== "production" && authFlow.verificationToken
    ? `<p class="development-token"><strong>Local delivery token</strong><code>${escapeHtml(authFlow.verificationToken)}</code></p>` : "";
  scheduleVerificationTick(seconds);
  return renderAuthLayout({
    eyebrow: kind === "email" ? "Email verification" : "Device security",
    title,
    body,
    content: `
      <form class="account-form" data-action="verify-${kind}">
        ${authErrorMarkup()}
        <label class="field"><span>Verification token</span><input name="token" autocomplete="one-time-code" required value="${escapeHtml(authFlow.verificationToken)}"></label>
        ${developmentToken}
        <div class="actions">
          <button class="primary-button" type="submit" ${authFlow.loading ? "disabled" : ""}>${kind === "email" ? i18n.t("auth.verify_email") : i18n.t("auth.verify_device")}</button>
          <button class="secondary-button" type="button" data-resend-verification="${kind}" ${seconds || authFlow.loading ? "disabled" : ""}>${seconds ? `${i18n.t("auth.resend")} (${seconds}s)` : i18n.t("auth.resend")}</button>
        </div>
      </form>
      <p class="auth-switch"><button type="button" data-route-button="login">Back to sign in</button></p>
    `
  });
}

function renderAuthLayout({ eyebrow, title, body, content }) {
  return `
    <div class="dl-v2 auth-v2"><section class="auth-layout">
      <div class="auth-context">
        <img src="./assets/goatedbuy-symbol.jpg" alt="" aria-hidden="true">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
        <ul><li>Private account data stays behind your session.</li><li>New devices require email confirmation.</li><li>GOATEDBUY support never asks for your password.</li></ul>
      </div>
      <div class="auth-form-panel">${content}</div>
    </section></div>
  `;
}

function authErrorMarkup() {
  return authFlow.error ? `<div class="form-message error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(authFlow.error)}</span></div>` : "";
}

function scheduleVerificationTick(seconds) {
  clearTimeout(scheduleVerificationTick.timer);
  if (seconds > 0) scheduleVerificationTick.timer = setTimeout(() => {
    if (currentView === "verifyEmail" || currentView === "verifyDevice") render();
  }, 1000);
}

function renderAccount() {
  ensureAccountData();
  if (accountState.loading && !accountState.account) return renderLoadingState("Loading account settings");
  if (accountState.error && !accountState.account) return renderErrorState(accountState.error, "account");
  const account = accountState.account;
  if (!account) return renderLoadingState("Loading account settings");
  return `
    <div class="dl-v2 account-v2"><section class="account-page">
      <nav class="account-tabs" aria-label="Account sections">
        <button class="active" type="button" data-route-button="account"><i data-lucide="user-round"></i>Settings</button>
        <button type="button" data-route-button="addresses"><i data-lucide="map-pin"></i>${i18n.t("account.addresses")}</button>
      </nav>
      ${accountState.error ? `<div class="form-message error" role="alert">${escapeHtml(accountState.error)}</div>` : ""}
      <div class="settings-grid">
        <section class="settings-section">
          <div class="section-heading-compact"><div><h2>${i18n.t("account.profile")}</h2><p>Email verified · Phone ${account.phone_verified ? "verified" : "not verified"}</p></div><span class="status good">v${account.version}</span></div>
          <form class="account-form two-column" data-action="save-account">
            <label class="field"><span>Email</span><input value="${escapeHtml(account.email)}" disabled></label>
            <label class="field"><span>Display name</span><input name="display_name" maxlength="80" value="${escapeHtml(account.display_name)}"></label>
            <label class="field"><span>Phone</span><input name="phone" autocomplete="tel" maxlength="32" value="${escapeHtml(account.phone || "")}"><small>New numbers remain unverified.</small></label>
            <label class="field"><span>Country</span><input name="country_code" maxlength="2" value="${escapeHtml(account.country_code || "")}" placeholder="US"></label>
            <label class="field"><span>Language</span><select name="default_locale">${localeOptions(account.default_locale)}</select><small>Only approved translations can be enabled.</small></label>
            <label class="field"><span>Display currency</span><select name="default_currency">${currencyOptions(account.default_currency)}</select><small>Display only; the CNY ledger is unchanged.</small></label>
            <input type="hidden" name="expected_version" value="${account.version}">
            <div class="form-actions full"><button class="primary-button" type="submit">${i18n.t("common.save")}</button></div>
          </form>
        </section>
        <section class="settings-section">
          <div class="section-heading-compact"><div><h2>${i18n.t("account.security")}</h2><p>Changing your password signs out every device.</p></div><i data-lucide="shield-check"></i></div>
          <form class="account-form" data-action="change-password">
            <label class="field"><span>Current password</span><input name="current_password" type="password" autocomplete="current-password" required></label>
            <label class="field"><span>New password</span><input name="new_password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
            <input type="hidden" name="expected_version" value="${account.version}">
            <button class="secondary-button" type="submit">Update password</button>
          </form>
        </section>
      </div>
      <section class="danger-zone">
        <div><h2>${i18n.t("account.delete")}</h2><p>Deletion is available only with zero balance and no warehouse item, active order, parcel, or after-sales case.</p></div>
        <button class="danger-button" type="button" data-check-deletion>Check eligibility</button>
      </section>
    </section></div>
  `;
}

function renderAddresses() {
  ensureAccountData();
  if (accountState.loading && !accountState.loaded) return renderLoadingState("Loading addresses");
  if (accountState.error && !accountState.loaded) return renderErrorState(accountState.error, "addresses");
  const editing = accountState.addresses.find((entry) => entry.id === accountState.editingAddressId);
  return `
    <div class="dl-v2 account-v2"><section class="account-page">
      <nav class="account-tabs" aria-label="Account sections">
        <button type="button" data-route-button="account"><i data-lucide="user-round"></i>Settings</button>
        <button class="active" type="button" data-route-button="addresses"><i data-lucide="map-pin"></i>${i18n.t("account.addresses")}</button>
      </nav>
      ${accountState.error ? `<div class="form-message error" role="alert">${escapeHtml(accountState.error)}</div>` : ""}
      <div class="address-layout">
        <section class="settings-section address-list-section">
          <div class="section-heading-compact"><div><h2>Saved addresses</h2><p>${accountState.addresses.length} saved · one default maximum</p></div><button class="icon-button" type="button" data-new-address title="New address"><i data-lucide="plus"></i></button></div>
          <div class="address-list">${accountState.addresses.length ? accountState.addresses.map(addressCard).join("") : renderEmptyState("No saved addresses", "Add an address before submitting an international parcel.")}</div>
        </section>
        <section class="settings-section address-editor">
          <div class="section-heading-compact"><div><h2>${editing ? "Edit address" : "Add address"}</h2><p>Required fields are used for international delivery.</p></div></div>
          ${addressForm(editing)}
        </section>
      </div>
    </section></div>
  `;
}

function addressCard(address) {
  return `
    <article class="address-item ${address.is_default ? "default" : ""}">
      <div><div class="address-title"><strong>${escapeHtml(address.recipient_name)}</strong>${address.is_default ? `<span class="status good">Default</span>` : ""}</div>
      <p>${escapeHtml(address.line1)}${address.line2 ? `, ${escapeHtml(address.line2)}` : ""}<br>${escapeHtml(address.city)}, ${escapeHtml(address.region)} ${escapeHtml(address.postal_code)} · ${escapeHtml(address.country_code)}</p><span>${escapeHtml(address.phone)}</span></div>
      <div class="address-actions"><button class="icon-button" type="button" data-edit-address="${address.id}" title="Edit"><i data-lucide="pencil"></i></button><button class="icon-button" type="button" data-delete-address="${address.id}" data-version="${address.version}" title="Delete"><i data-lucide="trash-2"></i></button></div>
    </article>
  `;
}

function addressForm(address = null) {
  const value = (key) => escapeHtml(address?.[key] || "");
  return `
    <form class="account-form two-column" data-action="save-address" data-address-id="${address?.id || ""}">
      <label class="field full"><span>Recipient</span><input name="recipient_name" maxlength="120" required value="${value("recipient_name")}"></label>
      <label class="field"><span>Phone</span><input name="phone" maxlength="32" required value="${value("phone")}"></label>
      <label class="field"><span>Country code</span><input name="country_code" maxlength="2" required placeholder="US" value="${value("country_code")}"></label>
      <label class="field"><span>Region / State</span><input name="region" maxlength="120" value="${value("region")}"></label>
      <label class="field"><span>City</span><input name="city" maxlength="120" required value="${value("city")}"></label>
      <label class="field"><span>Postal code</span><input name="postal_code" maxlength="32" required value="${value("postal_code")}"></label>
      <label class="field full"><span>Address line 1</span><input name="line1" maxlength="240" required value="${value("line1")}"></label>
      <label class="field full"><span>Address line 2</span><input name="line2" maxlength="240" value="${value("line2")}"></label>
      <label class="check-field full"><input name="is_default" type="checkbox" ${address?.is_default ? "checked" : ""}><span>Use as default address</span></label>
      <input type="hidden" name="expected_version" value="${address?.version || ""}">
      <div class="form-actions full"><button class="primary-button" type="submit">${address ? "Save address" : "Add address"}</button>${address ? `<button class="secondary-button" type="button" data-new-address>${i18n.t("common.cancel")}</button>` : ""}</div>
    </form>
  `;
}

function renderLoadingState(label) {
  return `<div class="ui-state loading" role="status"><span class="spinner"></span><h2>${escapeHtml(label)}</h2><p>Please wait.</p></div>`;
}

function renderErrorState(message, retryView) {
  return `<div class="ui-state error"><i data-lucide="circle-alert"></i><h2>Unable to load</h2><p>${escapeHtml(message)}</p><button class="secondary-button" type="button" data-retry-account="${retryView}">${i18n.t("common.retry")}</button></div>`;
}

function renderEmptyState(title, body) {
  return `<div class="ui-state empty"><i data-lucide="map-pin"></i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div>`;
}

function localeOptions(selected) {
  return runtimeConfig.enabledLocales.map((locale) => `<option value="${locale}" ${locale === selected ? "selected" : ""}>${locale}</option>`).join("");
}

function currencyOptions(selected) {
  return runtimeConfig.displayCurrencies.map((currency) => `<option value="${currency}" ${currency === selected ? "selected" : ""}>${currency}</option>`).join("");
}

async function loadAccountData() {
  if (accountState.loading || !hasApiSession()) return;
  accountState.loading = true;
  accountState.error = "";
  render();
  try {
    const [account, addresses] = await Promise.all([apiRequest("/api/v2/account"), apiRequest("/api/v2/addresses")]);
    accountState.account = account.data;
    accountState.addresses = addresses.data;
    accountState.loaded = true;
    preferences.locale = runtimeConfig.enabledLocales.includes(account.data.default_locale) ? account.data.default_locale : preferences.locale;
    preferences.currency = runtimeConfig.displayCurrencies.includes(account.data.default_currency) ? account.data.default_currency : preferences.currency;
    i18n.setLocale(preferences.locale);
    savePreferences();
  } catch (error) {
    accountState.error = error.message;
    if (error.status === 401) route("login", { replace: true });
  } finally {
    accountState.loading = false;
    render();
  }
}

function ensureAccountData() {
  if (!accountState.loaded && !accountState.loading) setTimeout(loadAccountData, 0);
}

function renderApiBanner() {
  const status = apiState.loading
    ? "Syncing"
    : apiState.connected
      ? "Connected"
      : hasApiSession()
        ? "Needs retry"
        : "Not connected";
  const statusClassName = apiState.connected ? "good" : apiState.error ? "bad" : "warn";
  return `
    <section class="notice api-banner">
      <div class="api-icon"><i data-lucide="${apiState.connected ? "cloud-check" : "user-round-check"}" aria-hidden="true"></i></div>
      <div style="flex:1;min-width:220px">
        <strong>${escapeHtml(apiState.connected ? "Your account is connected" : "Connect your buyer account")}</strong>
        <p>${escapeHtml(apiState.error || (hasApiSession() ? "Your order, warehouse, parcel, and wallet data are synced." : "Sign in to save links and use live order, QC, parcel, and wallet data."))}</p>
      </div>
      <span class="status ${statusClassName}">${escapeHtml(apiState.userEmail || status)}</span>
      ${hasApiSession() ? `
        <div class="actions" style="margin:0">
          <button class="secondary-button" type="button" data-api-sync ${apiState.loading ? "disabled" : ""}>Retry sync</button>
          <button class="secondary-button" type="button" data-route-button="account">Account</button>
          <button class="danger-button" type="button" data-api-disconnect>Disconnect</button>
        </div>
      ` : `
        <div class="actions" style="margin:0">
          <button class="primary-button" type="button" data-route-button="login">${i18n.t("account.sign_in")}</button>
          <button class="secondary-button" type="button" data-route-button="register">${i18n.t("account.register")}</button>
        </div>
      `}
    </section>
  `;
}

function renderQuickRail() {
  if (!quickRail) return;
  quickRail.innerHTML = `
    <button class="quick-button" data-route-button="haul" title="My Haul" aria-label="My Haul"><i data-lucide="shopping-bag" aria-hidden="true"></i><span>Haul</span></button>
    <a class="quick-button" href="https://telegram.org" target="_blank" rel="noreferrer" title="Telegram" aria-label="Telegram"><i data-lucide="send" aria-hidden="true"></i><span>Chat</span></a>
    <a class="quick-button" href="https://discord.com" target="_blank" rel="noreferrer" title="Discord" aria-label="Discord"><i data-lucide="message-circle" aria-hidden="true"></i><span>Discord</span></a>
    <button class="quick-button" data-scroll-top title="Back to top" aria-label="Back to top"><i data-lucide="arrow-up" aria-hidden="true"></i><span>Top</span></button>
  `;
}

function renderToast() {
  document.querySelectorAll(".toast").forEach((node) => node.remove());
  if (!state.toast) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = state.toast;
  document.body.appendChild(toast);
}

function attachHandlers() {
  document.querySelectorAll("[data-route-button]").forEach((button) => {
    if (button.dataset.boundRoute) return;
    button.dataset.boundRoute = "true";
    button.addEventListener("click", () => route(button.dataset.routeButton));
  });

  document.querySelectorAll("[data-oauth]").forEach((button) => {
    if (button.dataset.boundOauth) return;
    button.dataset.boundOauth = "true";
    button.addEventListener("click", () => startOAuth(button.dataset.oauth));
  });

  document.querySelector('form[data-action="account-login"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await connectApiAccount("login", new FormData(event.currentTarget));
  });
  document.querySelector('form[data-action="account-register"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await connectApiAccount("register", new FormData(event.currentTarget));
  });
  document.querySelector('form[data-action="verify-email"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await verifyAuthFlow("email", new FormData(event.currentTarget));
  });
  document.querySelector('form[data-action="verify-device"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await verifyAuthFlow("device", new FormData(event.currentTarget));
  });
  document.querySelectorAll("[data-resend-verification]").forEach((button) => {
    button.addEventListener("click", () => resendVerification(button.dataset.resendVerification));
  });
  document.querySelector('form[data-action="save-account"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(new FormData(event.currentTarget));
    try {
      const payload = await apiRequest("/api/v2/account", { method: "PATCH", body });
      accountState.account = payload.data;
      accountState.error = "";
      preferences.locale = payload.data.default_locale;
      preferences.currency = payload.data.default_currency;
      i18n.setLocale(preferences.locale);
      savePreferences();
      setToast("Account settings saved.");
    } catch (error) {
      accountState.error = error.code === "VERSION_CONFLICT" ? "Your account changed elsewhere. Reload before saving again." : error.message;
      render();
    }
  });
  document.querySelector('form[data-action="change-password"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiRequest("/api/v2/account/password", { method: "POST", body: formObject(new FormData(event.currentTarget)) });
      clearApiSession();
      authFlow.error = "Password updated. Sign in again on this device.";
      route("login");
    } catch (error) {
      accountState.error = error.message;
      render();
    }
  });
  document.querySelector('form[data-action="save-address"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = formObject(new FormData(form));
    body.is_default = form.elements.is_default.checked;
    const addressId = form.dataset.addressId;
    try {
      await apiRequest(addressId ? `/api/v2/addresses/${addressId}` : "/api/v2/addresses", {
        method: addressId ? "PATCH" : "POST", body
      });
      accountState.editingAddressId = "";
      accountState.loaded = false;
      accountState.error = "";
      await loadAccountData();
      setToast(addressId ? "Address updated." : "Address added.");
    } catch (error) {
      accountState.error = error.code === "VERSION_CONFLICT" ? "This address changed elsewhere. Reload and try again." : error.message;
      render();
    }
  });
  document.querySelectorAll("[data-edit-address]").forEach((button) => button.addEventListener("click", () => {
    accountState.editingAddressId = button.dataset.editAddress;
    render();
    document.querySelector(".address-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll("[data-new-address]").forEach((button) => button.addEventListener("click", () => {
    accountState.editingAddressId = "";
    render();
  }));
  document.querySelectorAll("[data-delete-address]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this saved address? Existing parcel snapshots will not change.")) return;
    try {
      await apiRequest(`/api/v2/addresses/${button.dataset.deleteAddress}`, { method: "DELETE", version: button.dataset.version });
      accountState.loaded = false;
      await loadAccountData();
      setToast("Address deleted.");
    } catch (error) {
      accountState.error = error.code === "VERSION_CONFLICT" ? "This address changed elsewhere. Reload and try again." : error.message;
      render();
    }
  }));
  document.querySelector("[data-check-deletion]")?.addEventListener("click", async () => {
    try {
      const eligibility = await apiRequest("/api/v2/account/deletion-eligibility");
      if (!eligibility.data.eligible) {
        const blockers = Object.entries(eligibility.data.blockers).filter(([, blocked]) => blocked).map(([name]) => name.replace(/_/g, " "));
        accountState.error = `Deletion is blocked by: ${blockers.join(", ")}.`;
        render();
        return;
      }
      if (!confirm("Queue permanent account deletion? You will be signed out immediately.")) return;
      await apiRequest("/api/v2/account/deletion-requests", { method: "POST", body: {} });
      clearApiSession();
      authFlow.error = "Account deletion was queued. Your private profile will be anonymized asynchronously.";
      route("login");
    } catch (error) {
      accountState.error = error.details?.blockers ? `Deletion is blocked by active account obligations.` : error.message;
      render();
    }
  });
  document.querySelectorAll("[data-retry-account]").forEach((button) => button.addEventListener("click", () => {
    accountState.loaded = false;
    accountState.error = "";
    loadAccountData();
  }));

  document.querySelector("[data-focus-paste]")?.addEventListener("click", () => {
    route("dashboard");
    setTimeout(() => document.querySelector('input[name="url"]')?.focus(), 0);
  });

  document.querySelectorAll("[data-focus-account]").forEach((button) => {
    if (button.dataset.boundAccount) return;
    button.dataset.boundAccount = "true";
    button.addEventListener("click", () => {
      route(hasApiSession() ? "account" : "login");
    });
  });

  document.querySelectorAll('form[data-action="paste"]').forEach((form) => {
    if (form.dataset.boundPaste) return;
    form.dataset.boundPaste = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await createSavedLink(new FormData(form).get("url"));
      } catch (error) {
        setToast(error.message);
      }
    });
    form.querySelector("[data-save-link]")?.addEventListener("click", async () => {
      try {
        await createSavedLink(new FormData(form).get("url"), false);
      } catch (error) {
        setToast(error.message);
      }
    });
  });

  document.querySelectorAll("[data-welcome-gift]").forEach((button) => {
    if (button.dataset.boundGift) return;
    button.dataset.boundGift = "true";
    button.addEventListener("click", async () => {
      try {
        await claimWelcomeGift();
      } catch (error) {
        setToast(error.message);
      }
    });
  });

  document.querySelectorAll("[data-scroll-top]").forEach((button) => {
    if (button.dataset.boundTop) return;
    button.dataset.boundTop = "true";
    button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  });

  document.querySelector('form[data-action="api-connect"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await connectApiAccount(event.submitter?.value || "login", new FormData(event.currentTarget));
    } catch (error) {
      setToast(error.message);
    }
  });

  document.querySelectorAll("[data-api-sync]").forEach((button) => {
    button.addEventListener("click", () => syncWorkspaceFromApi());
  });

  document.querySelector("[data-creator-refresh]")?.addEventListener("click", () => {
    loadCreatorDashboard().catch((error) => setToast(error.message));
  });

  document.querySelectorAll("[data-api-disconnect]").forEach((button) => {
    button.addEventListener("click", disconnectApiAccount);
  });

  document.querySelector('form[data-action="add-to-haul"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await addLinkToHaul(event.currentTarget.dataset.linkId, new FormData(event.currentTarget));
    } catch (error) {
      setToast(error.message);
    }
  });

  document.querySelectorAll("[data-edit-link]").forEach((button) => {
    button.addEventListener("click", () => {
      state.draftLinkId = button.dataset.editLink;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete-link]").forEach((button) => {
    button.addEventListener("click", () => {
      if (hasApiSession()) {
        setToast("Delete link API is not available yet.");
        return;
      }
      state.links = state.links.filter((link) => link.id !== button.dataset.deleteLink);
      if (state.draftLinkId === button.dataset.deleteLink) state.draftLinkId = null;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-submit-purchase]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await submitPurchase(button.dataset.submitPurchase);
      } catch (error) {
        setToast(error.message);
      }
    });
  });

  document.querySelectorAll("[data-advance-order]").forEach((button) => {
    button.addEventListener("click", () => advanceOrder(button.dataset.advanceOrder));
  });

  document.querySelectorAll("[data-exception-order]").forEach((select) => {
    select.addEventListener("change", () => markOrderException(select.dataset.exceptionOrder, select.value));
  });

  document.querySelectorAll('form[data-action="approve-qc"]').forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await approveQc(form.dataset.itemId, new FormData(form).get("weight"));
      } catch (error) {
        setToast(error.message);
      }
    });
  });

  document.querySelectorAll("[data-extra-photo]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await requestExtraPhoto(button.dataset.extraPhoto);
      } catch (error) {
        setToast(error.message);
      }
    });
  });

  document.querySelector('form[data-action="submit-parcel"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await submitParcel(new FormData(event.currentTarget));
    } catch (error) {
      setToast(error.message);
    }
  });

  document.querySelectorAll("[data-pay-parcel]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await payParcel(button.dataset.payParcel);
      } catch (error) {
        setToast(error.message);
      }
    });
  });

  document.querySelectorAll("[data-refresh-tracking]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await refreshTracking(button.dataset.refreshTracking);
      } catch (error) {
        setToast(error.message);
      }
    });
  });

  document.querySelector('form[data-action="add-coupon"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await addCoupon(new FormData(event.currentTarget).get("code"));
    } catch (error) {
      setToast(error.message);
    }
  });
}

function formObject(formData) {
  return Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)]));
}

function render() {
  const viewMap = {
    dashboard: ["Dashboard", renderDashboard],
    links: ["Link Intake", renderLinks],
    haul: ["My Haul", renderHaul],
    orders: ["Orders", renderOrders],
    qc: ["QC Center", renderQc],
    shipping: ["Shipping / Parcel", renderShipping],
    wallet: ["Wallet / Coupon", renderWallet],
    creator: ["Creator", renderCreator],
    guide: ["New User Guide", renderGuide],
    community: ["Community", renderCommunity],
    trust: ["Trust Center", renderTrust],
    login: ["Sign in", renderLogin],
    register: ["Create account", renderRegister],
    verifyEmail: ["Verify email", renderVerifyEmail],
    verifyDevice: ["Verify device", renderVerifyDevice],
    account: ["Account settings", renderAccount],
    addresses: ["Addresses", renderAddresses]
  };
  const [title, renderer] = viewMap[currentView] || viewMap.dashboard;
  document.body.dataset.view = currentView;
  pageTitle.textContent = title;
  document.title = `${title} | GOATEDBUY`;
  if (!runtime?.valid) {
    view.innerHTML = `<div class="ui-state error"><i data-lucide="settings"></i><h2>Frontend configuration error</h2><p>${escapeHtml(runtime?.diagnostics?.join(" ") || "Runtime configuration failed to load.")}</p><code>Check app/config.js</code></div>`;
  } else {
    const showBanner = currentView !== "dashboard" && !AUTH_VIEWS.has(currentView) && !["account", "addresses"].includes(currentView);
    view.innerHTML = `${showBanner ? renderApiBanner() : ""}${renderer()}`;
  }
  renderNav();
  renderHeaderControls();
  renderQuickRail();
  attachHandlers();
  renderToast();
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  window.DLV2?.initJourneyMotion(); // Design Language V2 · builds/animates the journey spine when present
}

function renderHeaderControls() {
  const localeSelect = document.querySelector("#locale-select");
  const currencySelect = document.querySelector("#currency-select");
  if (localeSelect) {
    localeSelect.innerHTML = runtimeConfig.enabledLocales.map((locale) => `<option value="${locale}" ${locale === preferences.locale ? "selected" : ""}>${locale}</option>`).join("");
    localeSelect.onchange = () => {
      preferences.locale = localeSelect.value;
      i18n.setLocale(preferences.locale);
      savePreferences();
      render();
    };
  }
  if (currencySelect) {
    currencySelect.innerHTML = runtimeConfig.displayCurrencies.map((currency) => `<option value="${currency}" ${currency === preferences.currency ? "selected" : ""}>${currency}</option>`).join("");
    currencySelect.onchange = () => {
      preferences.currency = currencySelect.value;
      savePreferences();
      if (hasApiSession()) route("account");
    };
  }
}

async function restoreSession() {
  if (!hasApiSession()) return;
  try {
    const payload = await apiRequest("/me", { noRefresh: false });
    apiState.userEmail = payload.user.email;
    apiState.connected = true;
    saveApiState();
  } catch {
    clearApiSession();
    if (PROTECTED_VIEWS.has(currentView)) route("login", { replace: true });
  }
}

document.querySelector("#reset-demo").addEventListener("click", resetWorkspace);
window.addEventListener("hashchange", () => {
  const next = viewFromHash();
  if (next !== currentView) route(next, { replace: true, noScroll: true });
});
const oauthReturn = consumeOAuthRedirect();
route(oauthReturn ? "account" : currentView, { replace: true, instant: true });
loadOAuthProviders().then(() => render());
restoreSession().then(async () => {
  if (oauthReturn) {
    try { await syncWorkspaceFromApi(false); } catch { /* best-effort workspace load */ }
    const meta = OAUTH_DISPLAY.find((p) => p.id === oauthReturn.provider);
    setToast(`Signed in with ${meta ? meta.label : "your account"}.`);
    route("account", { replace: true });
  }
  render();
});
