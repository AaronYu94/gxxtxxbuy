// Extracts a structured product reference (marketplace item id) from a saved link URL.
// Pure and offline: short links (m.tb.cn, qr.1688.com) and Taobao password shares need a
// network redirect/resolution, so they are flagged `kind: "short"` for a real adapter to
// resolve later rather than guessed here.
export function extractProductRef({ url, platform }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { platform, itemId: null, kind: "unknown" };
  }
  const host = parsed.hostname.toLowerCase();
  const params = parsed.searchParams;

  if (/(^|\.)tb\.cn$/.test(host) || host.includes("qr.1688.com") || host.includes("k.weidian.com") || host.includes("m.tb.cn")) {
    return { platform, itemId: null, kind: "short" };
  }

  if (platform === "Taobao") {
    const id = params.get("id");
    return { platform, itemId: /^\d+$/.test(id || "") ? id : null, kind: id ? "item" : "unknown" };
  }
  if (platform === "1688") {
    const fromPath = parsed.pathname.match(/\/offer\/(\d+)\.html/);
    const id = fromPath ? fromPath[1] : params.get("offerId");
    return { platform, itemId: /^\d+$/.test(id || "") ? id : null, kind: id ? "item" : "unknown" };
  }
  if (platform === "Weidian") {
    const id = params.get("itemID") || params.get("itemId");
    return { platform, itemId: id || null, kind: id ? "item" : "unknown" };
  }
  if (platform === "Yupoo") {
    const fromPath = parsed.pathname.match(/\/albums\/([\w-]+)/);
    return { platform, itemId: fromPath ? fromPath[1] : null, kind: "album" };
  }
  return { platform, itemId: null, kind: "unknown" };
}

// Heuristic for a Taobao password share ("淘口令"), which arrives as free text rather than
// a URL. Kept for the save flow to detect and route to a resolver in a real adapter.
export function looksLikeTaobaoPassword(text) {
  const value = String(text || "").trim();
  return /[€￥€￥][A-Za-z0-9]{6,}[€￥€￥]/.test(value) || /（.*淘.*）|\(.*taobao.*\)/i.test(value);
}
