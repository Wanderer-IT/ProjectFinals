const config = require("../config");
const { carts, products } = require("../repositories");
const { nextId } = require("../models/store");
const productService = require("./productService");
const couponService = require("./couponService");
const pricingService = require("./pricingService");
const { nowIso } = require("../utils/helpers");
const { NotFoundError, ConflictError } = require("../utils/errors");

const touch = (cart) => { cart.updatedAt = nowIso(); };

// Joins cart rows with live product data. Prices ALWAYS come from the product list, never from the client.
function buildLines(cart) {
  const lines = [];
  cart.items = cart.items.filter((i) => products.findById(i.productId)); // drop products that were deleted
  cart.items.forEach((item) => {
    const product = products.findById(item.productId);
    const priced = productService.resolveOptions(product, item.options);
    const sameProductQty = cart.items.filter((i) => i.productId === item.productId).reduce((s, i) => s + i.quantity, 0);
    const issues = [];
    if (!productService.isAvailable(product)) issues.push({ code: "PRODUCT_UNAVAILABLE", message: `${product.name} is currently unavailable` });
    else if (sameProductQty > product.stock) issues.push({ code: "INSUFFICIENT_STOCK", message: `Only ${product.stock} of ${product.name} left`, available: product.stock });
    lines.push({
      itemId: item.id, productId: product.id, name: product.name, category: product.category,
      imageUrl: product.imageUrl, plantBased: product.plantBased || ["oat", "almond"].includes(priced.options.milk),
      quantity: item.quantity, options: priced.options, optionLabels: priced.labels, note: item.note || null,
      unitPrice: priced.unitPrice, lineTotal: priced.unitPrice * item.quantity, issues,
    });
  });
  return lines;
}

function view(user, fulfillment = "pickup") {
  const cart = carts.getOrCreate(user.id);
  const lines = buildLines(cart);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  let coupon = null;
  let couponWarning = null;
  if (cart.couponCode) {
    try {
      coupon = couponService.resolve(cart.couponCode, user, subtotal);
    } catch (err) {
      couponWarning = { code: err.code, message: err.message }; // e.g. cart dropped below the minimum spend
      cart.couponCode = null;
    }
  }
  const pricing = pricingService.quote(lines, fulfillment, coupon);
  return {
    items: lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    fulfillment,
    coupon: coupon ? { code: coupon.code, title: coupon.title, discount: pricing.discount } : null,
    couponWarning,
    pricing,
    hasIssues: lines.some((l) => l.issues.length > 0),
    updatedAt: cart.updatedAt,
  };
}

function checkStock(cart, product, extraQty, excludeItemId) {
  const current = cart.items.filter((i) => i.productId === product.id && i.id !== excludeItemId).reduce((s, i) => s + i.quantity, 0);
  if (!productService.isAvailable(product)) {
    throw new ConflictError(`${product.name} is currently unavailable`, "PRODUCT_UNAVAILABLE", { productId: product.id });
  }
  if (current + extraQty > product.stock) {
    throw new ConflictError(`Only ${product.stock} of ${product.name} left`, "INSUFFICIENT_STOCK", { productId: product.id, requested: current + extraQty, available: product.stock });
  }
}

exports.getView = view;
exports.buildLines = (cart) => buildLines(cart);
exports.getCart = (user) => carts.getOrCreate(user.id);

exports.addItem = (user, body) => {
  const cart = carts.getOrCreate(user.id);
  const product = productService.getRecord(body.productId);
  const quantity = body.quantity || 1;
  const { options } = productService.resolveOptions(product, body.options || {});
  checkStock(cart, product, quantity);

  const existing = cart.items.find((i) => i.productId === product.id && JSON.stringify(i.options) === JSON.stringify(options) && (i.note || "") === (body.note || ""));
  if (existing) existing.quantity += quantity;
  else cart.items.push({ id: nextId("cartItem"), productId: product.id, quantity, options, note: body.note || "" });
  touch(cart);
  return view(user);
};

exports.updateItem = (user, itemId, body) => {
  const cart = carts.getOrCreate(user.id);
  const item = cart.items.find((i) => i.id === Number(itemId));
  if (!item) throw new NotFoundError("Cart item", "CART_ITEM_NOT_FOUND");
  const product = productService.getRecord(item.productId);
  if (body.options !== undefined) item.options = productService.resolveOptions(product, body.options).options;
  if (body.quantity !== undefined) {
    checkStock(cart, product, body.quantity, item.id);
    item.quantity = body.quantity;
  }
  if (body.note !== undefined) item.note = body.note;
  touch(cart);
  return view(user);
};

exports.removeItem = (user, itemId) => {
  const cart = carts.getOrCreate(user.id);
  const index = cart.items.findIndex((i) => i.id === Number(itemId));
  if (index === -1) throw new NotFoundError("Cart item", "CART_ITEM_NOT_FOUND");
  cart.items.splice(index, 1);
  touch(cart);
  return view(user);
};

exports.clear = (user) => {
  const cart = carts.getOrCreate(user.id);
  cart.items = [];
  cart.couponCode = null;
  touch(cart);
};

exports.applyCoupon = (user, code) => {
  const cart = carts.getOrCreate(user.id);
  const subtotal = buildLines(cart).reduce((s, l) => s + l.lineTotal, 0);
  const coupon = couponService.resolve(code, user, subtotal); // throws 422 COUPON_* when not usable
  cart.couponCode = coupon.code;
  touch(cart);
  return view(user);
};

exports.removeCoupon = (user) => {
  const cart = carts.getOrCreate(user.id);
  cart.couponCode = null;
  touch(cart);
  return view(user);
};

exports.config = config;
