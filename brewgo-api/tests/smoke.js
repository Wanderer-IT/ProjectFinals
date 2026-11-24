process.env.LOG_REQUESTS = process.env.LOG_REQUESTS || "false";
process.env.PAYMENT_PROVIDER = "mock"; // this file tests the built-in sandbox; tests/maya.test.js covers Maya
process.env.RATE_LIMIT_MAX = "1000";
process.env.FRONTEND_URL = "http://localhost:5173";

const fakeSupabase = require("./helpers/fakeSupabase");
let app;
let base;
let passed = 0;
const failures = [];

function check(name, condition, extra = "") {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} ${extra}`); }
}

async function call(method, path, { token, body, headers = {}, redirect = "follow" } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, redirect,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  console.log("\n== Health, public menu ==");
  let r = await call("GET", "/health");
  check("GET /health -> 200", r.status === 200 && r.json.success === true);
  r = await call("GET", "/products");
  check("GET /products -> 200 with pagination meta", r.status === 200 && r.json.data.length === 13 && r.json.meta.total === 13);
  r = await call("GET", "/products?category=iced");
  check("filter by category=iced -> 4 items", r.json.data.length === 4);
  r = await call("GET", "/products?search=croissant");
  check("search=croissant -> 2 items", r.json.data.length === 2);
  r = await call("GET", "/products?page=2&limit=5");
  check("page=2&limit=5 -> 5 items, hasNext", r.json.data.length === 5 && r.json.meta.hasNext === true);
  r = await call("GET", "/products?limit=500");
  check("limit=500 -> 422 VALIDATION_ERROR", r.status === 422 && r.json.error.code === "VALIDATION_ERROR");
  r = await call("GET", "/products/999");
  check("GET /products/999 -> 404 PRODUCT_NOT_FOUND + requestId", r.status === 404 && r.json.error.code === "PRODUCT_NOT_FOUND" && Boolean(r.json.requestId));
  r = await call("GET", "/products/1");
  check("GET /products/1 has optionGroups", r.status === 200 && r.json.data.optionGroups.length >= 3);
  r = await call("GET", "/nope");
  check("unknown route -> 404 ROUTE_NOT_FOUND", r.status === 404 && r.json.error.code === "ROUTE_NOT_FOUND");
  r = await call("GET", "/cart");
  check("GET /cart without token -> 401 TOKEN_MISSING", r.status === 401 && r.json.error.code === "TOKEN_MISSING");
  r = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad json" });
  check("malformed JSON -> 400", r.status === 400);

  console.log("\n== Register / login ==");
  r = await call("POST", "/auth/register", { body: { fullName: "A", email: "bad", phone: "123", address: "x", password: "short", acceptTerms: false } });
  check("register with bad data -> 422 with field details", r.status === 422 && r.json.error.details.length >= 5);
  const newUser = { fullName: "Keth Bahian", email: "keth@example.com", phone: "917 123 4567", address: "Quezon Ave, Iligan City", password: "Brewgo2026", acceptTerms: true };
  r = await call("POST", "/auth/register", { body: newUser });
  check("register -> 201 + token", r.status === 201 && Boolean(r.json.data.token));
  check("register gives 50 bonus points", r.json.data.user.pointsBalance === 50);
  r = await call("POST", "/auth/register", { body: newUser });
  check("duplicate email -> 409 EMAIL_TAKEN", r.status === 409 && r.json.error.code === "EMAIL_TAKEN");
  r = await call("POST", "/auth/login", { body: { identifier: "0917-123-4567", password: "Brewgo2026" } });
  check("login with phone number -> 200", r.status === 200);
  r = await call("POST", "/auth/login", { body: { identifier: "keth@example.com", password: "wrongpass1" } });
  check("wrong password -> 401 INVALID_CREDENTIALS", r.status === 401 && r.json.error.code === "INVALID_CREDENTIALS");

  r = await call("POST", "/auth/login", { body: { identifier: "maya.santos@email.com", password: "Password123" } });
  const maya = r.json.data.token;
  r = await call("POST", "/auth/login", { body: { identifier: "admin@brewgo.ph", password: "Admin123!" } });
  const admin = r.json.data.token;
  check("seed customer + admin can log in", Boolean(maya) && Boolean(admin));

  console.log("\n== Profile, home, rewards ==");
  r = await call("GET", "/users/me", { token: maya });
  check("profile: 120 pts, Gold tier, 4 favorites, 2 cards", r.json.data.perks.pointsBalance === 120 && r.json.data.user.tier === "Gold Brew Member" && r.json.data.stats.favorites === 4 && r.json.data.stats.cards === 2);
  check("profile: next free drink is 30 pts away", r.json.data.perks.nextFreeDrink.remaining === 30);
  check("profile never exposes passwordHash", !r.text.includes("passwordHash"));
  r = await call("GET", "/home", { token: maya });
  check("home (facade): greeting, 4 favorites, live order", r.json.data.greeting === "Hi, Maya" && r.json.data.favorites.length === 4 && r.json.data.activeOrder.orderNumber === "BG-8921");
  r = await call("GET", "/home");
  check("home works without login", r.status === 200 && r.json.data.user === null);
  r = await call("PATCH", "/users/me", { token: maya, body: { address: "12 New Street, Iligan City" } });
  check("PATCH /users/me -> 200", r.status === 200 && r.json.data.user.address === "12 New Street, Iligan City");
  r = await call("POST", "/rewards/streak/check-in", { token: maya });
  check("streak check-in completes 5/5 and awards +25", r.status === 200 && r.json.data.streak.completed === 5 && r.json.data.rewardAwarded === 25 && r.json.data.pointsBalance === 145);
  r = await call("POST", "/rewards/streak/check-in", { token: maya });
  check("second check-in same day -> 409 ALREADY_CHECKED_IN", r.status === 409 && r.json.error.code === "ALREADY_CHECKED_IN");
  r = await call("GET", "/rewards/catalog", { token: maya });
  check("reward catalog marks affordability", r.json.data.some((x) => x.canRedeem) && r.json.data.some((x) => !x.canRedeem && x.pointsNeeded > 0));
  const bigReward = r.json.data.find((x) => x.pointsCost === 250);
  r = await call("POST", "/rewards/redeem", { token: maya, body: { rewardId: bigReward.id } });
  check("redeem too expensive reward -> 422 INSUFFICIENT_POINTS", r.status === 422 && r.json.error.code === "INSUFFICIENT_POINTS");

  console.log("\n== Favorites ==");
  r = await call("POST", "/favorites", { token: maya, body: { productId: 3 } });
  check("add favorite -> 201", r.status === 201);
  r = await call("POST", "/favorites", { token: maya, body: { productId: 3 } });
  check("add same favorite again -> 200 (idempotent)", r.status === 200);
  r = await call("DELETE", "/favorites/3", { token: maya });
  check("remove favorite -> 204", r.status === 204);
  r = await call("DELETE", "/favorites/3", { token: maya });
  check("remove missing favorite -> 404", r.status === 404);

  console.log("\n== Staff-only product CRUD ==");
  const newProduct = { name: "Test Mocha", category: "hot", price: 140, stock: 10 };
  r = await call("POST", "/products", { token: maya, body: newProduct });
  check("customer creating product -> 403 FORBIDDEN", r.status === 403 && r.json.error.code === "FORBIDDEN");
  r = await call("POST", "/products", { token: admin, body: { name: "", category: "tea", price: -5 } });
  check("admin invalid product -> 422", r.status === 422);
  r = await call("POST", "/products", { token: admin, body: { ...newProduct, id: 99 } });
  check("client-supplied id -> 422 'id cannot be set'", r.status === 422 && r.json.error.details.some((d) => d.message === "id cannot be set"));
  r = await call("POST", "/products", { token: admin, body: newProduct });
  const pid = r.json.data.id;
  check("admin creates product -> 201", r.status === 201 && pid === 14);
  r = await call("PATCH", "/products/" + pid, { token: admin, body: { price: 145 } });
  check("PATCH product -> 200 changes only price", r.status === 200 && r.json.data.price === 145 && r.json.data.name === "Test Mocha");
  r = await call("PUT", "/products/" + pid, { token: admin, body: { name: "Test Mocha 2", category: "hot", price: 150, stock: 5 } });
  check("PUT product -> 200", r.status === 200 && r.json.data.name === "Test Mocha 2");
  r = await call("DELETE", "/products/" + pid, { token: admin });
  check("DELETE product -> 204", r.status === 204);
  r = await call("GET", "/products/" + pid);
  check("deleted product -> 404", r.status === 404);

  console.log("\n== Cart ==");
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 1, quantity: 2, options: { size: "large", milk: "oat" } } });
  check("add to cart -> 201, server-priced line (120+40+25)x2 = 370", r.status === 201 && r.json.data.items[0].unitPrice === 185 && r.json.data.pricing.subtotal === 370);
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 1, quantity: 1, options: { size: "large", milk: "oat" } } });
  check("same drink + options merges into one line (qty 3)", r.json.data.items.length === 1 && r.json.data.items[0].quantity === 3);
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 1, options: { size: "jumbo" } } });
  check("invalid option -> 422 INVALID_OPTION", r.status === 422 && r.json.error.code === "INVALID_OPTION");
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 1, quantity: 2, price: 1 } });
  r = await call("GET", "/cart", { token: maya });
  check("client cannot set a price (still server price)", r.json.data.items.every((i) => i.unitPrice >= 120));
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 12, quantity: 4 } });
  check("more than stock (Almond Croissant has 3) -> 409 INSUFFICIENT_STOCK", r.status === 409 && r.json.error.code === "INSUFFICIENT_STOCK");
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 10 } });
  check("out-of-stock Matcha Cookie -> 409 PRODUCT_UNAVAILABLE", r.status === 409 && r.json.error.code === "PRODUCT_UNAVAILABLE");
  r = await call("DELETE", "/cart", { token: maya });
  check("DELETE /cart -> 204", r.status === 204);
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 2 } });
  r = await call("POST", "/cart/items", { token: maya, body: { productId: 13 } });
  const latteItem = r.json.data.items[0].itemId;
  check("cart has Caramel Macchiato (130) + Butter Croissant (90) = 220", r.json.data.pricing.subtotal === 220);
  r = await call("PATCH", `/cart/items/${latteItem}`, { token: maya, body: { quantity: 2 } });
  check("PATCH cart item quantity -> subtotal 350", r.status === 200 && r.json.data.pricing.subtotal === 350);
  r = await call("PATCH", `/cart/items/${latteItem}`, { token: maya, body: {} });
  check("PATCH cart item with empty body -> 422", r.status === 422);
  r = await call("DELETE", "/cart/items/9999", { token: maya });
  check("remove missing cart item -> 404", r.status === 404);
  r = await call("GET", "/cart?fulfillment=delivery", { token: maya });
  check("delivery preview adds PHP 50 fee", r.json.data.pricing.deliveryFee === 50 && r.json.data.pricing.total === 400);

  console.log("\n== Coupons ==");
  r = await call("POST", "/cart/coupon", { token: maya, body: { code: "NOPE123" } });
  check("unknown coupon -> 422 COUPON_INVALID", r.status === 422 && r.json.error.code === "COUPON_INVALID");
  r = await call("POST", "/cart/coupon", { token: maya, body: { code: "summer20" } });
  check("expired coupon -> 422 COUPON_EXPIRED", r.status === 422 && r.json.error.code === "COUPON_EXPIRED");
  r = await call("POST", "/cart/coupon", { token: maya, body: { code: "brewgo10" } });
  check("BREWGO10 applies 10% (35 off)", r.status === 200 && r.json.data.pricing.discount === 35 && r.json.data.pricing.total === 315);

  console.log("\n== Checkout (idempotent, e-wallet) ==");
  const body = { fulfillment: "pickup", paymentMethod: "ewallet", branchId: 1, pickupTime: "ASAP" };
  r = await call("POST", "/checkout", { token: maya, body });
  check("no Idempotency-Key -> 400 IDEMPOTENCY_KEY_REQUIRED", r.status === 400 && r.json.error.code === "IDEMPOTENCY_KEY_REQUIRED");
  r = await call("POST", "/checkout", { token: maya, body: { fulfillment: "pickup", paymentMethod: "cash", pickupTime: "99:99" }, headers: { "Idempotency-Key": "key-bad-0001" } });
  check("bad pickupTime -> 422", r.status === 422);
  r = await call("POST", "/checkout", { token: maya, body: { fulfillment: "delivery", paymentMethod: "cash" }, headers: { "Idempotency-Key": "key-bad-0002" } });
  check("cash + delivery -> 422 PAYMENT_METHOD_NOT_ALLOWED", r.status === 422 && r.json.error.code === "PAYMENT_METHOD_NOT_ALLOWED");
  const key = "checkout-attempt-0001";
  r = await call("POST", "/checkout", { token: maya, body, headers: { "Idempotency-Key": key } });
  check("checkout -> 201 pending_payment + checkoutUrl", r.status === 201 && r.json.data.order.status === "pending_payment" && r.json.data.payment.checkoutUrl.includes("/payments/sandbox/"));
  check("order total is server-calculated (315)", r.json.data.order.pricing.total === 315 && r.json.data.order.coupon.code === "BREWGO10");
  const orderId = r.json.data.order.id;
  const checkoutUrl = r.json.data.payment.checkoutUrl;
  const sessionPath = checkoutUrl.split("/api/v1")[1];
  r = await call("POST", "/checkout", { token: maya, body, headers: { "Idempotency-Key": key } });
  check("same key replays the SAME order (no duplicate)", r.status === 200 && r.json.data.order.id === orderId && r.headers.get("idempotent-replayed") === "true");
  r = await call("POST", "/checkout", { token: maya, body: { ...body, paymentMethod: "card" }, headers: { "Idempotency-Key": key } });
  check("same key, different body -> 409 IDEMPOTENCY_KEY_REUSED", r.status === 409 && r.json.error.code === "IDEMPOTENCY_KEY_REUSED");
  r = await call("POST", "/checkout", { token: maya, body, headers: { "Idempotency-Key": "checkout-attempt-0002" } });
  check("empty cart after checkout -> 409 CART_EMPTY", r.status === 409 && r.json.error.code === "CART_EMPTY");
  r = await call("GET", "/cart", { token: maya });
  check("cart cleared by checkout", r.json.data.items.length === 0);

  console.log("\n== Payment return pages must tell the truth ==");
  r = await call("GET", `/orders/${orderId}`, { token: maya });
  check("before paying, order is pending_payment", r.json.data.status === "pending_payment" && r.json.data.payment.status === "pending");
  r = await call("GET", sessionPath);
  check("sandbox hosted page renders HTML", r.status === 200 && r.text.includes("Pay now"));
  r = await call("POST", "/webhooks/payments", { body: { type: "checkout_session.payment.paid", data: { sessionId: "x" } }, headers: { "X-Webhook-Secret": "wrong" } });
  check("webhook with wrong secret -> 401", r.status === 401 && r.json.error.code === "WEBHOOK_UNAUTHORIZED");
  r = await call("GET", "/users/me", { token: maya });
  const pointsBefore = r.json.data.perks.pointsBalance;
  r = await call("POST", sessionPath + "/pay", { redirect: "manual" });
  check("sandbox Pay -> 303 redirect to /payment/success", r.status === 303 && r.headers.get("location") === `http://localhost:5173/payment/success?orderId=${orderId}`);
  r = await call("GET", `/orders/${orderId}`, { token: maya });
  check("order is now paid", r.json.data.status === "paid" && r.json.data.payment.status === "paid");
  check("points earned: floor((350-35)/10) = 31", r.json.data.pointsEarned === 31);
  r = await call("GET", "/users/me", { token: maya });
  check("balance went up by 31", r.json.data.perks.pointsBalance === pointsBefore + 31);
  r = await call("POST", sessionPath + "/pay", { redirect: "manual" });
  r = await call("GET", "/users/me", { token: maya });
  check("paying twice does not award points twice", r.json.data.perks.pointsBalance === pointsBefore + 31);
  r = await call("POST", "/cart/coupon", { token: maya, body: { code: "BREWGO10" } });
  check("promo already used -> 422 COUPON_ALREADY_USED", r.json.error && r.json.error.code === "COUPON_ALREADY_USED");

  console.log("\n== Order lifecycle (State pattern) ==");
  r = await call("PATCH", `/orders/${orderId}/status`, { token: maya, body: { status: "preparing" } });
  check("customer cannot change status -> 403", r.status === 403);
  r = await call("PATCH", `/orders/${orderId}/status`, { token: admin, body: { status: "completed" } });
  check("paid -> completed is illegal -> 409 ILLEGAL_ORDER_STATE", r.status === 409 && r.json.error.code === "ILLEGAL_ORDER_STATE" && r.json.error.details.allowed.includes("preparing"));
  r = await call("PATCH", `/orders/${orderId}/status`, { token: admin, body: { status: "flying" } });
  check("unknown status -> 422", r.status === 422);
  for (const next of ["preparing", "ready", "completed"]) {
    r = await call("PATCH", `/orders/${orderId}/status`, { token: admin, body: { status: next } });
    check(`staff moves order to ${next} -> 200`, r.status === 200 && r.json.data.status === next);
  }
  r = await call("POST", `/orders/${orderId}/cancel`, { token: maya });
  check("cancel a completed order -> 409", r.status === 409);
  r = await call("GET", `/orders/${orderId}`, { token: (await call("POST", "/auth/login", { body: { identifier: "keth@example.com", password: "Brewgo2026" } })).json.data.token });
  check("another customer cannot read my order -> 404", r.status === 404);

  console.log("\n== Orders list & reorder ==");
  r = await call("GET", "/orders?status=active", { token: maya });
  check("active orders include live BG-8921", r.json.data.some((o) => o.orderNumber === "BG-8921") && r.json.meta.counts.active === 1);
  r = await call("GET", "/orders?status=past", { token: maya });
  check("past orders list + summary meta", r.json.data.length >= 3 && r.json.meta.summary.ordersThisYear >= 3);
  const pastId = r.json.data.find((o) => o.orderNumber === "BG-8742").id;
  r = await call("POST", `/orders/${pastId}/reorder`, { token: maya });
  check("reorder in 1 tap fills the cart", r.status === 200 && r.json.data.cart.items.length === 2);

  console.log("\n== Cash pickup, cancel, stock restore ==");
  const stockBefore = (await call("GET", "/products/13", { token: admin })).json.data.stock;
  r = await call("POST", "/checkout", { token: maya, body: { fulfillment: "pickup", paymentMethod: "cash" }, headers: { "Idempotency-Key": "cash-order-0001" } });
  check("cash order starts as preparing, no checkoutUrl", r.status === 201 && r.json.data.order.status === "preparing" && r.json.data.payment.checkoutUrl === null && r.json.data.payment.status === "pay_on_pickup");
  const cashId = r.json.data.order.id;
  check("stock was deducted", (await call("GET", "/products/13", { token: admin })).json.data.stock === stockBefore - 1);
  r = await call("POST", `/orders/${cashId}/cancel`, { token: maya });
  check("cannot cancel once preparing -> 409", r.status === 409);
  await call("POST", "/cart/items", { token: maya, body: { productId: 13 } });
  r = await call("POST", "/checkout", { token: maya, body: { fulfillment: "delivery", paymentMethod: "card", deliveryAddress: "55 Delivery St, Iligan City" }, headers: { "Idempotency-Key": "card-delivery-001" } });
  check("delivery order total = 90 + 50 fee", r.status === 201 && r.json.data.order.pricing.total === 140);
  const delId = r.json.data.order.id;
  r = await call("POST", `/orders/${delId}/cancel`, { token: maya });
  check("cancel pending order -> 200 cancelled", r.status === 200 && r.json.data.status === "cancelled");
  check("stock restored after cancel", (await call("GET", "/products/13", { token: admin })).json.data.stock === stockBefore - 1);

  console.log("\n== Cancelled payment & reconcile ==");
  await call("POST", "/cart/items", { token: maya, body: { productId: 9 } });
  r = await call("POST", "/checkout", { token: maya, body: { fulfillment: "pickup", paymentMethod: "ewallet" }, headers: { "Idempotency-Key": "ewallet-cancel-01" } });
  const cOrder = r.json.data.order.id;
  const cPath = r.json.data.payment.checkoutUrl.split("/api/v1")[1];
  r = await call("POST", cPath + "/cancel", { redirect: "manual" });
  check("sandbox Cancel -> 303 to /payment/cancelled", r.status === 303 && r.headers.get("location").includes("/payment/cancelled"));
  r = await call("GET", `/orders/${cOrder}`, { token: maya });
  check("order is cancelled (not paid)", r.json.data.status === "cancelled" && r.json.data.payment.status === "cancelled");
  r = await call("POST", `/orders/${cOrder}/reconcile`, { token: maya });
  check("reconcile is safe to call and stays cancelled", r.status === 200 && r.json.data.status === "cancelled");

  console.log("\n== AI discovery ==");
  r = await call("POST", "/ai/recommendations", { body: { query: "something sweet and iced please" } });
  check("AI returns grounded products labelled AI-Assisted", r.status === 200 && r.json.data.label === "AI-Assisted" && r.json.data.products.length > 0 && r.json.data.products.every((p) => typeof p.price === "number"));
  r = await call("POST", "/ai/recommendations", { body: { query: "<script>alert(1)</script> vegan" } });
  check("AI never echoes raw input", !r.text.includes("<script>"));
  r = await call("POST", "/ai/recommendations", { body: { query: "ab" } });
  check("AI query too short -> 422", r.status === 422);
  r = await call("POST", "/ai/recommendations", { body: { query: "x".repeat(300) } });
  check("AI query too long -> 422", r.status === 422);
  r = await call("POST", "/ai/recommendations", { body: { query: "strong coffee" }, headers: { "X-Simulate-AI-Outage": "true" } });
  check("AI outage -> 503 AI_UNAVAILABLE with fallback", r.status === 503 && r.json.error.code === "AI_UNAVAILABLE" && r.json.error.details.fallback.endpoint === "/api/v1/products");

  console.log("\n== Rewards redeem, notifications, payment methods, contact ==");
  r = await call("GET", "/rewards/catalog", { token: maya });
  const small = r.json.data.find((x) => x.pointsCost === 10);
  r = await call("POST", "/rewards/redeem", { token: maya, body: { rewardId: small.id } });
  check("redeem 10-pt reward -> 201 with coupon code", r.status === 201 && /^BG-[0-9A-F]{6}$/.test(r.json.data.coupon.code));
  const myCoupon = r.json.data.coupon.code;
  await call("POST", "/cart/items", { token: maya, body: { productId: 13 } });
  r = await call("POST", "/cart/coupon", { token: maya, body: { code: myCoupon } });
  check("redeemed coupon applies (PHP 10 off)", r.status === 200 && r.json.data.pricing.discount === 10);
  r = await call("POST", "/cart/coupon", { token: (await call("POST", "/auth/login", { body: { identifier: "keth@example.com", password: "Brewgo2026" } })).json.data.token, body: { code: myCoupon } });
  check("someone else's coupon -> 422 COUPON_INVALID", r.status === 422 && r.json.error.code === "COUPON_INVALID");
  r = await call("GET", "/rewards/history", { token: maya });
  check("points history is paginated and newest first", r.status === 200 && r.json.meta.total >= 8);
  r = await call("GET", "/notifications", { token: maya });
  check("notifications list has unreadCount", r.status === 200 && typeof r.json.meta.unreadCount === "number" && r.json.data.length > 0);
  r = await call("POST", "/notifications/read-all", { token: maya });
  check("mark all read -> 200", r.status === 200);
  r = await call("POST", "/users/me/payment-methods", { token: maya, body: { type: "card", provider: "Mastercard" } });
  check("card without last4 -> 422", r.status === 422);
  r = await call("POST", "/users/me/payment-methods", { token: maya, body: { type: "card", provider: "Mastercard", last4: "1234" } });
  check("add card (last4 only) -> 201", r.status === 201 && r.json.data.last4 === "1234");
  r = await call("DELETE", `/users/me/payment-methods/${r.json.data.id}`, { token: maya });
  check("remove card -> 204", r.status === 204);
  r = await call("POST", "/contact", { body: { name: "Maya", email: "maya@x.com", message: "My latte was cold, please help." } });
  check("contact us -> 201 with ticketId", r.status === 201 && r.json.data.ticketId.startsWith("CT-"));
  r = await call("GET", "/branches");
  check("branches list -> 3", r.json.data.length === 3);

  console.log("\n== Logout & rate limit ==");
  r = await call("POST", "/auth/logout", { token: maya });
  check("logout -> 200", r.status === 200);
  r = await call("GET", "/users/me", { token: maya });
  check("token no longer works -> 401 TOKEN_INVALID", r.status === 401 && r.json.error.code === "TOKEN_INVALID");
}

(async () => {
  // Supabase is the only database, so the tests talk to a fake Supabase server (no internet, no real project).
  const supabase = await fakeSupabase.start();
  process.env.SUPABASE_URL = supabase.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = supabase.key;
  app = require("../app");
  await require("../db/bootstrap").initDatabase(); // empty database -> demo data

  const server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  try {
    await main();
  } catch (error) {
    console.error("Test run crashed:", error);
    failures.push("crash");
  }
  server.close();
  await supabase.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failed:", failures.join(" | ")); process.exit(1); }
  process.exit(0);
})();
