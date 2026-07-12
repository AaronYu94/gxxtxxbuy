# Railway deploy — goated-buy.us

Live deployment record + operations. Project **`goatedbuy`** (id `daec256f-a8c1-4033-b6cf-c28e2a2a1244`), workspace *HANWEN YU's Projects*, environment `production`.

## Architecture (2 services + 2 database plugins)

| Service | Source | Build | Runs | Domains |
|---|---|---|---|---|
| **web** | GitHub `main`, root `/` | Nixpacks (root `package.json`) | `node app/dev-router.mjs` — host routing: `ops.*`→admin.html, else→client.html | `www` + `ops`.goated-buy.us |
| **backend** | GitHub `main`, **root `backend`** | `backend/Dockerfile` | `node src/server.js` (Express) | `api`.goated-buy.us |
| **Postgres** (plugin) | — | — | postgres 18 (`DATABASE_URL` internal) | — |
| **Redis** (plugin) | — | — | redis 8 (`REDIS_URL` internal) | — |

Both app services are connected to GitHub with **auto-deploy on push** — `git push origin main` redeploys both. No CLI needed for routine updates.

### Two gotchas that were solved (keep in mind)
1. **backend root directory must be `backend`.** `railway up` and GitHub builds default to the repo root (which has a `package.json` → dev-router). Set the backend service's **Settings → Source → Root Directory = `backend`** (dashboard only; the CLI has no flag for it). Symptom if wrong: backend logs show `[dev-router] ...` instead of `event="server_started"`.
2. **Manual `railway up` for the backend must use `--path-as-root`:** `railway up ./backend --path-as-root --service backend` (plain `railway up` uploads the project root).

## DNS — the remaining manual step (at the registrar)
Each subdomain needs **a CNAME + a TXT** (Railway ownership verify), then Railway auto-issues TLS:
```
CNAME  api   50emg8x1.up.railway.app
TXT    _railway-verify.api   railway-verify=def6e2142f9cc0861c1dc0312bab68351296c3f010c8a085fa2a0e1ca9b74cf3

CNAME  www   v86sm7lc.up.railway.app
TXT    _railway-verify.www   railway-verify=564af1fcecc44ce80b90b8306618127605cb7c402b0b78cba0657236b4f442c4

CNAME  ops   jjgbqn8j.up.railway.app
TXT    _railway-verify.ops   railway-verify=a764edf424100ee7bed9d7e2d8374916ddea03449e37eaabc4d268df7739a34c
```
**apex `goated-buy.us`** hit the plan's custom-domains-per-service limit → either upgrade the Railway plan, or use `www` + a registrar redirect `goated-buy.us → www.goated-buy.us`.

(If Railway rotates a CNAME/TXT target, re-read it: `railway domain list --service <svc>` / `railway domain <domain> --service <svc>`.)

## Database init (already done; re-run is idempotent)
Railway's `DATABASE_URL` is internal (`postgres.railway.internal`), unreachable from a laptop. Use the **public** URL from the Postgres plugin's Connect tab (or `railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL`):
```bash
cd backend
DBURL='<DATABASE_PUBLIC_URL>'
DATABASE_URL="$DBURL" npm run migrate
DATABASE_URL="$DBURL" npm run seed:rbac
DATABASE_URL="$DBURL" ADMIN_EMAIL=admin@goated-buy.us ADMIN_PASSWORD='<strong>' node scripts/create-admin.mjs
```
Admin login uses **real TOTP 2FA** in production (dev bypass is force-off when `NODE_ENV=production`); first login prompts authenticator setup.

## Verify (after DNS resolves)
```
https://api.goated-buy.us/health   -> {"status":"ok"}
https://api.goated-buy.us/ready    -> {"status":"ready", postgres ok, redis ok}
https://www.goated-buy.us          -> buyer client
https://ops.goated-buy.us          -> admin login
```
Without DNS, check the service directly: `railway logs --service backend` should show `event="server_started"`.

## Backend env vars (set on the backend service)
`NODE_ENV=production`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`, `READY_REQUIRES_DATABASE=true`, `READY_REQUIRES_REDIS=true`, `CORS_ALLOWED_ORIGINS=https://goated-buy.us,https://www.goated-buy.us,https://ops.goated-buy.us`, `STORAGE_PUBLIC_BASE_URL=https://api.goated-buy.us`, `AUTH_TOTP_ISSUER=GoatedBuy`, and the five `openssl rand -hex 32` secrets (`AUTH_DEVICE_HMAC_SECRET`, `AUTH_TOTP_ENCRYPTION_SECRET`, `ACCOUNT_ADDRESS_HMAC_SECRET`, `STORAGE_SIGNING_SECRET`, `SHIPPING_WEBHOOK_SECRET`).

## Notes / follow-ups
- **File storage is ephemeral.** `STORAGE_DRIVER` defaults to `local` — files written in the container are lost on redeploy. Before enabling QC-photo uploads, add a Railway **Volume** to the backend (mounted at the storage dir) or switch to S3.
- **Client API base** auto-resolves: the client reads `config.js`, which the dev-router falls back to `config.example.js` when absent; that file selects `https://api.goated-buy.us` on `*.goated-buy.us` and `127.0.0.1:3000` locally.
- **Healthcheck (optional):** set the backend service Healthcheck Path to `/health` for auto-restart on unhealthy.
- Secrets (admin password, generated env secrets) are **not** stored in this repo.

---

## From scratch (reproduce this deploy via CLI)
```bash
npm i -g @railway/cli && railway login
railway init --name goatedbuy --workspace "<workspace>"
railway add --database postgres
railway add --database redis
# backend
railway add --service backend --variables 'NODE_ENV=production' --variables 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --variables 'REDIS_URL=${{Redis.REDIS_URL}}' --variables 'READY_REQUIRES_DATABASE=true' --variables 'READY_REQUIRES_REDIS=true' \
  --variables 'CORS_ALLOWED_ORIGINS=https://goated-buy.us,https://www.goated-buy.us,https://ops.goated-buy.us' \
  --variables 'STORAGE_PUBLIC_BASE_URL=https://api.goated-buy.us' --variables 'AUTH_TOTP_ISSUER=GoatedBuy' \
  --variables "AUTH_DEVICE_HMAC_SECRET=$(openssl rand -hex 32)" --variables "AUTH_TOTP_ENCRYPTION_SECRET=$(openssl rand -hex 32)" \
  --variables "ACCOUNT_ADDRESS_HMAC_SECRET=$(openssl rand -hex 32)" --variables "STORAGE_SIGNING_SECRET=$(openssl rand -hex 32)" \
  --variables "SHIPPING_WEBHOOK_SECRET=$(openssl rand -hex 32)"
railway up ./backend --path-as-root --service backend
railway domain api.goated-buy.us --service backend
# web
railway add --service web
railway up --service web            # uploads repo root -> dev-router
railway domain www.goated-buy.us --service web
railway domain ops.goated-buy.us --service web
# enable CD (then set backend Root Directory = backend in the dashboard)
railway service source connect --repo AaronYu94/gxxtxxbuy --branch main --service web
railway service source connect --repo AaronYu94/gxxtxxbuy --branch main --service backend
```
