process.env.LOG_REQUESTS = process.env.LOG_REQUESTS || "false";
process.env.RATE_LIMIT_MAX = "1000";
process.env.FRONTEND_URL = "https://brewgo.example.app";
process.env.WEBHOOK_SECRET = "test-webhook-secret";

const http = require("http");

const PK = "pk-test-public";
const SK = "sk-test-secret";
const basic = (key) => "Basic " + Buffer.from(`${key}:`).toString("base64");

const fake = { checkouts: new Map(), payments: new Map(), requests: [], failCreate: false, counter: 0 };
const fakeMaya = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const body = raw ? JSON.parse(raw) : null;
    fake.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });

    if (req.method === "POST" && req.url === "/checkout/v1/checkouts") {
      if (req.headers.authorization !== basic(PK)) return send(401, { code: "PY0005", message: "Invalid authentication credentials" });
      if (fake.failCreate) return send(500, { code: "PY9999", message: "boom" });
      const itemsTotal = body.items.reduce((s, i) => s + i.totalAmount.value, 0);
      const d = body.totalAmount.details;
      const consistent = Math.abs(itemsTotal - d.subtotal) < 0.001 && Math.abs(d.subtotal + d.shippingFee - d.discount - body.totalAmount.value) < 0.001;
      if (!consistent || body.requestReferenceNumber.length > 36 || !body.redirectUrl.success) return send(400, { code: "2553", message: "Missing/invalid parameters." });
      const checkoutId = `chk_${(fake.counter += 1)}`;
      fake.checkouts.set(checkoutId, body);
      return send(200, { checkoutId, redirectUrl: `https://payments-web-sandbox.paymaya.com/v2/checkout?id=${checkoutId}` });
    }
    const match = req.url.match(/^\/payments\/v1\/payments\/(.+)$/);
    if (req.method === "GET" && match) {
      if (req.headers.authorization !== basic(SK)) return send(401, { code: "PY0005", message: "Invalid authentication credentials" });
      const payment = fake.payments.get(match[1]);
      return payment ? send(200, payment) : send(404, { code: "PY0006", message: "Payment not found" });
    }
    send(404, { message: "not handled by fake" });
  });
});

let passed = 0;
const failures = [];
const check = (name, ok, extra = "") => { if (ok) { passed += 1; console.log(`  PASS  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name} ${extra}`); } };

let base;
async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}

let keyCounter = 0;
const nextKey = () => `maya-test-key-${(keyCounter += 1).toString().padStart(4, "0")}`;

async function placeOrder(token, { productId = 13, quantity = 1, couponCode } = {}) {
  await call("DELETE", "/cart", { token });
  await call("POST", "/cart/items", { token, body: { productId, quantity } });
  return call("POST", "/checkout", { token, body: { fulfillment: "pickup", paymentMethod: "ewallet", ...(couponCode ? { couponCode } : {}) }, headers: { "Idempotency-Key": nextKey() } });
}
const mayaPayment = (checkoutId, order, paymentStatus, amount = order.pricing.total) =>
  ({ id: checkoutId, isPaid: paymentStatus === "PAYMENT_SUCCESS", paymentStatus, amount, currency: "PHP", requestReferenceNumber: order.orderNumber });

