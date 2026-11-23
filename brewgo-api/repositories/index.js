const BaseRepository = require("./BaseRepository");
const { normalizePhone } = require("../utils/helpers");

class UserRepository extends BaseRepository {
  constructor() { super("users"); }
  findByEmail(email) { return this.findOne((u) => u.email === String(email).trim().toLowerCase()); }
  findByPhone(phone) { const p = normalizePhone(phone); return p ? this.findOne((u) => u.phone === p) : undefined; }
  findByIdentifier(identifier) {
    return String(identifier).includes("@") ? this.findByEmail(identifier) : this.findByPhone(identifier);
  }
}

class SessionRepository extends BaseRepository {
  constructor() { super("sessions"); }
  findByToken(token) { return this.findOne((s) => s.token === token); }
  removeByToken(token) {
    const i = this.items.findIndex((s) => s.token === token);
    if (i !== -1) this.items.splice(i, 1);
  }
}

class ProductRepository extends BaseRepository {
  constructor() { super("products"); }
  search({ category, q, bestSeller, availableOnly } = {}) {
    const term = q ? String(q).trim().toLowerCase() : "";
    return this.findAll((p) => {
      if (category && p.category !== category) return false;
      if (bestSeller !== undefined && p.isBestSeller !== bestSeller) return false;
      if (availableOnly && !(p.available && p.stock > 0)) return false;
      if (term) {
        const haystack = `${p.name} ${p.description} ${p.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }
}

class CartRepository extends BaseRepository {
  constructor() { super("carts"); }
  findByUser(userId) { return this.findOne((c) => c.userId === userId); }
  getOrCreate(userId) {
    return this.findByUser(userId) || this.create({ userId, items: [], couponCode: null, updatedAt: new Date().toISOString() });
  }
}

class OrderRepository extends BaseRepository {
  constructor() { super("orders"); }
  findByUser(userId) { return this.findAll((o) => o.userId === userId); }
  findByNumber(orderNumber) { return this.findOne((o) => o.orderNumber === orderNumber); }
  findBySession(sessionId) { return this.findOne((o) => o.payment && o.payment.sessionId === sessionId); }
}

class FavoriteRepository extends BaseRepository {
  constructor() { super("favorites"); }
  findByUser(userId) { return this.findAll((f) => f.userId === userId); }
  find(userId, productId) { return this.findOne((f) => f.userId === userId && f.productId === productId); }
}

class NotificationRepository extends BaseRepository {
  constructor() { super("notifications"); }
  findByUser(userId) { return this.findAll((n) => n.userId === userId); }
}

class PaymentMethodRepository extends BaseRepository {
  constructor() { super("paymentMethods"); }
  findByUser(userId) { return this.findAll((m) => m.userId === userId); }
}

class PromoCouponRepository extends BaseRepository {
  constructor() { super("promoCoupons"); }
  findByCode(code) { return this.findOne((c) => c.code === code); }
}

class UserCouponRepository extends BaseRepository {
  constructor() { super("userCoupons"); }
  findByCode(code) { return this.findOne((c) => c.code === code); }
  findByUser(userId) { return this.findAll((c) => c.userId === userId); }
}

class LedgerRepository extends BaseRepository {
  constructor() { super("ledger"); }
  findByUser(userId) { return this.findAll((l) => l.userId === userId); }
}

class StreakRepository extends BaseRepository {
  constructor() { super("streaks"); }
  findByUser(userId) { return this.findOne((s) => s.userId === userId); }
}

class MissionLogRepository extends BaseRepository {
  constructor() { super("missionLog"); }
}

class IdempotencyRepository extends BaseRepository {
  constructor() { super("idempotency"); }
  find(userId, key) { return this.findOne((r) => r.userId === userId && r.key === key); }
}

module.exports = {
  users: new UserRepository(),
  sessions: new SessionRepository(),
  branches: new BaseRepository("branches"),
  products: new ProductRepository(),
  carts: new CartRepository(),
  orders: new OrderRepository(),
  favorites: new FavoriteRepository(),
  notifications: new NotificationRepository(),
  paymentMethods: new PaymentMethodRepository(),
  rewards: new BaseRepository("rewards"),
  userCoupons: new UserCouponRepository(),
  promoCoupons: new PromoCouponRepository(),
  ledger: new LedgerRepository(),
  streaks: new StreakRepository(),
  missionLog: new MissionLogRepository(),
  idempotency: new IdempotencyRepository(),
  contactMessages: new BaseRepository("contactMessages"),
  paymentSessions: new BaseRepository("paymentSessions"),
};
