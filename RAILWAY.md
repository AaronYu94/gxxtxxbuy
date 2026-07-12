# Deploy on Railway — goated-buy.us

Railway gives each service its own TLS + domain and offers managed Postgres/Redis,
so we don't use `Caddyfile` / `docker-compose.prod.yml` here (those are for a single VPS).

**Shape: 2 services + 2 database plugins, all in one Railway project.**

| Railway service | What | Custom domain(s) |
|---|---|---|
| **web** | static buyer client + ops console via `app/dev-router.mjs` (routes by Host) | `www.goated-buy.us`, `goated-buy.us`, `ops.goated-buy.us` |
| **backend** | Express API (from `backend/Dockerfile`) | `api.goated-buy.us` |
| **Postgres** (plugin) | database | — |
| **Redis** (plugin) | cache/queue | — |

The `web` service has **no dependencies** (dev-router uses only Node built-ins) and reads Railway's injected `$PORT`. The host-based router serves `admin.html` for `ops.*` and `client.html` for everything else — so one service covers both surfaces.

---

## 1. Create the project
1. Railway → **New Project → Deploy from GitHub repo** → pick `AaronYu94/gxxtxxbuy`.
2. Add **Database → PostgreSQL** and **Database → Redis** (both managed plugins).

## 2. `backend` service
- **Settings → Root Directory:** `backend` (Railway will use `backend/Dockerfile`).
- **Variables** (Railway reference syntax pulls from the plugins):
  ```
  NODE_ENV=production
  DATABASE_URL=${{Postgres.DATABASE_URL}}
  REDIS_URL=${{Redis.REDIS_URL}}
  READY_REQUIRES_DATABASE=true
  READY_REQUIRES_REDIS=true
  CORS_ALLOWED_ORIGINS=https://goated-buy.us,https://www.goated-buy.us,https://ops.goated-buy.us
  STORAGE_PUBLIC_BASE_URL=https://api.goated-buy.us
  AUTH_TOTP_ISSUER=GoatedBuy
  AUTH_DEVICE_HMAC_SECRET=<openssl rand -hex 32>
  AUTH_TOTP_ENCRYPTION_SECRET=<openssl rand -hex 32>
  ACCOUNT_ADDRESS_HMAC_SECRET=<openssl rand -hex 32>
  STORAGE_SIGNING_SECRET=<openssl rand -hex 32>
  SHIPPING_WEBHOOK_SECRET=<openssl rand -hex 32>
  ```
- **Settings → Networking → Custom Domain:** add `api.goated-buy.us`.
- Admin login uses **real TOTP 2FA** here (the dev bypass is force-off when `NODE_ENV=production`).

## 3. `web` service
- Add a **second service → from the same repo**.
- **Settings → Root Directory:** `/` (repo root). Railway detects the root `package.json`; start command is `npm start` → `node app/dev-router.mjs`.
- **Custom Domains:** add all three: `www.goated-buy.us`, `goated-buy.us`, `ops.goated-buy.us`.
  - The router keys off the `Host` header, so all three point at this one service.
  - *If Railway ever normalizes Host and ops/www stop separating:* split into two `web` services and set `SURFACE=ops` on one, `SURFACE=www` on the other (the router honors that env var).

## 4. DNS
For each custom domain Railway shows a **CNAME target** (e.g. `xxxx.up.railway.app`). Add at your registrar:
```
CNAME  www   -> <railway target for web>
CNAME  ops   -> <railway target for web>
CNAME  api   -> <railway target for backend>
@ (apex)     -> use your registrar's ALIAS/ANAME to the web target, or a redirect to www
```
Railway issues TLS automatically once DNS resolves.

## 5. Initialize DB + first admin
Install the Railway CLI (`npm i -g @railway/cli`, `railway login`, `railway link`), then run inside the backend service context:
```bash
railway run --service backend npm run migrate
railway run --service backend npm run seed:rbac
ADMIN_EMAIL=you@goated-buy.us ADMIN_PASSWORD='a-strong-password' \
  railway run --service backend node scripts/create-admin.mjs
```

## 6. Verify
- `https://www.goated-buy.us` → buyer client
- `https://ops.goated-buy.us` → admin login (API base auto-resolves to `https://api.goated-buy.us`)
- `https://api.goated-buy.us/health` → `{"status":"ok"}`

## Cost (rough, verify current)
Railway is usage-based (~$5/mo Hobby credit). Two small services + Postgres + Redis on light traffic typically lands around **$5–15/mo**. The `web` service is tiny (static, no deps); backend + Postgres are the main draw.

## Client API base
The buyer client reads its API URL from `app/config.js` (gitignored, per-env). Set it to `https://api.goated-buy.us` in that file before/at deploy. (The admin console already auto-resolves it.)
