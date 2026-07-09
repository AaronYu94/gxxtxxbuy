const STORAGE_KEY = "goatedbuy-workspace-v1";
const API_STORAGE_KEY = "goatedbuy-client-api-v1";
// B8-04: staging/prod API base URL can be injected via window.GOATEDBUY_API_BASE_URL
// (e.g. a small config.js loaded before this file) without editing the source.
const DEFAULT_API_BASE_URL = (typeof window !== "undefined" && window.GOATEDBUY_API_BASE_URL) || "http://127.0.0.1:3000";

const navItems = [
  ["dashboard", "Home", "house"],
  ["shipping", "Shipping Estimation", "calculator"],
  ["haul", "Forwarding", "package-open"],
  ["guide", "Help Center", "circle-help"],
  ["creator", "Affiliate", "badge-percent"]
];

const journey = [
  "Paste Link",
  "We Buy",
  "Warehouse Arrival",
  "QC Photos",
  "Build Haul",
  "Choose Shipping",
  "Track Parcel",
  "Delivered"
];

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
let currentView = "dashboard";

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
    return { ...defaultApiState(), ...JSON.parse(localStorage.getItem(API_STORAGE_KEY) || "{}") };
  } catch {
    return defaultApiState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveApiState() {
  localStorage.setItem(API_STORAGE_KEY, JSON.stringify(apiState));
}

function hasApiSession() {
  return Boolean(apiState.accessToken);
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
      ...(apiState.accessToken ? { authorization: `Bearer ${apiState.accessToken}` } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.error?.message || `API request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function connectApiAccount(mode, formData) {
  const submittedBaseUrl = formData.get("baseUrl");
  if (typeof submittedBaseUrl === "string" && submittedBaseUrl.trim()) {
    apiState.baseUrl = submittedBaseUrl.trim().replace(/\/+$/, "");
  }
  apiState.loading = true;
  apiState.error = "";
  saveApiState();
  render();

  try {
    const payload = await apiRequest(mode === "register" ? "/auth/register" : "/auth/login", {
      method: "POST",
      body: {
        email: formData.get("email"),
        password: formData.get("password")
      }
    });
    apiState.accessToken = payload.session.access_token;
    apiState.refreshToken = payload.session.refresh_token;
    apiState.userEmail = payload.user.email;
    apiState.connected = true;
    apiState.error = "";
    saveApiState();
    await syncWorkspaceFromApi(false);
    setToast(mode === "register" ? "API account registered." : "API account connected.");
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

function disconnectApiAccount() {
  apiState = defaultApiState();
  saveApiState();
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
  render();
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
  nav.innerHTML = navItems.map(([id, label, icon]) => `
    <button class="${id === currentView ? "active" : ""}" data-route="${id}">
      <i data-lucide="${icon}" aria-hidden="true"></i>
      <span class="nav-label">${label}</span>
      ${countMap[id] ? `<span class="count">${countMap[id]}</span>` : ""}
    </button>
  `).join("");
  nav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => route(button.dataset.route));
  });
}

function route(id) {
  currentView = id;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  const nextAction = nextActionMarkup();
  return `
    <div class="home-page">
      <section class="home-hero">
        <div class="hero-copy">
          <span class="hero-kicker"><i data-lucide="package-open" aria-hidden="true"></i>One link. One warehouse. Your world.</span>
          <div>
            <h2>Shop China.<br><em>Ship your way.</em></h2>
            <p>Paste any product link. We buy it, inspect it at our China warehouse, combine your haul, and send it worldwide.</p>
          </div>
          <form class="hero-search" data-action="paste">
            <i data-lucide="link-2" aria-hidden="true"></i>
            <input name="url" type="url" placeholder="Paste a Taobao, 1688, Weidian or Yupoo link" aria-label="Item link">
            <button class="primary-button" type="submit"><i data-lucide="search" aria-hidden="true"></i>Start order</button>
            <button class="save-link-button" type="button" data-save-link title="Save link" aria-label="Save link"><i data-lucide="bookmark" aria-hidden="true"></i></button>
          </form>
          <div class="platform-row">
            <span>Works with</span>
            ${["Taobao", "1688", "Weidian", "Yupoo"].map((label) => `<strong>${label}</strong>`).join("")}
          </div>
          <div class="hero-actions">
            <button type="button" data-route-button="guide"><i data-lucide="play-circle" aria-hidden="true"></i>How it works</button>
            <button type="button" data-welcome-gift><i data-lucide="gift" aria-hidden="true"></i>Welcome gift</button>
          </div>
        </div>
      </section>

      <section class="proof-strip" aria-label="Service highlights">
        <div><i data-lucide="camera" aria-hidden="true"></i><span><strong>3-5 QC photos</strong> before you ship</span></div>
        <div><i data-lucide="warehouse" aria-hidden="true"></i><span><strong>90 days</strong> free storage</span></div>
        <div><i data-lucide="route" aria-hidden="true"></i><span><strong>700+ routes</strong> across the world</span></div>
        <div><i data-lucide="layers-3" aria-hidden="true"></i><span><strong>One parcel</strong> from many orders</span></div>
      </section>

      <section class="home-section services-section">
        <div class="section-heading">
          <span class="section-index">01</span>
          <div>
            <p class="eyebrow">From checkout to doorstep</p>
            <h2>Everything your haul needs</h2>
          </div>
          <p>Clear checkpoints, visible costs, and control at every stage.</p>
        </div>
        <div class="service-grid">
          <article class="service-card service-buy">
            <div class="service-icon"><i data-lucide="mouse-pointer-click" aria-hidden="true"></i></div>
            <span>BUY</span>
            <h3>Paste it. We purchase it.</h3>
            <p>Submit links from leading Chinese marketplaces and track each order from one workspace.</p>
            <button type="button" data-route-button="links">Submit a link <i data-lucide="arrow-up-right" aria-hidden="true"></i></button>
          </article>
          <article class="service-card service-qc">
            <div class="service-icon"><i data-lucide="scan-search" aria-hidden="true"></i></div>
            <span>CHECK</span>
            <h3>See it before it leaves.</h3>
            <p>Review warehouse weight and detailed QC photos before approving an item for shipping.</p>
            <button type="button" data-route-button="qc">Open QC Center <i data-lucide="arrow-up-right" aria-hidden="true"></i></button>
          </article>
          <article class="service-card service-ship">
            <div class="service-icon"><i data-lucide="package-check" aria-hidden="true"></i></div>
            <span>SHIP</span>
            <h3>Build one smarter parcel.</h3>
            <p>Combine ready items, compare international routes, pay, and follow tracking updates.</p>
            <button type="button" data-route-button="shipping">Plan shipping <i data-lucide="arrow-up-right" aria-hidden="true"></i></button>
          </article>
        </div>
      </section>

      <section class="home-section process-section">
        <div class="section-heading process-heading">
          <span class="section-index">02</span>
          <div>
            <p class="eyebrow">China to your doorstep</p>
            <h2>One journey. Six clear moves.</h2>
          </div>
          <p>Follow the parcel from the first product search to final delivery, with every payment, photo, and status in one place.</p>
        </div>
        <div class="journey-lane" aria-hidden="true">
          <span><i data-lucide="search" aria-hidden="true"></i>China marketplaces</span>
          <div><i data-lucide="chevrons-right" aria-hidden="true"></i></div>
          <strong>GOATEDBUY ROUTE 01</strong>
          <div><i data-lucide="chevrons-right" aria-hidden="true"></i></div>
          <span><i data-lucide="map-pin" aria-hidden="true"></i>220+ countries</span>
        </div>
        <div class="process-track">
          ${[
            ["search", "Search and Match", "搜索商品", ["Search across platforms and suppliers", "Paste Taobao and other product links", "Match and import product details"]],
            ["credit-card", "Pay for Goods", "支付商品", ["Choose the product specification", "Add to cart or buy directly", "Pay with multiple payment methods"]],
            ["handshake", "Order Reception and Transfer", "采购与转运", ["One-to-one purchasing agent service", "We complete the purchase for you", "Seller ships to our China warehouse"]],
            ["scan-search", "Quality Check and Warehousing", "质检与入库", ["Warehouse inspection after arrival", "Approved goods enter free storage", "Defects are reported with QC photos"]],
            ["plane", "Submit International Shipping", "提交国际运输", ["Confirm and combine your parcel", "Pay the international shipping fee", "700+ routes to 220+ countries", "Follow real-time tracking updates"]],
            ["layout-dashboard", "Efficient Management", "订单管理", ["View every order and payment status", "Track international logistics", "Monitor warehouse status", "Contact customer service in one place"]]
          ].map(([icon, title, chineseTitle, details], index) => `
            <article class="process-step process-step-${index + 1}">
              <div class="process-step-head">
                <span class="process-number">${String(index + 1).padStart(2, "0")}</span>
                <span class="process-icon"><i data-lucide="${icon}" aria-hidden="true"></i></span>
                <span class="process-status">${index < 4 ? "CHINA" : "GLOBAL"}</span>
              </div>
              <h3>${title}<small>${chineseTitle}</small></h3>
              <ul>
                ${details.map((detail) => `<li>${detail}</li>`).join("")}
              </ul>
              ${index < 5 ? `<span class="process-connector" aria-hidden="true"><i data-lucide="arrow-right"></i></span>` : ""}
            </article>
          `).join("")}
        </div>
      </section>

      <section class="home-section action-section">
        <div class="next-action-copy">
          <span class="section-index">03</span>
          <div>
            <p class="eyebrow">Your workspace</p>
            <h2>Keep the next move obvious.</h2>
          </div>
        </div>
        <div class="next-action">${nextAction}</div>
        <div class="workspace-metrics">
          <div><strong>${c.links}</strong><span>Saved links</span></div>
          <div><strong>${c.haul}</strong><span>Haul items</span></div>
          <div><strong>${c.orders}</strong><span>Orders</span></div>
          <div><strong>${c.parcels}</strong><span>Parcels</span></div>
        </div>
      </section>

      <section class="community-banner">
        <div>
          <i data-lucide="messages-square" aria-hidden="true"></i>
          <div><span>GOATEDBUY COMMUNITY</span><h2>First haul questions are welcome.</h2><p>Talk through QC details, shipping routes, and parcel planning with other buyers.</p></div>
        </div>
        <button class="light-button" type="button" data-route-button="community">Explore community <i data-lucide="arrow-right" aria-hidden="true"></i></button>
      </section>
    </div>
  `;
}

function renderGuide() {
  return `
    <div class="grid two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>New User Guide</h2>
            <p class="subtle">A simple flow for first-time China shopping agent users.</p>
          </div>
        </div>
        <div class="timeline">
          ${[
            "Paste a Taobao / 1688 / Weidian link",
            "GOATEDBUY purchases the item",
            "Seller ships to the China warehouse",
            "Warehouse takes 3-5 QC photos and weighs it",
            "You combine arrived items into one parcel",
            "Choose from 700+ international shipping routes",
            "Pay final international shipping",
            "Track the parcel overseas"
          ].map((step, index) => `<div class="step"><b>${index + 1}</b><span>${step}</span></div>`).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Welcome Gift</h2>
            <p class="subtle">Claim a local demo shipping coupon. In production this connects to coupon APIs and eligibility rules.</p>
          </div>
        </div>
        <article class="card">
          <div class="card-head">
            <div>
              <h3>WELCOME10</h3>
              <p class="subtle">$8 demo shipping coupon for eligible lines.</p>
            </div>
            <span class="status good">New user</span>
          </div>
          <div class="actions">
            <button class="primary-button" data-welcome-gift>Claim Welcome Gift</button>
            <button class="secondary-button" data-route-button="wallet">Open Wallet</button>
          </div>
        </article>
        <article class="card" style="margin-top:12px">
          <h3>Storage benefit</h3>
          <p class="subtle">Items get 90 days of free warehouse storage after arrival, so users can wait for multiple items and submit one combined parcel.</p>
        </article>
      </section>
    </div>
  `;
}

function renderCommunity() {
  return `
    <div class="grid two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Community</h2>
            <p class="subtle">Get first-haul help, QC discussion, and shipping questions without turning GOATEDBUY into an official finds shelf.</p>
          </div>
        </div>
        <div class="list">
          <article class="card">
            <div class="card-head">
              <div>
                <h3>Discord</h3>
                <p class="subtle">Join first-haul-help, qc-help, shipping-help, haul-reviews, and creator-codes channels.</p>
              </div>
              <span class="status good">Community</span>
            </div>
            <div class="actions">
              <a class="primary-button" href="https://discord.com" target="_blank" rel="noreferrer">Join Discord</a>
            </div>
          </article>
          <article class="card">
            <div class="card-head">
              <div>
                <h3>Telegram</h3>
                <p class="subtle">Quick updates and shipping notices. Production should use the official configured channel.</p>
              </div>
              <span class="status warn">Placeholder</span>
            </div>
            <div class="actions">
              <a class="secondary-button" href="https://telegram.org" target="_blank" rel="noreferrer">Open Telegram</a>
            </div>
          </article>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Boundary</h2>
            <p class="subtle">Community links and creator shares are third-party content.</p>
          </div>
        </div>
        <div class="policy-grid">
          <article class="card"><h3>No official finds</h3><p class="subtle">The client can discuss links, but GOATEDBUY does not officially recommend or endorse products.</p></article>
          <article class="card"><h3>Workflow first</h3><p class="subtle">GOATEDBUY focuses on purchasing, warehouse handling, QC photos, consolidation, shipping, and support.</p></article>
        </div>
      </section>
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
    <div class="grid two">
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
    <div class="grid">
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
    <section class="panel">
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
    </section>
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
    <section class="panel">
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
    </section>
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
    <div class="grid two">
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
    <div class="grid two">
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
      <section class="panel">
        <div class="panel-head"><div><h2>Creator</h2><p class="subtle">Creator dashboards load from the live backend. Connect an API account to view your attribution.</p></div></div>
        ${empty("Not connected", "Connect a backend API account above to load your creator dashboard.")}
      </section>
    `;
  }
  const creator = state.creator || { loaded: false, error: "", data: null };
  const body = creator.error
    ? empty("Dashboard unavailable", creator.error)
    : creator.data
      ? renderCreatorDashboard(creator.data)
      : empty("No data yet", creator.loaded ? "No creator dashboard is linked to this account." : "Load your dashboard to see aggregate attribution counts.");
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Creator Dashboard</h2>
          <p class="subtle">Aggregate attribution only. Buyer addresses, order details, and QC are never shown here.</p>
        </div>
        <button class="ghost" data-creator-refresh>${creator.loaded ? "Refresh" : "Load dashboard"}</button>
      </div>
      ${body}
    </section>
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
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Trust Center</h2>
          <p class="subtle">Rules stay accessible from key workflow pages and keep GOATEDBUY's neutral agent boundary clear.</p>
        </div>
      </div>
      <div class="policy-grid">
        ${cards.map(([title, body]) => `
          <article class="card">
            <h3>${escapeHtml(title)}</h3>
            <p class="subtle" style="margin-top:8px">${escapeHtml(body)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
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
          <button class="danger-button" type="button" data-api-disconnect>Disconnect</button>
        </div>
      ` : `
        <form class="api-form" data-action="api-connect">
          <input name="email" type="email" placeholder="buyer@example.com" aria-label="Email">
          <input name="password" type="password" placeholder="Password" aria-label="Password">
          <button class="primary-button" type="submit" name="mode" value="login" ${apiState.loading ? "disabled" : ""}>Sign in</button>
          <button class="secondary-button" type="submit" name="mode" value="register" ${apiState.loading ? "disabled" : ""}>Register</button>
        </form>
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

  document.querySelector("[data-focus-paste]")?.addEventListener("click", () => {
    route("dashboard");
    setTimeout(() => document.querySelector('input[name="url"]')?.focus(), 0);
  });

  document.querySelectorAll("[data-focus-account]").forEach((button) => {
    if (button.dataset.boundAccount) return;
    button.dataset.boundAccount = "true";
    button.addEventListener("click", () => {
      if (currentView === "dashboard") route("wallet");
      document.querySelector(".api-banner")?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => document.querySelector('.api-form input[name="email"]')?.focus(), 350);
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
    trust: ["Trust Center", renderTrust]
  };
  const [title, renderer] = viewMap[currentView] || viewMap.dashboard;
  document.body.dataset.view = currentView;
  pageTitle.textContent = title;
  view.innerHTML = currentView === "dashboard" ? renderer() : `${renderApiBanner()}${renderer()}`;
  renderNav();
  renderQuickRail();
  attachHandlers();
  renderToast();
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

document.querySelector("#reset-demo").addEventListener("click", resetWorkspace);
render();
