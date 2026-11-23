// Demo accounts + sample history so every screen in the Figma prototype has data on first run.
const { users, products, favorites, paymentMethods, orders, streaks, notifications } = require("../repositories");
const { nextId } = require("./store");
const { seedCatalog } = require("./seedData");
const productService = require("../services/productService");
const rewardService = require("../services/rewardService");
const { hashPassword } = require("../utils/password");
const { addDays, manilaDateKey } = require("../utils/helpers");
const config = require("../config");

function makeOrder({ user, number, status, spec, fulfillment, branchId, branchName, method, createdAt, points }) {
  const items = spec.map(({ name, quantity = 1, options = {} }) => {
    const product = products.findOne((p) => p.name === name);
    const priced = productService.resolveOptions(product, options);
    return {
      productId: product.id, name, category: product.category, imageUrl: product.imageUrl,
      plantBased: product.plantBased || ["oat", "almond"].includes(priced.options.milk),
      quantity, unitPrice: priced.unitPrice, lineTotal: priced.unitPrice * quantity,
      options: priced.options, optionLabels: priced.labels, note: null,
    };
  });
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const deliveryFee = fulfillment === "delivery" ? config.deliveryFee : 0;
  const iso = createdAt.toISOString();
  return orders.create({
    orderNumber: number, userId: user.id, status, fulfillment, branchId, branchName,
    pickupTime: fulfillment === "pickup" ? "ASAP" : null, deliveryAddress: fulfillment === "delivery" ? user.address : null, note: null,
    items, pricing: { subtotal, discount: 0, deliveryFee, total: subtotal + deliveryFee, currency: config.currency }, coupon: null,
    payment: { method, status: "paid", provider: "mock-gateway", sessionId: null, checkoutUrl: null },
    pointsEarned: points, estimatedMinutes: config.pickupEtaMinutes,
    statusHistory: [{ status: "pending_payment", at: iso }, { status: "paid", at: iso }, { status, at: iso }],
    createdAt: iso, updatedAt: iso,
  });
}

function seedDemoData() {
  seedCatalog();
  const now = new Date();
  const minutesAgo = (m) => new Date(now.getTime() - m * 60000);

  const maya = users.create({
    role: "customer", fullName: "Maya Santos", email: "maya.santos@email.com", phone: "09178902341",
    address: "Jose Ong St., Saray, Iligan City", passwordHash: hashPassword("Password123"), avatarUrl: null,
    pointsBalance: 0, lifetimePoints: 0, createdAt: addDays(now, -60).toISOString(),
  });
  users.create({
    role: "admin", fullName: "Brew Go Staff", email: "admin@brewgo.ph", phone: "09170000000",
    address: "BGC High Street, Taguig City", passwordHash: hashPassword("Admin123!"), avatarUrl: null,
    pointsBalance: 0, lifetimePoints: 0, createdAt: addDays(now, -60).toISOString(),
  });

  // Points history ends at exactly 120 pts (the balance shown in the Figma screens).
  const add = (pts, type, desc, daysAgo, orderId = null) =>
    rewardService.addPoints(maya, pts, type, desc, orderId, addDays(now, -daysAgo).toISOString());
  add(95, "ORDER_PAID", "Earlier orders", 40);
  add(50, "SIGNUP_BONUS", "Welcome bonus", 39);
  const o8610 = makeOrder({ user: maya, number: "BG-8610", status: "completed", spec: [{ name: "Caramel Macchiato" }, { name: "Pain au Chocolat" }], fulfillment: "pickup", branchId: 1, branchName: "BGC High Street", method: "ewallet", createdAt: addDays(now, -10), points: 23 });
  add(23, "ORDER_PAID", "Order BG-8610", 10, o8610.id);
  add(-100, "REDEEM", "Redeemed \u20B1100 coupon", 9);
  add(-25, "REDEEM", "Redeemed \u20B120 coupon", 7);
  const o8742 = makeOrder({ user: maya, number: "BG-8742", status: "completed", spec: [{ name: "Iced Spanish Latte" }, { name: "Butter Croissant" }], fulfillment: "pickup", branchId: 1, branchName: "BGC High Street", method: "ewallet", createdAt: addDays(now, -1), points: 24 });
  add(24, "ORDER_PAID", "Order BG-8742", 1, o8742.id);
  const live = makeOrder({
    user: maya, number: `BG-${nextId("orderNumber", 8921)}`, status: "preparing",
    spec: [{ name: "Spanish Latte", options: { size: "large", milk: "oat", sweetness: "50" } }, { name: "Almond Croissant", options: { warmed: "yes" } }],
    fulfillment: "pickup", branchId: 1, branchName: "BGC High Street", method: "ewallet", createdAt: minutesAgo(6), points: 28,
  });
  add(28, "ORDER_PAID", `Order ${live.orderNumber}`, 0, live.id);
  add(25, "STREAK_BONUS", "5-day Brew Streak reward", 0);

  const yesterday = manilaDateKey(addDays(now, -1));
  streaks.create({ userId: maya.id, count: 4, lastDate: yesterday }); // 4 of 5 done; check in today to finish

  ["Spanish Latte", "Caramel Macchiato", "Iced Spanish Latte", "Butter Croissant"].forEach((name) =>
    favorites.create({ userId: maya.id, productId: products.findOne((p) => p.name === name).id, createdAt: now.toISOString() }));

  paymentMethods.create({ userId: maya.id, type: "ewallet", provider: "GCash", last4: null, label: "E-wallet, GCash", createdAt: now.toISOString() });
  paymentMethods.create({ userId: maya.id, type: "card", provider: "Visa", last4: "4108", label: "Visa ending in 4108", createdAt: now.toISOString() });

  notifications.create({ userId: maya.id, type: "order", title: "Preparing your brew", body: `${live.orderNumber}: Our baristas are making your order.`, data: { orderId: live.id, status: "preparing" }, read: false, createdAt: minutesAgo(5).toISOString() });
  notifications.create({ userId: maya.id, type: "rewards", title: "30 pts to go", body: "Only 30 pts away from a free handcrafted drink!", data: {}, read: true, createdAt: minutesAgo(600).toISOString() });
}

module.exports = { seedDemoData };
