// Host-based static dev router for the split surfaces.
//   ops.*  -> internal ops/admin console (admin.html)
//   else   -> buyer client (client.html)   [www.* and bare hosts]
//
// Run:  node app/dev-router.mjs        (PORT defaults to 8080)
// Then map the real hostnames to loopback for local testing (once):
//   sudo sh -c 'printf "127.0.0.1 www.goated-buy.us ops.goated-buy.us\n" >> /etc/hosts'
//   www:  http://www.goated-buy.us:8080
//   ops:  http://ops.goated-buy.us:8080
// Production (domain: goated-buy.us): point DNS www + ops at a host running this
// same host-based routing (or Cloudflare in front of GitHub Pages), and run the
// Express backend at api.goated-buy.us.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url)); // the app/ directory
const PORT = Number(process.env.PORT) || 8080;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json"
};

const isOpsHost = (host) => (host || "").split(":")[0].toLowerCase().startsWith("ops.");
// SURFACE=ops|www forces one surface (for a dedicated per-port instance, no hosts file needed).
const FORCED = (process.env.SURFACE || "").toLowerCase();

const server = http.createServer(async (req, res) => {
  const ops = FORCED === "ops" ? true : FORCED === "www" ? false : isOpsHost(req.headers.host);
  const entry = ops ? "admin.html" : "client.html";
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname === "/" || pathname === "" || pathname === "/index.html") pathname = "/" + entry;

  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403); return res.end("forbidden");
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error("dir");
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    // Unknown path with no file → serve the surface entry (SPA hash-router owns the route).
    try {
      const body = await readFile(join(ROOT, entry));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[dev-router] :${PORT}  ops.* -> admin.html  ·  else -> client.html`);
});
