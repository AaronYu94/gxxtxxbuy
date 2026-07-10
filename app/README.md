# GOATEDBUY Frontend

This is a local frontend build with separated client and backend surfaces.

## Run

From the project root:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Open the surface switcher:

```text
http://127.0.0.1:8080/app/
```

Client workspace:

```text
http://127.0.0.1:8080/app/client.html
```

Admin console:

```text
http://127.0.0.1:8080/app/admin.html
```

The buyer and admin surfaces are static HTML/CSS/JavaScript applications. Runtime endpoints and public presentation defaults are loaded from `config.js`; secrets must never be placed there.

For another environment, start from `config.example.js` and provide an environment-specific `config.js`. The buyer client shows a diagnostic configuration error instead of silently using an invalid API URL.

## Buyer account foundation

- Restorable hash routes for registration, email verification, login, device verification, account settings, and addresses.
- Protected-route redirects that preserve the intended destination without redirect loops.
- Access and refresh tokens stored in `sessionStorage`; account and address PII is kept only in memory.
- An eight-locale framework with English fallback and missing-key diagnostics. Only approved, complete locales belong in `enabledLocales`; the current checked-in build enables English only.
- Integer-minor-unit currency formatting. Display currency preferences do not mutate the CNY accounting ledger.
- Versioned profile and address forms with visible conflict recovery, phone verification state, default-address handling, password rotation, and account-deletion eligibility.
- Shared loading, empty, error, and conflict states verified at desktop, tablet, and mobile widths.

## Product workflow

Client:

- Top global product link search for Taobao, 1688, Weidian/Micro, Yupoo, and other Chinese marketplace links.
- Dashboard with Paste Link entry and a six-step buyer journey.
- Link Intake with saved links and item detail confirmation.
- My Haul with user-facing status groups.
- Orders with local status progression and exception reasons.
- QC Center with 3-5 QC photo placeholders, warehouse weight, and 90-day free storage messaging.
- Shipping / Parcel with combined parcel submission, estimated/final shipping language, and 700+ shipping routes messaging.
- Wallet / Coupon workspace.
- New User Guide and Welcome Gift.
- Community page with Discord and Telegram placeholders.
- Right quick rail for Cart, Telegram, Discord, and Back to top.
- Trust Center with key policy cards.

Admin:

- Backend API login with configurable API base URL.
- Permission-scoped Overview for visible operations queues.
- Procurement order queue with status and exception updates.
- Warehouse / QC read queue.
- Shipping parcel queue with support-role finance redaction.
- Policy CMS list/edit forms backed by `/admin/policies`.

The admin console stores only admin API session state and loads operational data from role-gated backend APIs.
