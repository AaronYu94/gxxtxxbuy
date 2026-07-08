---
origin: inferred
sources: session:019f3ef9-718c-7d11-bfee-0a61e5ad8c6f
generated_ts: 1783483226
model: openrouter:anthropic/claude-4.5-haiku-20251001
---
# Client Application Home Page and Workbench

## Purpose

The web client provides users with a unified interface to browse, purchase, and manage proxy shopping orders. The home page serves as the primary entry point, offering both discoverability for new users and quick access to core workflows.

## Key components

**Home page**

- Global search bar at top: accepts Taobao, 1688, or WeChat Shop links for direct checkout
- New User Guide entry point
- Welcome Gift promotion: one-click wallet credit distribution for new users
- Community links: Discord and Telegram
- Right sidebar shortcuts: shopping cart, Telegram, Discord, scroll-to-top

**Workbench modules**

- **My Haul**: displays active proxy shopping orders and their progress through the fulfillment pipeline (merchant shipment → warehouse arrival → quality check → awaiting consolidation)
- **QC 质检** (Quality Check): not recorded

## Current state

Deployed and accessible at `http://127.0.0.1:8080/app/client.html`. Home page features and My Haul module are implemented. QC module exists but details not recorded.

Source: Session update on client deployment and interface review

```
Type: system
Domain: Client Application
Summary: Web client home page and workbench now deployed with search, user onboarding, and order tracking.
Status: current
Relation: part of -> P1 V1.0 Launch Execution Package
```
