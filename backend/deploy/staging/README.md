# Staging Deployment

Minimal B0 staging URL:

```text
http://127.0.0.1:3091
```

Smoke deploy without Docker:

```bash
cd backend
npm run staging:smoke
```

This starts the service with `NODE_ENV=staging`, verifies:

- `GET /health`
- `GET /version`

It then writes:

- `deploy/staging/last-smoke.json`
- `deploy/staging/current-release.json`

Docker staging deploy:

```bash
cd backend
STAGING_IMAGE=registry.example/goatedbuy-backend:2026-07-08 docker compose -f deploy/staging/docker-compose.staging.yml up -d
```

Scripted deploy:

```bash
cd backend
STAGING_IMAGE=registry.example/goatedbuy-backend:2026-07-08 node scripts/deploy-staging.mjs --deploy
```

Rollback to previous image:

```bash
cd backend
ROLLBACK_IMAGE=registry.example/goatedbuy-backend:previous npm run staging:rollback
```
