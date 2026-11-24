const config = require("../config");
const { carts, products } = require("../repositories");
const { nextId } = require("../db/supabase");
const productService = require("./productService");
const couponService = require("./couponService");
const pricingService = require("./pricingService");
const { nowIso } = require("../utils/helpers");
const { NotFoundError, ConflictError } = require("../utils/errors");

// Saves what changed in the cart (the cart row is the only thing written).
const save = (cart, changes = {}) => carts.update(cart.id, { items: cart.items, couponCode: cart.couponCode, ...changes, updatedAt: nowIso() });

// Joins cart rows with live product data. Prices ALWAYS come from the product list, never from the client.
async function buildLines(cart) {
  const found = await products.findByIds(cart.items.map((i) => i.productId));
  const byId = new Map(found.map((p) => [p.id, p]));
  cart.items = cart.items.filter((i) => byId.has(i.productId)); // drop products that were deleted
  const lines = [];
  cart.items.forEach((item) => {
    const product = byId.get(item.productId);
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

async function view(user, fulfillment = "pickup") {
  let cart = await carts.getOrCreate(user.id);
  const itemCountBefore = cart.items.length;
  const lines = await buildLines(cart);
  let dirty = cart.items.length !== itemCountBefore;
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  let coupon = null;
  let couponWarning = null;
  if (cart.couponCode) {
    try {
      coupon = await couponService.resolve(cart.couponCode, user, subtotal);
    } catch (err) {
      if (err.status !== 422) throw err; // only "coupon not usable" is a warning; a database failure must fail the request
      couponWarning = { code: err.code, message: err.message }; // e.g. cart dropped below the minimum spend
      cart.couponCode = null;
      dirty = true;
    }
  }
  if (dirty) cart = (await save(cart)) || cart;
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
exports.buildLines = buildLines;
exports.getCart = (user) => carts.getOrCreate(user.id);

exports.addItem = async (user, body) => {
  const cart = await carts.getOrCreate(user.id);
  const product = await productService.getRecord(body.productId);
  const quantity = body.quantity || 1;
  const { options } = productService.resolveOptions(product, body.options || {});
  checkStock(cart, product, quantity);

  const existing = cart.items.find((i) => i.productId === product.id && JSON.stringify(i.options) === JSON.stringify(options) && (i.note || "") === (body.note || ""));
  if (existing) existing.quantity += quantity;
  else cart.items.push({ id: await nextId("cartItem"), productId: product.id, quantity, options, note: body.note || "" });
  await save(cart);
  return view(user);
};

exports.updateItem = async (user, itemId, body) => {
  const cart = await carts.getOrCreate(user.id);
  const item = cart.items.find((i) => i.id === Number(itemId));
  if (!item) throw new NotFoundError("Cart item", "CART_ITEM_NOT_FOUND");
  const product = await productService.getRecord(item.productId);
  if (body.options !== undefined) item.options = productService.resolveOptions(product, body.options).options;
  if (body.quantity !== undefined) {
    checkStock(cart, product, body.quantity, item.id);
    item.quantity = body.quantity;
  }
  if (body.note !== undefined) item.note = body.note;
  await save(cart);
  return view(user);
};

exports.removeItem = async (user, itemId) => {
  const cart = await carts.getOrCreate(user.id);
  const index = cart.items.findIndex((i) => i.id === Number(itemId));
  if (index === -1) throw new NotFoundError("Cart item", "CART_ITEM_NOT_FOUND");
  cart.items.splice(index, 1);
  await save(cart);
  return view(user);
};

exports.clear = async (user) => {
  const cart = await carts.getOrCreate(user.id);
  await save(cart, { items: [], couponCode: null });
};

exports.applyCoupon = async (user, code) => {
  const cart = await carts.getOrCreate(user.id);
  const subtotal = (await buildLines(cart)).reduce((s, l) => s + l.lineTotal, 0);
  const coupon = await couponService.resolve(code, user, subtotal); // throws 422 COUPON_* when not usable
  await save(cart, { couponCode: coupon.code });
  return view(user);
};

exports.removeCoupon = async (user) => {
  const cart = await carts.getOrCreate(user.id);
  await save(cart, { couponCode: null });
  return view(user);
};

exports.config = config;
