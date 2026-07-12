# Deploy — goated-buy.us (single server, all-in-one)

One host runs everything via Docker Compose:

| Hostname | Serves | Behind |
|---|---|---|
| `www.goated-buy.us`, `goated-buy.us` | Buyer client (`app/client.html`) | Caddy (static) |
| `ops.goated-buy.us` | Ops / admin console (`app/admin.html`) | Caddy (static) |
| `api.goated-buy.us` | Express backend | Caddy → `backend:3000` |

Caddy terminates TLS and auto-provisions Let's Encrypt certs for all three. Postgres + Redis run as containers with persistent volumes.

## 1. DNS (at your registrar / Cloudflare)

Point all four names at the server's public IP (`A` records; set Cloudflare proxy to **DNS-only / grey-cloud** so Caddy can issue certs, or use Cloudflare's own TLS):

```
A   @      <SERVER_IP>
A   www    <SERVER_IP>
A   ops    <SERVER_IP>
A   api    <SERVER_IP>
```

## 2. Server prerequisites

- A Linux VPS (e.g. Ubuntu 22.04+), ports **80** and **443** open.
- Docker + Docker Compose plugin:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## 3. Configure

```bash
git clone https://github.com/AaronYu94/gxxtxxbuy.git && cd gxxtxxbuy
cp .env.prod.example .env
# generate secrets:  openssl rand -hex 32   (one per AUTH_*/STORAGE_/SHIPPING_ secret)
# set a strong POSTGRES_PASSWORD and keep it identical inside DATABASE_URL
nano .env
```

## 4. Launch

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 5. Initialize the database + first admin

```bash
docker compose -f docker-compose.prod.yml exec backend npm run migrate
docker compose -f docker-compose.prod.yml exec backend npm run seed:rbac
docker compose -f docker-compose.prod.yml exec \
  -e ADMIN_EMAIL=you@goated-buy.us -e ADMIN_PASSWORD='a-strong-password' \
  backend node scripts/create-admin.mjs
```

## 6. Verify

- `https://www.goated-buy.us` → buyer client
- `https://ops.goated-buy.us` → admin login (API base auto-defaults to `https://api.goated-buy.us`)
- `https://api.goated-buy.us/health` → `{"status":"ok"}`

Admin login uses **real TOTP 2FA in production** (the dev password-only bypass is force-disabled by `NODE_ENV=production`), so the first login walks through authenticator setup.

## Notes

- **Client API base**: the buyer client reads its API URL from `app/config.js` (gitignored, per-env). Set it to `https://api.goated-buy.us` on the server.
- **Storage / payments / marketplace providers**: still `not_configured` — wire real providers via env before real transactions (see `backend/.env.example`).
- **Updates**: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.
- **Backups**: the Postgres data lives in the `pgdata` volume; snapshot it (or use `backend` `npm run db:backup`).
