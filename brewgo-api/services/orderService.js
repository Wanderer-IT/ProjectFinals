const config = require("../config");
const { orders, products } = require("../repositories");
const { nextId } = require("../models/store");
const rewardService = require("./rewardService");
const couponService = require("./couponService");
const notificationService = require("./notificationService");
const cartService = require("./cartService");
const { nowIso, paginate, money } = require("../utils/helpers");
const { NotFoundError, ConflictError } = require("../utils/errors");

// ---------------------------------------------------------------------------
// STATE PATTERN (Lab 4): each order status is a class that knows which
// statuses may come next. Illegal moves answer 409 instead of if/else chains.
// ---------------------------------------------------------------------------
class OrderState {
  constructor(name, next) { this.name = name; this.next = next; }
  canMoveTo(target) { return this.next.includes(target); }
}
class PendingPaymentState extends OrderState { constructor() { super("pending_payment", ["paid", "cancelled"]); } }
class PaidState extends OrderState { constructor() { super("paid", ["preparing", "cancelled"]); } }
class PreparingState extends OrderState { constructor() { super("preparing", ["ready"]); } }
class ReadyState extends OrderState { constructor() { super("ready", ["completed"]); } }
class CompletedState extends OrderState { constructor() { super("completed", []); } }
class CancelledState extends OrderState { constructor() { super("cancelled", []); } }

const STATES = Object.fromEntries(
  [new PendingPaymentState(), new PaidState(), new PreparingState(), new ReadyState(), new CompletedState(), new CancelledState()].map((s) => [s.name, s])
);
const ACTIVE = ["pending_payment", "paid", "preparing", "ready"];
const PAST = ["completed", "cancelled"];

const TITLES = {
  paid: ["Payment received", "We got your payment. Your order is in the queue."],
  preparing: ["Preparing your brew", "Our baristas are making your order."],
  ready: ["Your order is ready", "Come get it while it's fresh!"],
  completed: ["Order completed", "Enjoy! Thanks for choosing Brew Go."],
  cancelled: ["Order cancelled", "Your order was cancelled."],
};

exports.STATES = STATES;

exports.create = ({ user, lines, pricing, coupon, fulfillment, branch, pickupTime, deliveryAddress, paymentMethod, note }) => {
  const orderNumber = `BG-${nextId("orderNumber", 8921)}`;
  const isCash = paymentMethod === "cash";
  const status = isCash ? "preparing" : "pending_payment"; // cash is paid at the counter
  const now = nowIso();
  const order = orders.create({
    orderNumber, userId: user.id, status,
    fulfillment, branchId: branch.id, branchName: branch.name,
    pickupTime: fulfillment === "pickup" ? pickupTime || "ASAP" : null,
    deliveryAddress: fulfillment === "delivery" ? deliveryAddress : null,
    note: note || null,
    items: lines.map((l) => ({
      productId: l.productId, name: l.name, category: l.category, imageUrl: l.imageUrl, plantBased: l.plantBased,
      quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, options: l.options, optionLabels: l.optionLabels, note: l.note,
    })),
    pricing,
    coupon: coupon ? { code: coupon.code, kind: coupon.kind, id: coupon.id, title: coupon.title } : null,
    payment: { method: paymentMethod, status: isCash ? "pay_on_pickup" : "pending", provider: null, sessionId: null, checkoutUrl: null },
    pointsEarned: 0,
    estimatedMinutes: fulfillment === "delivery" ? config.deliveryEtaMinutes : config.pickupEtaMinutes,
    statusHistory: isCash ? [{ status: "pending_payment", at: now }, { status, at: now }] : [{ status, at: now }],
    createdAt: now, updatedAt: now,
  });
  return order;
};

function applySideEffects(order, target, previous) {
  if (target === "paid") {
    order.payment.status = "paid";
    rewardService.onOrderPaid(order);
  }
  if (target === "completed" && order.payment.method === "cash") {
    order.payment.status = "paid"; // cash collected at the counter
    rewardService.onOrderPaid(order);
  }
  if (target === "cancelled") {
    order.items.forEach((i) => { const p = products.findById(i.productId); if (p) p.stock += i.quantity; }); // put stock back
    couponService.release(order.coupon, order.userId);
    order.payment.status = previous === "pending_payment" ? "cancelled" : order.payment.method === "cash" ? "cancelled" : "refund_pending";
  }
  if (TITLES[target]) {
    const [title, body] = TITLES[target];
    notificationService.push(order.userId, "order", title, `${order.orderNumber}: ${body}`, { orderId: order.id, status: target });
  }
}

