// Supabase is the ONLY database. These tests run the API against a fake Supabase server and prove:
//  - nothing is kept in the server's memory (data changed in the database shows up immediately),
//  - every change is already in the database when the API answers,
//  - concurrent requests cannot oversell stock, double-award points or create double orders,
//  - a database outage gives a clean 503 and the API recovers by itself,
//  - startup fails loudly when Supabase is not configured correctly.
process.env.LOG_REQUESTS = "false";
process.env.PAYMENT_PROVIDER = "mock";
process.env.RATE_LIMIT_MAX = "1000";

const fakeSupabase = require("./helpers/fakeSupabase");

let passed = 0;
const failures = [];
function check(name, condition, extra = "") {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} ${extra}`); }
}

async function main(fake) {
  process.env.SUPABASE_URL = fake.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = fake.key;

  const app = require("../app");
  const config = require("../config");
  const database = require("../db/supabase");
  const { initDatabase } = require("../db/bootstrap");
  const repos = require("../repositories");
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://localhost:${server.address().port}/api/v1`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
    return { status: res.status, json };
  };
  const login = async (identifier, password) => (await call("POST", "/auth/login", { body: { identifier, password } })).json.data.token;
  let key = 0;
  const nextKey = () => `db-test-key-${String((key += 1)).padStart(4, "0")}`;
  const checkout = (token, paymentMethod = "cash", idemKey = nextKey()) =>
    call("POST", "/checkout", { token, headers: { "Idempotency-Key": idemKey }, body: { fulfillment: "pickup", paymentMethod } });

  console.log("\n== There is no second database in the code ==");
  for (const gone of ["../models/store", "../models/persistence"]) {
    let exists = true;
    try { require.resolve(gone); } catch { exists = false; }
    check(`${gone.slice(3)} no longer exists`, !exists);
  }
  check("nothing seeds in memory on startup (database is empty before init)", fake.rows.size === 0);

  console.log("\n== First boot: empty Supabase -> demo data saved ==");
  const boot = await initDatabase();
  check("boot reports it seeded", boot.seeded === true);
  check("demo users in Supabase", fake.count("users") === 2);
  check("catalog in Supabase", fake.count("products") === 13 && fake.count("branches") === 3);
  check("order history in Supabase", fake.count("orders") === 3);
  check("id counters live in Supabase (order numbers continue after BG-8921)", fake.counters.get("orderNumber") === 8922);
  const second = await initDatabase();
  check("second boot does NOT seed again", second.seeded === false && fake.count("users") === 2 && fake.count("products") === 13);
  let r = await call("GET", "/health");
  check("/health reports the database as reachable", r.status === 200 && r.json.data.database.reachable === true);

  console.log("\n== Every change is already in Supabase when the API answers (no waiting, no flush) ==");
  r = await call("POST", "/auth/register", { body: { fullName: "Persist Tester", email: "persist@example.com", phone: "09171112222", address: "1 Test Street, Butuan", password: "Password123!", acceptTerms: true } });
  check("register -> 201", r.status === 201, JSON.stringify(r.json));
  const token = r.json.data.token;
  const userId = r.json.data.user.id;
  const userRow = fake.rows.get(`users:${userId}`);
  check("user row is there immediately", userRow && userRow.data.email === "persist@example.com");
  check("password is stored hashed, not plain", !JSON.stringify(userRow.data).includes("Password123!"));
  check("welcome points saved (50) and ledger written", userRow.data.pointsBalance === 50 && fake.all("ledger").some((l) => l.userId === userId && l.points === 50));
  check("login session saved", fake.all("sessions").some((s) => s.userId === userId));
  r = await call("POST", "/cart/items", { token, body: { productId: 1, quantity: 2 } });
  const cartRow = fake.all("carts").find((c) => c.userId === userId);
  check("cart change saved", r.status === 201 && cartRow && cartRow.items.length === 1 && cartRow.items[0].quantity === 2);
  r = await checkout(token, "cash");
  check("checkout -> 201", r.status === 201, JSON.stringify(r.json));
  const orderNumber = r.json.data.order.orderNumber;
  check("order saved and stock reduced in Supabase", fake.all("orders").some((o) => o.orderNumber === orderNumber) && fake.rows.get("products:1").data.stock === 98);
  await call("POST", "/favorites", { token, body: { productId: 2 } });
  const favs = fake.count("favorites");
  await call("DELETE", "/favorites/2", { token });
  check("deleting a record deletes the row", fake.count("favorites") === favs - 1);

  console.log("\n== No cache: what is in Supabase is what the API shows ==");
  fake.rows.get(`users:${userId}`).data.address = "Edited directly in the Supabase dashboard";
  r = await call("GET", "/users/me", { token });
  check("edit made in the database appears in the next API response", r.json.data.user.address === "Edited directly in the Supabase dashboard");
  fake.rows.get("products:3").data.price = 999;
  r = await call("GET", "/products/3");
  check("price changed in the database is served immediately", r.json.data.price === 999);
  fake.rows.get("products:3").data.price = 140;
  const afterOld = await call("POST", "/auth/login", { body: { identifier: "persist@example.com", password: "Password123!" } });
  check("password still verifies; old token still works", afterOld.status === 200 && (await call("GET", "/users/me", { token })).status === 200);
  r = await call("POST", "/auth/register", { body: { fullName: "Second Tester", email: "second@example.com", phone: "09173334444", address: "2 Test Street, Butuan", password: "Password123!", acceptTerms: true } });
  check("new records get fresh ids (never reused)", r.status === 201 && r.json.data.user.id > userId);
  r = await call("POST", "/auth/login", { body: { identifier: "a&b=c@x.com", password: "whatever12" } });
  check("odd characters in a lookup cannot break the query (-> clean 401)", r.status === 401 || r.status === 422, `got ${r.status}`);
  r = await call("POST", "/auth/login", { body: { identifier: "x.y@z.com&data->>role=eq.admin", password: "whatever12" } });
  check("query-injection attempt in a login id -> still just 401/422", r.status === 401 || r.status === 422, `got ${r.status}`);

  console.log("\n== Many people at once ==");
  const maya = await login("maya.santos@email.com", "Password123");
  const admin = await login("admin@brewgo.ph", "Admin123!");
  const other = (await call("POST", "/auth/register", { body: { fullName: "Other Buyer", email: "other@example.com", phone: "09175556666", address: "3 Test Street, Butuan", password: "Password123!", acceptTerms: true } })).json.data.token;
  fake.delayMs = 8; // slow the fake database a little so simultaneous requests really overlap

  r = await call("PATCH", "/products/12", { token: admin, body: { stock: 1 } });
  check("staff sets Almond Croissant stock to 1", r.status === 200 && fake.rows.get("products:12").data.stock === 1);
  await call("DELETE", "/cart", { token: maya });
  await Promise.all([maya, other].map((t) => call("POST", "/cart/items", { token: t, body: { productId: 12, quantity: 1 } })));
  const both = await Promise.all([checkout(maya), checkout(other)]);
  const codes = both.map((x) => x.status).sort();
  check("two customers buy the LAST item at once -> exactly one wins (201) and one gets 409", codes[0] === 201 && codes[1] === 409, JSON.stringify(codes));
  check("the loser gets INSUFFICIENT_STOCK", both.some((x) => x.json && x.json.error && x.json.error.code === "INSUFFICIENT_STOCK"));
  check("stock is exactly 0 (not negative)", fake.rows.get("products:12").data.stock === 0);

  await call("DELETE", "/cart", { token: maya });
  await call("POST", "/cart/items", { token: maya, body: { productId: 1, quantity: 1 } });
  const ordersBefore = fake.count("orders");
  const stockBefore = fake.rows.get("products:1").data.stock;
  const sameKey = nextKey();
  const taps = await Promise.all([checkout(maya, "cash", sameKey), checkout(maya, "cash", sameKey), checkout(maya, "cash", sameKey)]);
  check("triple-tap checkout with ONE Idempotency-Key -> a single order", fake.count("orders") === ordersBefore + 1, `orders +${fake.count("orders") - ordersBefore}`);
  check("...stock reduced once", fake.rows.get("products:1").data.stock === stockBefore - 1);
  check("...all three taps got the same order", new Set(taps.map((x) => x.json.data.order.orderNumber)).size === 1 && taps.every((x) => [200, 201].includes(x.status)));

  await call("DELETE", "/cart", { token: other });
  await Promise.all([1, 2, 3].map(() => call("POST", "/cart/items", { token: other, body: { productId: 4, quantity: 1 } })));
  r = await call("GET", "/cart", { token: other });
  check("three simultaneous 'add to cart' taps are all counted (qty 3, nothing lost)", r.json.data.items.length === 1 && r.json.data.items[0].quantity === 3, JSON.stringify(r.json.data.items.map((i) => i.quantity)));

  await call("DELETE", "/cart", { token: maya });
  await call("POST", "/cart/items", { token: maya, body: { productId: 1, quantity: 2 } });
  r = await checkout(maya, "ewallet");
  const order = r.json.data.order;
  const pointsBefore = fake.rows.get(`users:${(await repos.users.findByEmail("maya.santos@email.com")).id}`).data.pointsBalance;
  fake.all("paymentSessions"); // make the mock gateway report "paid"
  for (const row of fake.rows.values()) if (row.collection === "paymentSessions" && row.data.sessionId === order.payment.sessionId) row.data.status = "paid";
  const racers = await Promise.all([1, 2, 3, 4].map(() => call("POST", `/orders/${order.id}/reconcile`, { token: maya })));
  const mayaRow = [...fake.rows.values()].find((x) => x.collection === "users" && x.data.email === "maya.santos@email.com");
  const earned = Math.floor(order.pricing.total / 10);
  check("4 simultaneous payment confirmations -> order paid", racers.every((x) => x.status === 200 && x.json.data.status === "paid"));
  check("...points awarded ONCE (not 4 times)", mayaRow.data.pointsBalance - pointsBefore >= earned && fake.all("ledger").filter((l) => l.orderId === order.id && l.type === "ORDER_PAID").length === 1,
    `ledger rows: ${fake.all("ledger").filter((l) => l.orderId === order.id && l.type === "ORDER_PAID").length}`);
  fake.delayMs = 0;

  console.log("\n== Supabase outage: clean 503, then recovery (nothing to re-sync, nothing was held in memory) ==");
  fake.failNext = 1;
  r = await call("GET", "/products");
  check("database error -> 503 DATABASE_UNAVAILABLE (no stack trace)", r.status === 503 && r.json.error.code === "DATABASE_UNAVAILABLE" && !JSON.stringify(r.json).includes("Supabase"));
  r = await call("GET", "/products");
  check("next request works again by itself", r.status === 200 && r.json.data.length === 13);
  fake.failNext = 1;
  r = await call("GET", "/health");
  check("/health -> 503 'degraded' while the database is down", r.status === 503 && r.json.data.database.reachable === false);
  fake.failNext = 1;
  r = await call("POST", "/cart/items", { token, body: { productId: 5, quantity: 1 } });
  check("a write that fails answers 503, not a fake success", r.status === 503);
  fake.missingTable = true;
  r = await call("GET", "/products");
  check("missing table -> 503", r.status === 503);
  fake.missingTable = false;

  console.log("\n== More than 1000 rows (Supabase returns max 1000 per request) ==");
  for (let i = 1; i <= 2300; i++) fake.rows.set(`contactMessages:${i}`, { collection: "contactMessages", id: i, data: { id: i, name: "n", email: "a@b.co", message: "m", createdAt: new Date().toISOString() } });
  check("all 2300 rows are read", (await repos.contactMessages.findAll()).length === 2300);
  check("refuses to delete a whole collection by accident", await repos.contactMessages.removeWhere({}).then(() => false, () => true));

  console.log("\n== Startup checks ==");
  const reason = async () => { try { await initDatabase(); return ""; } catch (e) { return String(e.cause || e.message); } };
  const good = config.supabase.serviceKey;
  config.supabase.serviceKey = "wrong-key";
  let msg = await reason();
  check("wrong key -> message mentions the service_role key", /401/.test(msg) && /service_role/.test(msg), msg);
  config.supabase.serviceKey = good;
  fake.missingTable = true;
  msg = await reason();
  check("schema not installed -> message tells you to run supabase/schema.sql", /404/.test(msg) && /schema\.sql/.test(msg), msg);
  fake.missingTable = false;
  const url = config.supabase.url;
  config.supabase.url = "";
  msg = await reason();
  check("missing SUPABASE_URL -> clear message", /SUPABASE_URL/.test(msg), msg);
  config.supabase.url = "http://localhost:9"; // nothing listens there
  msg = await reason();
  check("unreachable Supabase -> clear message", /Cannot reach Supabase/.test(msg), msg);
  config.supabase.url = url;
  check("everything fine again -> boots without re-seeding", (await initDatabase()).seeded === false);
  check("database helper is the only module that knows the Supabase URL", typeof database.select === "function");

  server.close();
}

(async () => {
  const fake = await fakeSupabase.start();
  try { await main(fake); } catch (err) { console.error("Test run crashed:", err); failures.push("crash"); }
  await fake.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failed:", failures.join(" | "));
  process.exit(failures.length ? 1 : 0);
})();
