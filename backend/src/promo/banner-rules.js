// V2-10-05 — banner asset + link validation (pure).

// A banner is "complete" only when all three device images are present.
export function isComplete(banner) {
  return Boolean(banner && banner.desktopImageKey && banner.tabletImageKey && banner.mobileImageKey);
}

// A redirect link is safe when it is a relative path or an https URL — never a
// javascript:/data: scheme or a bare http URL.
export function isSafeLink(url) {
  if (url == null || url === "") return true; // no link is fine
  const s = String(url).trim();
  if (s.startsWith("/") && !s.startsWith("//")) return true; // relative path
  if (/^https:\/\/[^\s]+$/i.test(s)) return true;
  return false;
}

// Pick the image for a device, falling back to desktop.
export function imageForDevice(banner, device) {
  if (device === "mobile") return banner.mobileImageKey || banner.desktopImageKey;
  if (device === "tablet") return banner.tabletImageKey || banner.desktopImageKey;
  return banner.desktopImageKey;
}

// Is a banner live at nowMs (published + within its schedule window)?
export function isLive(banner, nowMs) {
  if (!banner || banner.status !== "published") return false;
  if (banner.startsAt && nowMs < Date.parse(banner.startsAt)) return false;
  if (banner.endsAt && nowMs > Date.parse(banner.endsAt)) return false;
  return true;
}