// CONTEXT of the state pattern: ask the current state if the move is allowed.
exports.transition = (order, target) => {
  const state = STATES[order.status];
  if (!state.canMoveTo(target)) {
    throw new ConflictError(`An order that is "${order.status}" cannot become "${target}"`, "ILLEGAL_ORDER_STATE", { from: order.status, to: target, allowed: state.next });
  }
  const previous = order.status;
  order.status = target;
  order.updatedAt = nowIso();
  order.statusHistory.push({ status: target, at: order.updatedAt });
  applySideEffects(order, target, previous);
  return order;
};

// Used when the payment provider fails right after the order was created: undo everything quietly.
exports.discard = (order) => {
  order.items.forEach((i) => { const p = products.findById(i.productId); if (p) p.stock += i.quantity; });
  couponService.release(order.coupon, order.userId);
  orders.remove(order.id);
};

exports.getRecordFor = (user, id) => {
  const order = orders.findById(id);
  if (!order || (order.userId !== user.id && user.role !== "admin")) throw new NotFoundError("Order", "ORDER_NOT_FOUND"); // no peeking at other people's orders
  return order;
};

function etaMinutes(order) {
  if (!ACTIVE.includes(order.status) || order.pickupTime && order.pickupTime !== "ASAP") return null;
  const left = Math.ceil((Date.parse(order.createdAt) + order.estimatedMinutes * 60000 - Date.now()) / 60000);
  return Math.max(0, left);
}

exports.toView = (order) => {
  const payment = { ...order.payment };
  if (order.status !== "pending_payment") delete payment.checkoutUrl; // only needed while payment is pending ("pay again")
  return {
    id: order.id, orderNumber: order.orderNumber, status: order.status,
    isActive: ACTIVE.includes(order.status),
    fulfillment: order.fulfillment, branchId: order.branchId, branchName: order.branchName,
    pickupTime: order.pickupTime, deliveryAddress: order.deliveryAddress, note: order.note,
    items: order.items, itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
    pricing: order.pricing, coupon: order.coupon ? { code: order.coupon.code, title: order.coupon.title } : null,
    payment, pointsEarned: order.pointsEarned,
    etaMinutes: etaMinutes(order), canCancel: STATES[order.status].canMoveTo("cancelled"),
    pickupCode: order.orderNumber, // the app renders this as the "Show QR" code
    statusHistory: order.statusHistory, createdAt: order.createdAt, updatedAt: order.updatedAt,
  };
};

exports.list = (user, { status }, paging) => {
  const mine = user.role === "admin" ? orders.findAll() : orders.findByUser(user.id);
  const wanted = status === "active" ? ACTIVE : status === "past" ? PAST : ORDER_STATUS_LIST.includes(status) ? [status] : null;
  const filtered = mine.filter((o) => !wanted || wanted.includes(o.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const { items, meta } = paginate(filtered, paging);

  const year = new Date().getFullYear();
  const thisYear = mine.filter((o) => new Date(o.createdAt).getFullYear() === year && o.status !== "cancelled");
  meta.counts = { active: mine.filter((o) => ACTIVE.includes(o.status)).length, past: mine.filter((o) => PAST.includes(o.status)).length };
  meta.summary = {
    ordersThisYear: thisYear.length,
    totalSpent: money(thisYear.reduce((s, o) => s + o.pricing.total, 0)),
    pointsCollected: thisYear.reduce((s, o) => s + o.pointsEarned, 0),
    tier: rewardService.tierFor(user.lifetimePoints),
  };
  return { items: items.map(exports.toView), meta };
};
const ORDER_STATUS_LIST = Object.keys(STATES);

exports.cancel = (user, id) => exports.toView(exports.transition(exports.getRecordFor(user, id), "cancelled"));

// "Reorder in 1-Tap": copies the items into the cart; anything unavailable is reported back, not silently dropped.
exports.reorder = (user, id) => {
  const order = exports.getRecordFor(user, id);
  const skipped = [];
  order.items.forEach((item) => {
    try {
      cartService.addItem(user, { productId: item.productId, quantity: item.quantity, options: item.options, note: item.note || undefined });
    } catch (err) {
      skipped.push({ productId: item.productId, name: item.name, reason: err.code || "UNKNOWN" });
    }
  });
  return { cart: cartService.getView(user), skipped };
};

