// SINGLETON: Node caches this module, so the whole app shares ONE database client (and one config).
// This is the ONLY place that talks to the database (Supabase's REST API, "PostgREST").
// There is no copy of the data in the server's memory: every read and write goes through here.
const config = require("../config");
const { ServiceUnavailableError } = require("../utils/errors");

const TABLE = "brewgo_records";
const PAGE = 1000; // Supabase returns at most 1000 rows per request

function assertConfigured() {
  const { url, serviceKey } = config.supabase;
  if (!url || !serviceKey) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (see .env.example).");
  }
}

// Low-level call. Network/Supabase problems become a clean 503 for the client; the real reason is logged.
async function request(method, path, { body, prefer } = {}) {
  assertConfigured();
  const { url, serviceKey, timeoutMs } = config.supabase;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  let res;
  try {
    res = await fetch(`${url}/rest/v1/${path}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const why = (err.cause && (err.cause.code || err.cause.message)) || err.message;
    throw databaseError(`Cannot reach Supabase at ${url} (${why}). Check SUPABASE_URL and your internet connection.`);
  }
  const text = await res.text();
  if (!res.ok) {
    let hint = "";
    if (res.status === 404) hint = " (do the table and functions exist? run supabase/schema.sql in the Supabase SQL Editor)";
    if (res.status === 401 || res.status === 403) hint = " (check SUPABASE_SERVICE_ROLE_KEY: use the service_role key, not the anon key)";
    throw databaseError(`Supabase ${method} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 200)}${hint}`, res.status);
  }
  return text ? JSON.parse(text) : null;
}

function databaseError(message, status) {
  console.error(`[database] ${message}`);
  const error = new ServiceUnavailableError("The database is not reachable right now. Please try again in a moment.", "DATABASE_UNAVAILABLE");
  error.cause = message;
  error.upstreamStatus = status;
  return error;
}

const qs = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// { userId: 5, "payment.sessionId": "x" }  ->  data->>userId=eq.5 & data->payment->>sessionId=eq.x
function whereParams(where = {}) {
  return Object.entries(where).map(([path, value]) => {
    const parts = path.split(".");
    const last = parts.pop();
    return [`data${parts.map((p) => `->${p}`).join("")}->>${last}`, `eq.${value}`];
  });
}

// Returns the matching records (the JSON "data" of each row), ordered by id.
async function select(collection, where = {}, { ids, limit } = {}) {
  const base = [["select", "data"], ["collection", `eq.${collection}`], ...whereParams(where), ["order", "id.asc"]];
  if (ids) base.push(["id", `in.(${ids.join(",")})`]);
  const records = [];
  for (let offset = 0; ; offset += PAGE) {
    const size = limit === undefined ? PAGE : Math.min(PAGE, limit - records.length);
    const page = await request("GET", `${TABLE}?${qs([...base, ["limit", size], ["offset", offset]])}`);
    records.push(...page.map((row) => row.data));
    if (page.length < size || (limit !== undefined && records.length >= limit)) break;
  }
  return records;
}

async function insert(collection, id, data) {
  await request("POST", TABLE, { body: { collection, id, data }, prefer: "return=minimal" });
}

async function remove(collection, where = {}, { ids } = {}) {
  if (!ids && Object.keys(where).length === 0) throw new Error("remove() needs a filter: refusing to delete a whole collection");
  const pairs = [["collection", `eq.${collection}`], ...whereParams(where)];
  if (ids) pairs.push(["id", `in.(${ids.join(",")})`]);
  const deleted = await request("DELETE", `${TABLE}?${qs(pairs)}`, { prefer: "return=representation" });
  return Array.isArray(deleted) ? deleted.length : 0;
}

const rpc = (name, args) => request("POST", `rpc/${name}`, { body: args });

// Next id for a counter. Postgres hands out each number exactly once, even with many requests at the same time.
const nextId = (name, start = 1) => rpc("brewgo_next_id", { p_name: name, p_start: start });

// Used at startup and by /health.
async function isEmpty() {
  assertConfigured();
  const rows = await request("GET", `${TABLE}?${qs([["select", "id"], ["limit", 1]])}`);
  return rows.length === 0;
}

// Fails with a clear message when the table is missing, the key is wrong, or the helper functions were not installed.
async function verify() {
  const empty = await isEmpty();
  await rpc("brewgo_adjust", { p_collection: "_check", p_id: 0, p_field: "x", p_delta: 0 });
  return { empty };
}

async function ping() {
  try {
    assertConfigured();
    await isEmpty();
    return { database: "supabase", reachable: true };
  } catch (err) {
    return { database: "supabase", reachable: false, error: err.cause || err.message };
  }
}

module.exports = { select, insert, remove, rpc, nextId, isEmpty, verify, ping, assertConfigured };
