// FACADE PATTERN: the controller calls ONE method, checkout(); the facade coordinates
// cart, stock, coupons, pricing, orders, payment and notifications behind it.
const { branches, products, orders, idempotency } = require("../repositories");
const cartService = require("./cartService");
const couponService = require("./couponService");
const pricingService = require("./pricingService");
const orderService = require("./orderService");
const paymentService = require("./paymentService");
const notificationService = require("./notificationService");
const { nowIso, manilaShift } = require("../utils/helpers");
const { ConflictError, UnprocessableError, BadRequestError } = require("../utils/errors");

const KEY_FORMAT = /^[A-Za-z0-9_.:-]{8,128}$/;

const stockProblem = (problems) => new ConflictError("Some items are no longer available in the quantity you chose", "INSUFFICIENT_STOCK", problems);

// Friendly pre-check (lists every problem item) before anything is changed.
async function assertStock(lines) {
  const need = new Map();
  lines.forEach((l) => need.set(l.productId, (need.get(l.productId) || 0) + l.quantity));
  const found = await products.findByIds([...need.keys()]);
  const byId = new Map(found.map((p) => [p.id, p]));
  const problems = [];
  need.forEach((qty, productId) => {
    const p = byId.get(productId);
    if (!p || !p.available || p.stock < qty) problems.push({ productId, name: p ? p.name : "Unknown product", requested: qty, available: p && p.available ? p.stock : 0 });
  });
  if (problems.length) throw stockProblem(problems);
}

// The real stock reservation. The database subtracts atomically and refuses to go below 0, so two customers
// can never both get the last croissant. If one line fails, the lines already taken are put back.
async function takeStock(lines) {
  const taken = [];
  for (const l of lines) {
    const left = await products.adjust(l.productId, "stock", -l.quantity, 0);
    if (left === null || left === undefined) {
      await Promise.all(taken.map((t) => products.adjust(t.productId, "stock", t.quantity)));
      throw stockProblem([{ productId: l.productId, name: l.name, requested: l.quantity, available: 0 }]);
    }
    taken.push(l);
  }
}

async function validateRules(user, body) {
  const errors = [];
  const branch = await branches.findById(body.branchId || 1);
  if (!branch) errors.push({ field: "branchId", message: "branch does not exist" });
  if (body.fulfillment === "delivery" && body.paymentMethod === "cash") {
    throw new UnprocessableError("Cash is only available for pickup orders", "PAYMENT_METHOD_NOT_ALLOWED", [{ field: "paymentMethod", message: "cash is only available for pickup" }]);
  }
  const deliveryAddress = body.deliveryAddress || user.address;
  if (body.fulfillment === "delivery" && !deliveryAddress) errors.push({ field: "deliveryAddress", message: "deliveryAddress is required for delivery" });
  if (body.fulfillment === "pickup" && body.pickupTime && body.pickupTime !== "ASAP" && branch) {
    const now = manilaShift();
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const [h, m] = body.pickupTime.split(":").map(Number);
    const wanted = h * 60 + m;
    const [oh, om] = branch.openTime.split(":").map(Number);
    const [ch, cm] = branch.closeTime.split(":").map(Number);
    if (wanted < oh * 60 + om || wanted > ch * 60 + cm) errors.push({ field: "pickupTime", message: `branch is open ${branch.openTime}-${branch.closeTime}` });
    else if (wanted < nowMinutes + 10) errors.push({ field: "pickupTime", message: "pickupTime must be at least 10 minutes from now" });
  }
  if (errors.length) throw new UnprocessableError("Please fix the highlighted fields", "VALIDATION_ERROR", errors);
  return { branch, deliveryAddress };
}

exports.checkout = async (user, body, idempotencyKey) => {
  if (!idempotencyKey) throw new BadRequestError("The Idempotency-Key header is required for checkout", "IDEMPOTENCY_KEY_REQUIRED");
  if (!KEY_FORMAT.test(idempotencyKey)) throw new BadRequestError("Idempotency-Key must be 8-128 characters (letters, numbers, - _ . :)", "IDEMPOTENCY_KEY_INVALID");

  // Same key + same body = same answer (double-tap protection). Same key + different body = conflict.
  const fingerprint = JSON.stringify(body, Object.keys(body).sort());
  const previous = await idempotency.find(user.id, idempotencyKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new ConflictError("This Idempotency-Key was already used with a different request", "IDEMPOTENCY_KEY_REUSED");
    return { replayed: true, data: previous.response };
  }

  // ---- validate everything BEFORE changing any data ----
  const cart = await cartService.getCart(user);
  const lines = await cartService.buildLines(cart);
  if (!lines.length) throw new ConflictError("Your cart is empty", "CART_EMPTY");
  await assertStock(lines);
  const { branch, deliveryAddress } = await validateRules(user, body);

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const couponCode = body.couponCode || cart.couponCode;
  const coupon = couponCode ? await couponService.resolve(couponCode, user, subtotal) : null;
  const pricing = pricingService.quote(lines, body.fulfillment, coupon); // server-side totals only

  // ---- now commit ----
  await takeStock(lines);
  let order;
  let session;
  try {
    order = await orderService.create({
      user, lines, pricing, coupon, fulfillment: body.fulfillment, branch,
      pickupTime: body.pickupTime, deliveryAddress, paymentMethod: body.paymentMethod, note: body.note,
    });
    await couponService.markUsed(coupon, user, order.id);
    const [firstName, ...rest] = user.fullName.split(" ");
    const buyer = { firstName, lastName: rest.join(" ") || firstName, phone: `+63${user.phone.slice(1)}`, email: user.email };
    session = await paymentService.forMethod(body.paymentMethod).start(order, buyer);
  } catch (error) {
    // Payment provider (or the database) failed: put stock/coupon back, keep the cart, let the customer retry.
    if (order) await orderService.discard(order);
    else await Promise.all(lines.map((l) => products.adjust(l.productId, "stock", l.quantity)));
    throw error;
  }
  if (session) {
    order.payment = { ...order.payment, provider: paymentService.providerName(), sessionId: session.sessionId, checkoutUrl: session.checkoutUrl };
    await orders.update(order.id, { payment: order.payment });
  }
  await cartService.clear(user);

  await notificationService.push(user.id, "order", "Order placed", `${order.orderNumber} was received${session ? ". Complete your payment to start brewing." : ". Pay at the counter when you pick up."}`, { orderId: order.id });

  const data = {
    order: orderService.toView(order),
    payment: { method: order.payment.method, status: order.payment.status, checkoutUrl: session ? session.checkoutUrl : null },
  };
  await idempotency.create({ userId: user.id, key: idempotencyKey, fingerprint, response: data, createdAt: nowIso() });
  return { replayed: false, data };
};
