// V2-10-17/19 — operations & support back-office logic (pure). Supplies the
// pagination policy (default 20, opt-in 50/100), the per-role dashboard stat cards
// (nine roles), card-link filter preservation, and zero-safe display. No role sees
// an aggregate it isn't entitled to; customer service's home is search-only.
(function initOpsConsole(global) {
  var ALLOWED_PAGE_SIZES = [20, 50, 100];
  function pageSize(requested) {
    var n = Number(requested);
    return ALLOWED_PAGE_SIZES.indexOf(n) >= 0 ? n : 20; // default 20, never "all"
  }

  // Stat cards per role. Customer service gets a search entry only (no aggregates).
  var ROLE_CARDS = {
    super_admin: ["orders", "revenue", "parcels", "after_sales", "refunds", "risk", "coupons", "campaigns", "support"],
    procurement_lead: ["orders_to_review", "purchasing", "dispatch_pending", "exceptions"],
    procurement_agent: ["my_tasks", "purchasing"],
    warehouse_lead: ["inbound_pending", "qc_pending", "packing", "outbound"],
    warehouse_operator: ["my_qc", "my_picking"],
    finance_operator: ["topups", "withdrawals", "adjustments", "refunds", "lock_requests"],
    campaign_operator: ["coupons", "banners", "email_campaigns"],
    referral_operator: ["referrals", "commissions"],
    support_agent: [] // search-only home
  };

  function dashboardCards(role) { return (ROLE_CARDS[role] || []).slice(); }
  function isSearchOnlyHome(role) { return role === "support_agent"; }

  // A card link preserves the current time/scope filters so a drill-down keeps context.
  function cardLink(cardKey, filters) {
    filters = filters || {};
    var params = [];
    if (filters.from) params.push("from=" + encodeURIComponent(filters.from));
    if (filters.to) params.push("to=" + encodeURIComponent(filters.to));
    if (filters.scope) params.push("scope=" + encodeURIComponent(filters.scope));
    return "/admin/" + cardKey + (params.length ? "?" + params.join("&") : "");
  }

  // Zero renders as "0", never blank (a real zero is information).
  function statValue(n) { return (n == null || isNaN(Number(n))) ? "0" : String(Number(n)); }

  // A role can only see aggregates for the cards it owns.
  function canSeeCard(role, cardKey) { return dashboardCards(role).indexOf(cardKey) >= 0; }

  global.GoatedBuyOpsConsole = Object.freeze({
    pageSize: pageSize,
    ALLOWED_PAGE_SIZES: ALLOWED_PAGE_SIZES,
    dashboardCards: dashboardCards,
    isSearchOnlyHome: isSearchOnlyHome,
    cardLink: cardLink,
    statValue: statValue,
    canSeeCard: canSeeCard
  });
})(typeof window !== "undefined" ? window : this);