async function main() {
  const app = require("../app");
  const orders = require("../repositories").orders;
  const paymentService = require("../services/paymentService");
  const server = app.listen(0);
  base = `http://localhost:${server.address().port}`;

  const login = await call("POST", "/auth/login", { body: { identifier: "maya.santos@email.com", password: "Password123" } });
  const token = login.json.data.token;
  const stock = async () => (await call("GET", "/products/13", { token })).json.data;
  const startPoints = (await call("GET", "/users/me", { token })).json.data.perks.pointsBalance;

  console.log("\n== Checkout creates a real Maya checkout ==");
  let r = await placeOrder(token, { quantity: 2, couponCode: "BREWGO10" });
  check("checkout -> 201 with Maya redirectUrl", r.status === 201 && r.json.data.payment.checkoutUrl.startsWith("https://payments-web-sandbox.paymaya.com/v2/checkout?id=chk_"), JSON.stringify(r.json));
  const order1 = r.json.data.order;
  const chk1 = r.json.data.payment.checkoutUrl.split("id=")[1];
  const sent = fake.requests.find((x) => x.method === "POST");
  check("uses PUBLIC key as Basic auth for create", sent.auth === basic(PK));
  check("amounts are consistent (180 items - 18 discount = 162)", sent.body.totalAmount.value === 162 && sent.body.totalAmount.details.subtotal === 180 && sent.body.totalAmount.details.discount === 18 && sent.body.totalAmount.currency === "PHP");
  check("requestReferenceNumber = order number + random suffix (unique, <= 36 chars)", /^BG-\d+-[0-9a-f]{6}$/.test(sent.body.requestReferenceNumber) && sent.body.requestReferenceNumber.startsWith(order1.orderNumber) && sent.body.requestReferenceNumber.length <= 36);
  check("redirect URLs point back to the PWA with orderId", sent.body.redirectUrl.success === `https://brewgo.example.app/payment/success?orderId=${order1.id}` && sent.body.redirectUrl.cancel.includes("/payment/cancelled?orderId=") && sent.body.redirectUrl.failure.includes("reason=failed"));
  check("buyer + items are sent", sent.body.buyer.firstName === "Maya" && sent.body.buyer.contact.phone === "+639178902341" && sent.body.items[0].name === "Butter Croissant" && sent.body.items[0].quantity === 2);
  check("order is pending_payment, provider maya", order1.status === "pending_payment" && order1.payment.provider === "maya");
  check("no secret keys leak to the client", !JSON.stringify(r.json).includes(SK) && !JSON.stringify(r.json).includes(PK));

  console.log("\n== Return page truth: reconcile asks Maya ==");
  r = await call("POST", `/orders/${order1.id}/reconcile`, { token });
  check("customer hasn't paid yet (Maya 404) -> still pending_payment", r.status === 200 && r.json.data.status === "pending_payment");
  const getAuth = fake.requests.filter((x) => x.method === "GET").pop().auth;
  check("uses SECRET key to read payment status", getAuth === basic(SK));
  fake.payments.set(chk1, mayaPayment(chk1, order1, "PAYMENT_FAILED"));
  r = await call("POST", `/orders/${order1.id}/reconcile`, { token });
  check("failed attempt keeps order pending so customer can retry", r.json.data.status === "pending_payment");
  fake.payments.set(chk1, mayaPayment(chk1, order1, "PAYMENT_SUCCESS", 5));
  r = await call("POST", `/orders/${order1.id}/reconcile`, { token });
  check("amount mismatch is NOT accepted as paid", r.json.data.status === "pending_payment");
  fake.payments.set(chk1, mayaPayment(chk1, order1, "PAYMENT_SUCCESS"));
  r = await call("POST", `/orders/${order1.id}/reconcile`, { token });
  check("PAYMENT_SUCCESS -> order paid", r.json.data.status === "paid" && r.json.data.payment.status === "paid");
  await call("POST", `/orders/${order1.id}/reconcile`, { token });
  const pts = (await call("GET", "/users/me", { token })).json.data.perks.pointsBalance;
  check("points awarded exactly once (floor(162/10)=16)", pts === startPoints + 16, `got ${pts - startPoints}`);

  console.log("\n== Webhook ==");
  r = await placeOrder(token);
  const order2 = r.json.data.order;
  const chk2 = r.json.data.payment.checkoutUrl.split("id=")[1];
  r = await call("POST", "/webhooks/maya?token=wrong", { body: { id: chk2, paymentStatus: "PAYMENT_SUCCESS" } });
  check("wrong token -> 401", r.status === 401);
  r = await call("POST", "/webhooks/maya", { body: { id: chk2, paymentStatus: "PAYMENT_SUCCESS" } });
  check("missing token -> 401", r.status === 401);
  r = await call("POST", "/webhooks/maya?token=test-webhook-secret", { body: { id: chk2, paymentStatus: "PAYMENT_SUCCESS", requestReferenceNumber: order2.orderNumber } });
  check("forged success webhook (Maya says unpaid) -> 200 but order NOT paid", r.status === 200 && (await call("GET", `/orders/${order2.id}`, { token })).json.data.status === "pending_payment");
  fake.payments.set(chk2, mayaPayment(chk2, order2, "PAYMENT_SUCCESS"));
  r = await call("POST", "/webhooks/maya?token=test-webhook-secret", { body: { id: chk2, paymentStatus: "PAYMENT_SUCCESS" } });
  check("real success webhook -> order paid", r.status === 200 && (await call("GET", `/orders/${order2.id}`, { token })).json.data.status === "paid");
  r = await call("POST", "/webhooks/maya?token=test-webhook-secret", { body: { id: chk2, paymentStatus: "PAYMENT_SUCCESS" } });
  check("duplicate webhook is harmless (200)", r.status === 200);
  r = await call("POST", "/webhooks/maya?token=test-webhook-secret", { body: { id: "unknown-id", requestReferenceNumber: `${order2.orderNumber}-abc123` } });
  check("unknown payment id -> still 200 (no endless retries)", r.status === 200);

  console.log("\n== Expired / cancelled / abandoned ==");
  r = await placeOrder(token, { quantity: 2 });
  const order3 = r.json.data.order;
  const chk3 = r.json.data.payment.checkoutUrl.split("id=")[1];
  fake.payments.set(chk3, mayaPayment(chk3, order3, "PAYMENT_EXPIRED"));
  const stockMid = orders.findById(order3.id).items[0].quantity;
  const productStockBefore = require("../repositories").products.findById(13).stock;
  r = await call("POST", `/orders/${order3.id}/reconcile`, { token });
  check("PAYMENT_EXPIRED -> order cancelled", r.json.data.status === "cancelled" && r.json.data.payment.status === "cancelled");
  check("stock released after expiry", require("../repositories").products.findById(13).stock === productStockBefore + stockMid);

  r = await placeOrder(token);
  const order4 = r.json.data.order;
  const chk4 = r.json.data.payment.checkoutUrl.split("id=")[1];
  fake.payments.set(chk4, mayaPayment(chk4, order4, "PAYMENT_CANCELLED"));
  r = await call("POST", "/webhooks/maya?token=test-webhook-secret", { body: { id: chk4 } });
  check("PAYMENT_CANCELLED webhook -> order cancelled", (await call("GET", `/orders/${order4.id}`, { token })).json.data.status === "cancelled");

  r = await placeOrder(token);
  const order5 = r.json.data.order;
  orders.findById(order5.id).createdAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const swept = await paymentService.sweepStale();
  check("sweeper cancels abandoned order older than the session", swept >= 1 && orders.findById(order5.id).status === "cancelled");

  r = await placeOrder(token);
  const order6 = r.json.data.order;
  const chk6 = r.json.data.payment.checkoutUrl.split("id=")[1];
  fake.payments.set(chk6, mayaPayment(chk6, order6, "PAYMENT_SUCCESS"));
  orders.findById(order6.id).createdAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  await paymentService.sweepStale();
  check("sweeper does NOT cancel an order Maya says was paid (missed webhook)", orders.findById(order6.id).status === "paid");

  console.log("\n== Maya is down ==");
  await call("DELETE", "/cart", { token });
  await call("POST", "/cart/items", { token, body: { productId: 13 } });
  const stockBeforeOutage = require("../repositories").products.findById(13).stock;
  const ordersBefore = orders.items.length;
  const key = nextKey();
  fake.failCreate = true;
  r = await call("POST", "/checkout", { token, body: { fulfillment: "pickup", paymentMethod: "card" }, headers: { "Idempotency-Key": key } });
  check("gateway 500 -> 503 PAYMENT_GATEWAY_ERROR", r.status === 503 && r.json.error.code === "PAYMENT_GATEWAY_ERROR");
  check("no order left behind, stock untouched", orders.items.length === ordersBefore && require("../repositories").products.findById(13).stock === stockBeforeOutage);
  check("cart is kept so the customer can retry", (await call("GET", "/cart", { token })).json.data.items.length === 1);
  fake.failCreate = false;
  r = await call("POST", "/checkout", { token, body: { fulfillment: "pickup", paymentMethod: "card" }, headers: { "Idempotency-Key": key } });
  check("retry with the SAME key works after recovery", r.status === 201 && r.json.data.payment.checkoutUrl.includes("paymaya.com"));
  const cashCall = fake.requests.length;
  await call("POST", "/cart/items", { token, body: { productId: 13 } });
  r = await call("POST", "/checkout", { token, body: { fulfillment: "pickup", paymentMethod: "cash" }, headers: { "Idempotency-Key": nextKey() } });
  check("cash orders never call Maya", r.status === 201 && fake.requests.length === cashCall);

  server.close();
  fakeMaya.close();
}

fakeMaya.listen(0, async () => {
  process.env.PAYMENT_PROVIDER = "maya";
  process.env.MAYA_PUBLIC_KEY = PK;
  process.env.MAYA_SECRET_KEY = SK;
  process.env.MAYA_BASE_URL = `http://localhost:${fakeMaya.address().port}`;
  try { await main(); } catch (error) { console.error("Test run crashed:", error); failures.push("crash"); }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failed:", failures.join(" | ")); process.exit(1); }
  process.exit(0);
});
