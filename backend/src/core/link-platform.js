import { badRequest } from "../errors/app-error.js";
import { hashToken } from "../security/token.js";

export function normalizeProductUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    throw badRequest("Product URL is required.", { field: "url" });
  }
  if (value.length > 2048) {
    throw badRequest("Product URL must be 2048 characters or fewer.", { field: "url" });
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw badRequest("Product URL must be valid.", { field: "url" });
  }

  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
    throw badRequest("Product URL must be a valid http(s) URL.", { field: "url" });
  }

  url.hash = "";
  return {
    url: url.toString(),
    urlHash: hashToken(url.toString()),
    domain: url.hostname.replace(/^www\./i, "").toLowerCase(),
    platform: identifyPlatform(url.hostname)
  };
}

export function identifyPlatform(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (/(^|\.)1688\.com$/.test(host) || host.includes("1688.com")) {
    return "1688";
  }
  if (host.includes("weidian.com") || host.includes("koudai.com") || host.includes("vdian.com")) {
    return "Weidian";
  }
  if (host.includes("yupoo.com")) {
    return "Yupoo";
  }
  if (host.includes("taobao.com") || host.includes("tmall.com")) {
    return "Taobao";
  }
  return "Other";
}
