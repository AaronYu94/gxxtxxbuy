// In-memory double for the user-admin repository (V2-09-01/02/03).
export class MemoryUserAdminRepository {
  constructor() {
    this.users = new Map();        // id -> user
    this.ordersByUser = new Map(); // user_id -> [order]
    this.parcelsByUser = new Map();// user_id -> [parcel_no]
    this.orderNoIndex = new Map(); // order_no -> user_id
    this.parcelNoIndex = new Map();// parcel_no -> user_id
  }

  seedUser(u) {
    const user = {
      id: u.id, email: u.email, emailNormalized: (u.email || "").toLowerCase(), displayName: u.displayName || "",
      status: u.status || "normal", phone: u.phone || "", countryCode: u.countryCode || "", defaultLocale: u.defaultLocale || "en",
      defaultCurrency: u.defaultCurrency || "USD", emailVerifiedAt: u.emailVerifiedAt || null, version: u.version || 1,
      createdAt: u.createdAt || new Date().toISOString()
    };
    this.users.set(user.id, user);
    return user;
  }
  linkOrder(orderNo, userId) { this.orderNoIndex.set(orderNo, userId); }
  linkParcel(parcelNo, userId) { this.parcelNoIndex.set(parcelNo, userId); }

  async findById(id) { const u = this.users.get(id); return u ? { ...u } : null; }
  async findByEmail(email) { for (const u of this.users.values()) if (u.emailNormalized === String(email || "").toLowerCase()) return { ...u }; return null; }
  async findByOrderNo(orderNo) { const uid = this.orderNoIndex.get(orderNo); return uid ? this.findById(uid) : null; }
  async findByParcelNo(parcelNo) { const uid = this.parcelNoIndex.get(parcelNo); return uid ? this.findById(uid) : null; }
  async searchByPrefix(prefix, limit = 20) {
    const p = String(prefix || "").toLowerCase();
    return [...this.users.values()].filter((u) => u.emailNormalized.startsWith(p) || (u.displayName || "").toLowerCase().startsWith(p)).slice(0, limit).map((u) => ({ ...u }));
  }
  async userCounts(userId) {
    return { orders: (this.ordersByUser.get(userId) || []).length, parcels: (this.parcelsByUser.get(userId) || []).length, after_sales: 0, addresses: 0 };
  }
  async walletBalance() { return 0; }
  async recentOrders(userId) { return (this.ordersByUser.get(userId) || []).slice(0, 10); }

  async assistUpdateProfile(userId, patch, expectedVersion) {
    const user = this.users.get(userId);
    if (!user) return { notFound: true };
    if (expectedVersion != null && user.version !== expectedVersion) return { versionConflict: true };
    if (user.status !== "normal") return { locked: true, status: user.status };
    const emailChanged = patch.email && String(patch.email).toLowerCase() !== user.emailNormalized;
    if (emailChanged) { for (const other of this.users.values()) if (other.id !== userId && other.emailNormalized === String(patch.email).toLowerCase()) return { emailTaken: true }; }
    for (const [col, val] of Object.entries(patch.columns || {})) {
      const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      user[camel] = val;
    }
    if (emailChanged) { user.email = patch.email; user.emailNormalized = String(patch.email).toLowerCase(); user.emailVerifiedAt = null; }
    user.version += 1;
    return { user: { ...user }, emailChanged: Boolean(emailChanged) };
  }
}
