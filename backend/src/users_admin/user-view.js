// V2-09-02 — role-tailored user detail. Each back-office role sees only the fields
// and tabs it needs. Identity proofs are never part of a normal user detail (there
// is no identity-document field in the normal user record by design). Contact
// details are masked unless the role is explicitly allowed to see them in full.

// Tab visibility per role.
const ROLE_TABS = Object.freeze({
  super_admin: ["overview", "orders", "parcels", "wallet", "emails", "risk", "logins", "addresses", "after_sales", "tags"],
  finance_operator: ["overview", "orders", "wallet", "risk", "after_sales"],
  support_agent: ["overview", "orders", "parcels", "emails", "addresses", "after_sales"],
  campaign_operator: ["overview", "tags"],
  referral_operator: ["overview"],
  procurement_agent: ["overview", "orders"],
  procurement_lead: ["overview", "orders"],
  warehouse_operator: ["overview", "parcels"],
  warehouse_lead: ["overview", "parcels"]
});

// Whether a role may see contact details (email/phone) in the clear.
const ROLE_SEES_CONTACT = Object.freeze({
  super_admin: true, support_agent: true, finance_operator: false, campaign_operator: false, referral_operator: false
});

export function tabsForRole(role) {
  return (ROLE_TABS[role] || ["overview"]).slice();
}

export function roleCanSeeTab(role, tab) {
  return tabsForRole(role).includes(tab);
}

export function maskEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return "";
  const [name, domain] = email.split("@");
  const head = name.slice(0, 2);
  return `${head}${name.length > 2 ? "***" : ""}@${domain}`;
}

export function maskPhone(phone) {
  if (!phone) return "";
  const s = String(phone);
  if (s.length <= 4) return "***";
  return `${s.slice(0, 3)}****${s.slice(-2)}`;
}

// The overview block, tailored to the role. Contact fields are masked unless the
// role is allowed to see them; identity proofs are never included.
export function tailorOverview(user, role) {
  if (!user) return null;
  const seesContact = ROLE_SEES_CONTACT[role] === true;
  const overview = {
    id: user.id,
    display_name: user.displayName || "",
    status: user.status,
    created_at: user.createdAt,
    email: seesContact ? user.email : maskEmail(user.email),
    email_masked: !seesContact,
    phone: seesContact ? (user.phone || "") : maskPhone(user.phone),
    country_code: user.countryCode || "",
    default_currency: user.defaultCurrency || "",
    default_locale: user.defaultLocale || ""
  };
  return overview;
}
