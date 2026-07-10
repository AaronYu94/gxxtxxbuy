# Frontend API Base URL Switching

The client (`app/app.js`) and admin console (`app/admin.js`) default their API base URL
to `window.GOATEDBUY_API_BASE_URL`, falling back to `http://127.0.0.1:3000`. Users can
still override it in the connect form at runtime.

## Per-environment config

1. Copy `app/config.example.js` to `app/config.js`.
2. Set the base URL for the target environment:
   - staging: `https://staging-api.goatedbuy.example`
   - production: `https://api.goatedbuy.com`
3. Load it before the app script in the HTML:
   ```html
   <script src="./config.js"></script>
   <script src="./app.js"></script>
   ```

`config.js` is environment-specific and should be provided by the deploy pipeline, not
committed. Keep it out of version control (only `config.example.js` is tracked).

## Rollback

Because the base URL lives in a static `config.js`, pointing the frontend back at the
previous API (or to a maintenance host) is a static-asset swap with no rebuild. This
keeps the frontend rollback independent of the API rollback (see rollback-runbook.md).
