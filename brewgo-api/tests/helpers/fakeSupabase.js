// A small fake of Supabase's REST API (PostgREST) for the tests: no internet and no real project needed.
// It understands exactly what db/supabase.js sends: filters on collection/id/data paths, ordering, paging,
// insert, delete, and the three helper functions from supabase/schema.sql.
const http = require("http");

const KEY = "test-service-role-key";

function start() {
  const rows = new Map();     // "collection:id" -> { collection, id, data }
  const counters = new Map(); // counter name -> next value
  const fake = { url: null, key: KEY, rows, counters, requests: 0, failNext: 0, missingTable: false, delayMs: 0, close: null };

  const pathValue = (obj, path) => path.reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), obj);
  function matches(row, params) {
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      if (key === "collection") { if (row.collection !== raw.replace(/^eq\./, "")) return false; continue; }
      if (key === "id") {
        if (raw.startsWith("in.(")) { if (!raw.slice(4, -1).split(",").map(Number).includes(row.id)) return false; }
        else if (row.id !== Number(raw.replace(/^eq\./, ""))) return false;
        continue;
      }
      if (key.startsWith("data->")) {
        const path = key.slice(4).split(/->>?/).filter(Boolean); // "data->payment->>sessionId" -> ["payment","sessionId"]
        const value = pathValue(row.data, path);
        if (value === undefined || value === null || String(value) !== raw.replace(/^eq\./, "")) return false;
        continue;
      }
      throw new Error(`fake supabase: unsupported filter ${key}`);
    }
    return true;
  }
  const sorted = () => [...rows.values()].sort((a, b) => a.collection.localeCompare(b.collection) || a.id - b.id);

  const rpcs = {
    brewgo_next_id({ p_name, p_start = 1 }) {
      const next = counters.has(p_name) ? counters.get(p_name) : p_start;
      counters.set(p_name, next + 1);
      return next;
    },
    brewgo_adjust({ p_collection, p_id, p_field, p_delta, p_min = null }) {
      const row = rows.get(`${p_collection}:${p_id}`);
      if (!row) return null;
      const next = (Number(row.data[p_field]) || 0) + p_delta;
      if (p_min !== null && next < p_min) return null;
      row.data[p_field] = next;
      return next;
    },
    brewgo_merge({ p_collection, p_id, p_changes }) {
      const row = rows.get(`${p_collection}:${p_id}`);
      if (!row) return null;
      row.data = { ...row.data, ...p_changes };
      return row.data;
    },
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      fake.requests += 1;
      const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
      if (fake.delayMs) await new Promise((r) => setTimeout(r, fake.delayMs)); // makes concurrent requests overlap
      if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: "Invalid API key" });
      if (fake.failNext > 0) { fake.failNext -= 1; return send(500, { message: "boom" }); }
      const url = new URL(req.url, "http://x");
      const params = [...url.searchParams.entries()];
      try {
        const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
        if (rpc) {
          if (fake.missingTable || !rpcs[rpc[1]]) return send(404, { message: "function not found" });
          const result = rpcs[rpc[1]](raw ? JSON.parse(raw) : {});
          return send(200, result === undefined ? null : result);
        }
        if (url.pathname !== "/rest/v1/brewgo_records" || fake.missingTable) return send(404, { message: "table not found" });
        if (req.method === "GET") {
          const limit = Number(url.searchParams.get("limit") || 1000), offset = Number(url.searchParams.get("offset") || 0);
          const found = sorted().filter((r) => matches(r, params)).slice(offset, offset + limit);
          return send(200, found.map(({ collection, id, data }) => ({ collection, id, data })));
        }
        if (req.method === "POST") {
          const row = JSON.parse(raw);
          const key = `${row.collection}:${row.id}`;
          if (rows.has(key)) return send(409, { message: "duplicate key" });
          rows.set(key, { collection: row.collection, id: row.id, data: row.data });
          return send(201);
        }
        if (req.method === "DELETE") {
          if (!params.length) return send(400, { message: "DELETE needs a filter" });
          const gone = sorted().filter((r) => matches(r, params));
          gone.forEach((r) => rows.delete(`${r.collection}:${r.id}`));
          return req.headers.prefer === "return=representation" ? send(200, gone) : send(204);
        }
        send(405, {});
      } catch (err) {
        send(500, { message: err.message });
      }
    });
  });

  return new Promise((resolve) => server.listen(0, () => {
    fake.url = `http://localhost:${server.address().port}`;
    fake.close = () => new Promise((r) => server.close(r));
    // convenience for assertions
    fake.count = (collection) => [...rows.values()].filter((r) => r.collection === collection).length;
    fake.all = (collection) => [...rows.values()].filter((r) => r.collection === collection).map((r) => r.data);
    resolve(fake);
  }));
}

module.exports = { start, KEY };
