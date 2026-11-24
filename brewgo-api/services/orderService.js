const config = require("../config");
const { orders, products } = require("../repositories");
const { nextId } = require("../db/supabase");
const { withLock } = require("../utils/mutex");
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

exports.create = async ({ user, lines, pricing, coupon, fulfillment, branch, pickupTime, deliveryAddress, paymentMethod, note }) => {
  const orderNumber = `BG-${await nextId("orderNumber", 8921)}`;
  const isCash = paymentMethod === "cash";
  const status = isCash ? "preparing" : "pending_payment"; // cash is paid at the counter
  const now = nowIso();
  return orders.create({
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
};

const putStockBack = (order) => Promise.all(order.items.map((i) => products.adjust(i.productId, "stock", i.quantity))); // skips deleted products (adjust finds no row)

// What changes on the order's own payment block when it moves to `target` (no database calls).
function paymentAfter(order, target, previous) {
  const payment = { ...order.payment };
  if (target === "paid" || (target === "completed" && payment.method === "cash")) payment.status = "paid"; // cash is collected at the counter
  if (target === "cancelled") payment.status = previous === "pending_payment" ? "cancelled" : payment.method === "cash" ? "cancelled" : "refund_pending";
  return payment;
}

async function runSideEffects(order, target) {
  let pointsEarned;
  if (target === "paid" || (target === "completed" && order.payment.method === "cash")) {
    pointsEarned = await rewardService.onOrderPaid(order);
  }
  if (target === "cancelled") {
    await putStockBack(order);
    await couponService.release(order.coupon, order.userId);
  }
  if (TITLES[target]) {
    const [title, body] = TITLES[target];
    await notificationService.push(order.userId, "order", title, `${order.orderNumber}: ${body}`, { orderId: order.id, status: target });
  }
  return pointsEarned;
}

// CONTEXT of the state pattern: ask the current state if the move is allowed. (Callers must hold the order lock.)
async function move(order, target) {
  const state = STATES[order.status];
  if (!state.canMoveTo(target)) {
    throw new ConflictError(`An order that is "${order.status}" cannot become "${target}"`, "ILLEGAL_ORDER_STATE", { from: order.status, to: target, allowed: state.next });
  }
  const previous = order.status;
  const updatedAt = nowIso();
  const changes = {
    status: target, updatedAt,
    statusHistory: [...order.statusHistory, { status: target, at: updatedAt }],
    payment: paymentAfter(order, target, previous),
  };
  // The new status is saved FIRST: if two requests race (webhook + return page), only one gets past the check above.
  let saved = await orders.update(order.id, changes);
  const pointsEarned = await runSideEffects({ ...order, ...changes }, target);
  if (pointsEarned !== undefined) saved = await orders.update(order.id, { pointsEarned });
  return saved;
}

// Runs fn with the freshest copy of the order while no one else changes it (webhook, return page, sweeper, staff, customer).
exports.withOrder = (id, fn) =>
  withLock(`order:${id}`, async () => {
    const fresh = await orders.findById(id);
    if (!fresh) throw new NotFoundError("Order", "ORDER_NOT_FOUND");
    return fn(fresh);
  });
exports.moveLocked = move;
exports.transition = (order, target) => exports.withOrder(order.id, (fresh) => move(fresh, target));

// Used when the payment provider fails right after the order was created: undo everything quietly.
exports.discard = async (order) => {
  await putStockBack(order);
  await couponService.release(order.coupon, order.userId);
  await orders.remove(order.id);
};

exports.getRecordFor = async (user, id) => {
  const order = await orders.findById(id);
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

const ORDER_STATUS_LIST = Object.keys(STATES);

exports.list = async (user, { status }, paging) => {
  const mine = user.role === "admin" ? await orders.findAll() : await orders.findByUser(user.id);
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

exports.cancel = async (user, id) => {
  const order = await exports.getRecordFor(user, id);
  return exports.toView(await exports.transition(order, "cancelled"));
};

// "Reorder in 1-Tap": copies the items into the cart; anything unavailable is reported back, not silently dropped.
exports.reorder = async (user, id) => {
  const order = await exports.getRecordFor(user, id);
  const skipped = [];
  for (const item of order.items) {
    try {
      await cartService.addItem(user, { productId: item.productId, quantity: item.quantity, options: item.options, note: item.note || undefined });
    } catch (err) {
      if (!err.status || err.status >= 500) throw err; // a real failure (e.g. database down) must not look like "item unavailable"
      skipped.push({ productId: item.productId, name: item.name, reason: err.code || "UNKNOWN" });
    }
  }
  return { cart: await cartService.getView(user), skipped };
};
