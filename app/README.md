# GOATEDBUY Local Build

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

## Current scope

Client:

- Top global product link search for Taobao, 1688, Weidian/Micro, Yupoo, and other Chinese marketplace links.
- Dashboard with Paste Link entry.
- Link Intake with saved links and item detail confirmation.
- My Haul with user-facing status groups.
- Orders with local status progression and exception reasons.
- QC Center with 3-5 QC photo placeholders, warehouse weight, and 90-day free storage messaging.
- Shipping / Parcel with combined parcel submission, estimated/final shipping language, and 700+ shipping routes messaging.
- Wallet / Coupon with local code entry.
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

The client stores only client session/API workspace state. The admin console stores only admin API session state and loads operational data from role-gated backend APIs.
