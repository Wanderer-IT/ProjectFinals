// Tests the Supabase persistence layer against a fake Supabase REST server (no internet, no real project needed).
process.env.LOG_REQUESTS = "false";
process.env.PAYMENT_PROVIDER = "mock";
process.env.RATE_LIMIT_MAX = "1000";
process.env.SUPABASE_FLUSH_MS = "60000"; // the test calls flush() itself

const http = require("http");
const KEY = "test-service-role-key";

// ---- fake Supabase (PostgREST) -------------------------------------------------------------
const table = new Map(); // "collection:id" -> row
const fake = { failNext: 0, requests: 0 };
const fakeSupabase = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    fake.requests += 1;
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
    if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: "Invalid API key" });
    if (fake.failNext > 0) { fake.failNext -= 1; return send(500, { message: "boom" }); }
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/rest/v1/brewgo_records") return send(404, { message: "table not found" });
    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit")), offset = Number(url.searchParams.get("offset"));
      const rows = [...table.values()].sort((a, b) => a.collection.localeCompare(b.collection) || a.id - b.id);
      return send(200, rows.slice(offset, offset + limit).map(({ collection, id, data }) => ({ collection, id, data })));
    }
    if (req.method === "POST") {
      if (url.searchParams.get("on_conflict") !== "collection,id") return send(400, { message: "need on_conflict" });
      for (const row of JSON.parse(raw)) table.set(`${row.collection}:${row.id}`, row);
      return send(201);
    }
    if (req.method === "DELETE") {
      const collection = url.searchParams.get("collection").replace(/^eq\./, "");
      const ids = url.searchParams.get("id").replace(/^in\.\(|\)$/g, "").split(",").map(Number);
      ids.forEach((id) => table.delete(`${collection}:${id}`));
      return send(204);
    }
    send(405, {});
  });
});

