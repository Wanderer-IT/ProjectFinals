const BaseRepository = require("./BaseRepository");
const { withLock } = require("../utils/mutex");
const { normalizePhone } = require("../utils/helpers");

class UserRepository extends BaseRepository {
  constructor() { super("users"); }
  findByEmail(email) { return this.findOne({ email: String(email).trim().toLowerCase() }); }
  async findByPhone(phone) { const p = normalizePhone(phone); return p ? this.findOne({ phone: p }) : undefined; }
  findByIdentifier(identifier) {
    return String(identifier).includes("@") ? this.findByEmail(identifier) : this.findByPhone(identifier);
  }
}

class SessionRepository extends BaseRepository {
  constructor() { super("sessions"); }
  findByToken(token) { return this.findOne({ token }); }
  removeByToken(token) { return this.removeWhere({ token }); }
}

class ProductRepository extends BaseRepository {
  constructor() { super("products"); }
  // category / bestSeller are filtered by the database; text search and availability on the (small) result.
  async search({ category, q, bestSeller, availableOnly } = {}) {
    const where = {};
    if (category) where.category = category;
    if (bestSeller !== undefined) where.isBestSeller = bestSeller;
    const term = q ? String(q).trim().toLowerCase() : "";
    return (await this.findAll(where)).filter((p) => {
      if (availableOnly && !(p.available && p.stock > 0)) return false;
      if (term && !`${p.name} ${p.description} ${p.tags.join(" ")}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }
}

class CartRepository extends BaseRepository {
  constructor() { super("carts"); }
  findByUser(userId) { return this.findOne({ userId }); }
  // The lock stops two simultaneous requests from creating two carts for a brand-new customer.
  getOrCreate(userId) {
    return withLock(`cart-create:${userId}`, async () =>
      (await this.findByUser(userId)) || this.create({ userId, items: [], couponCode: null, updatedAt: new Date().toISOString() }));
  }
}

class OrderRepository extends BaseRepository {
  constructor() { super("orders"); }
  findByUser(userId) { return this.findAll({ userId }); }
  findByNumber(orderNumber) { return this.findOne({ orderNumber }); }
  findBySession(sessionId) { return this.findOne({ "payment.sessionId": sessionId }); }
  findByStatus(status) { return this.findAll({ status }); }
}

class FavoriteRepository extends BaseRepository {
  constructor() { super("favorites"); }
  findByUser(userId) { return this.findAll({ userId }); }
  find(userId, productId) { return this.findOne({ userId, productId }); }
}

class NotificationRepository extends BaseRepository {
  constructor() { super("notifications"); }
  findByUser(userId) { return this.findAll({ userId }); }
}

class PaymentMethodRepository extends BaseRepository {
  constructor() { super("paymentMethods"); }
  findByUser(userId) { return this.findAll({ userId }); }
}

class PromoCouponRepository extends BaseRepository {
  constructor() { super("promoCoupons"); }
  findByCode(code) { return this.findOne({ code }); }
}

class UserCouponRepository extends BaseRepository {
  constructor() { super("userCoupons"); }
  findByCode(code) { return this.findOne({ code }); }
  findByUser(userId) { return this.findAll({ userId }); }
}

class LedgerRepository extends BaseRepository {
  constructor() { super("ledger"); }
  findByUser(userId) { return this.findAll({ userId }); }
}

class StreakRepository extends BaseRepository {
  constructor() { super("streaks"); }
  findByUser(userId) { return this.findOne({ userId }); }
}

class MissionLogRepository extends BaseRepository {
  constructor() { super("missionLog"); }
  find(userId, key, week) { return this.findOne({ userId, key, week }); }
}

class IdempotencyRepository extends BaseRepository {
  constructor() { super("idempotency"); }
  find(userId, key) { return this.findOne({ userId, key }); }
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