let passed = 0;
const failures = [];
function check(name, condition, extra = "") {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} ${extra}`); }
}
const count = (collection) => [...table.values()].filter((r) => r.collection === collection).length;

async function main() {
  await new Promise((r) => fakeSupabase.listen(0, r));
  process.env.SUPABASE_URL = `http://localhost:${fakeSupabase.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;

  const app = require("../app");
  const persistence = require("../models/persistence");
  const { db, counters } = require("../models/store");
  const { seedDemoData } = require("../models/seedDemo");
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

  console.log("\n== First boot: empty Supabase -> seeds demo data and saves it ==");
  check("persistence is enabled when env vars are set", persistence.enabled === true);
  check("memory is empty before init (app.js did not auto-seed)", db.users.length === 0);
  const boot = await persistence.init(seedDemoData);
  check("init reports supabase storage", boot.storage === "supabase");
  check("demo users saved to Supabase", count("users") === 2);
  check("catalog saved to Supabase", count("products") === 13 && count("branches") >= 1);
  check("order history saved to Supabase", count("orders") === 3);
  check("id counters saved", table.has("_meta:1") && table.get("_meta:1").data.data === undefined && table.get("_meta:1").data.counters.orderNumber > 8921);
  let r = await call("GET", "/health");
  check("/health shows storage: supabase", r.json.data.storage.storage === "supabase" && r.json.data.storage.lastError === null);

  console.log("\n== Changes made through the API reach Supabase ==");
  r = await call("POST", "/auth/register", { body: { fullName: "Persist Tester", email: "persist@example.com", phone: "09171112222", address: "1 Test Street, Butuan", password: "Password123!", acceptTerms: true } });
  check("register -> 201", r.status === 201, JSON.stringify(r.json));
  const token = r.json.data.token;
  const newUserId = r.json.data.user.id;
  await persistence.flush();
  check("new user row in Supabase", count("users") === 3 && table.get(`users:${newUserId}`).data.email === "persist@example.com");
  check("password is stored hashed, not plain", !JSON.stringify(table.get(`users:${newUserId}`).data).includes("Password123!"));
  check("session (login token) saved", count("sessions") >= 1);

  r = await call("POST", "/cart/items", { token, body: { productId: 1, quantity: 2 } });
  check("add to cart -> 201", r.status === 201);
  await persistence.flush();
  const cartRow = [...table.values()].find((x) => x.collection === "carts" && x.data.userId === newUserId);
  check("in-place cart change (items.push) is saved", cartRow && cartRow.data.items.length === 1 && cartRow.data.items[0].quantity === 2);

  r = await call("POST", "/checkout", { token, headers: { "Idempotency-Key": "persist-test-0001" }, body: { fulfillment: "pickup", paymentMethod: "cash" } });
  check("cash checkout -> 201", r.status === 201, JSON.stringify(r.json));
  await persistence.flush();
  check("order saved", count("orders") === 4);
  const orderNumber = r.json.data.order ? r.json.data.order.orderNumber : r.json.data.orderNumber;

  r = await call("POST", "/favorites", { token, body: { productId: 2 } });
  await persistence.flush();
  const favs = count("favorites");
  r = await call("DELETE", "/favorites/2", { token });
  await persistence.flush();
  check("deleting a record deletes the Supabase row", count("favorites") === favs - 1);

  console.log("\n== Restart: memory wiped, data comes back from Supabase ==");
  const before = { users: db.users.length, orders: db.orders.length, orderCounter: counters.orderNumber };
  for (const name of Object.keys(db)) db[name].length = 0; // simulate a fresh process
  for (const name of Object.keys(counters)) delete counters[name];
  const again = await persistence.init(seedDemoData);
  check("second boot loads rows instead of re-seeding", again.rows > 0 && db.users.length === before.users && db.orders.length === before.orders);
  check("no duplicate demo users", db.users.filter((u) => u.email === "maya.santos@email.com").length === 1);
  check("order-number counter continues (no repeats)", counters.orderNumber === before.orderCounter);
  r = await call("GET", "/users/me", { token });
  check("old login token still works after restart", r.status === 200 && r.json.data.user.email === "persist@example.com");
  r = await call("POST", "/auth/login", { body: { identifier: "persist@example.com", password: "Password123!" } });
  check("password still verifies after restart", r.status === 200);
  r = await call("GET", "/orders", { token });
  check("order history survives restart", r.status === 200 && JSON.stringify(r.json).includes(orderNumber));
  r = await call("POST", "/auth/register", { body: { fullName: "Second Tester", email: "second@example.com", phone: "09173334444", address: "2 Test Street, Butuan", password: "Password123!", acceptTerms: true } });
  check("new records get fresh ids after restart", r.status === 201 && r.json.data.user.id > newUserId);

  console.log("\n== Supabase outage: nothing lost, retried later ==");
  r = await call("PATCH", "/users/me", { token, body: { address: "99 New Address, Butuan City" } });
  check("API still answers while Supabase is down", r.status === 200);
  fake.failNext = 1;
  let failed = false;
  try { await persistence.flush(); } catch { failed = true; }
  check("failed save is reported", failed && persistence.status().lastError !== null);
  check("/health exposes the error", (await call("GET", "/health")).json.data.storage.lastError !== null);
  await persistence.flush();
  check("next save succeeds and includes the missed change", table.get(`users:${newUserId}`).data.address === "99 New Address, Butuan City" && persistence.status().lastError === null);

  console.log("\n== Paging: more than 1000 rows ==");
  for (let i = 1; i <= 2300; i++) table.set(`contactMessages:${i}`, { collection: "contactMessages", id: i, data: { id: i, name: "n", email: "a@b.co", message: "m", createdAt: new Date().toISOString() } });
  for (const name of Object.keys(db)) db[name].length = 0;
  await persistence.init(seedDemoData);
  check("all 2300 extra rows loaded", db.contactMessages.length === 2300);
  check("data from before is still there", db.users.length === 4 && db.products.length === 13);

  console.log("\n== Wrong key / missing table -> clear startup error ==");
  const cfg = require("../config");
  const goodKey = cfg.supabase.serviceKey;
  cfg.supabase.serviceKey = "wrong-key";
  let msg = "";
  try { await persistence.init(seedDemoData); } catch (e) { msg = e.message; }
  check("bad key -> error mentions service_role key", /401/.test(msg) && /service_role/.test(msg), msg);
  cfg.supabase.serviceKey = goodKey;
  cfg.supabase.table = "missing_table";
  msg = "";
  try { await persistence.init(seedDemoData); } catch (e) { msg = e.message; }
  check("missing table -> error mentions schema.sql", /404/.test(msg) && /schema\.sql/.test(msg), msg);

  cfg.supabase.table = "brewgo_records";

  console.log("\n== Shutdown (Render redeploy) saves pending changes ==");
  await call("PATCH", "/users/me", { token, body: { address: "7 Shutdown Road, Butuan City" } });
  check("change not yet in Supabase", table.get(`users:${newUserId}`).data.address !== "7 Shutdown Road, Butuan City");
  await persistence.shutdown();
  check("shutdown() saved it", table.get(`users:${newUserId}`).data.address === "7 Shutdown Road, Butuan City");
  server.close();
  fakeSupabase.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
