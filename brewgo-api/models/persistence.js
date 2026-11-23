const config = require("../config");
const { db, counters } = require("./store");

const cfg = config.supabase;
const enabled = cfg.enabled;
const META = "_meta";
const PAGE = 1000;
const CHUNK = 200;

const persisted = new Map();
let timer = null;
let flushing = null;
const state = { lastFlushAt: null, lastError: null };

async function request(method, query, { body, prefer } = {}) {
  const headers = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  let res;
  try {
    res = await fetch(`${cfg.url}/rest/v1/${cfg.table}${query}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    const why = (err.cause && (err.cause.code || err.cause.message)) || err.message;
    throw new Error(`Cannot reach Supabase at ${cfg.url} (${why}). Check SUPABASE_URL and your internet connection.`);
  }
  const text = await res.text();
  if (!res.ok) {
    let hint = "";
    if (res.status === 404) hint = ` (does the table exist? run supabase/schema.sql in the Supabase SQL Editor)`;
    if (res.status === 401 || res.status === 403) hint = " (check SUPABASE_SERVICE_ROLE_KEY: use the service_role key, not the anon key)";
    throw new Error(`Supabase ${method} ${res.status}: ${text.slice(0, 200)}${hint}`);
  }
  return text ? JSON.parse(text) : null;
}

async function loadAll() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await request("GET", `?select=collection,id,data&order=collection.asc,id.asc&limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  for (const name of Object.keys(db)) db[name].length = 0;
  for (const name of Object.keys(counters)) delete counters[name];
  persisted.clear();

  for (const row of rows) {
    if (row.collection === META) {
      Object.assign(counters, (row.data && row.data.counters) || {});
    } else if (db[row.collection]) {
      db[row.collection].push(row.data);
    } else {
      continue;
    }
    persisted.set(`${row.collection}:${row.id}`, JSON.stringify(row.data));
  }
  for (const name of Object.keys(db)) {
    const maxId = db[name].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    if (maxId) counters[name] = Math.max(counters[name] || 1, maxId + 1);
  }
  return rows.length;
}

function snapshot() {
  const current = new Map();
  for (const name of Object.keys(db)) {
    for (const rec of db[name]) {
      if (!rec || !Number.isInteger(rec.id)) continue;
      current.set(`${name}:${rec.id}`, { collection: name, id: rec.id, json: JSON.stringify(rec) });
    }
  }
  current.set(`${META}:1`, { collection: META, id: 1, json: JSON.stringify({ counters }) });
  return current;
}

async function doFlush() {
  const current = snapshot();
  const upserts = [];
  for (const [key, rec] of current) if (persisted.get(key) !== rec.json) upserts.push([key, rec]);
  const deletes = new Map();
  for (const key of persisted.keys()) {
    if (current.has(key)) continue;
    const i = key.lastIndexOf(":");
    const name = key.slice(0, i);
    if (!deletes.has(name)) deletes.set(name, []);
    deletes.get(name).push(Number(key.slice(i + 1)));
  }

  try {
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const chunk = upserts.slice(i, i + CHUNK);
      const now = new Date().toISOString();
      const body = chunk.map(([, r]) => ({ collection: r.collection, id: r.id, data: JSON.parse(r.json), updated_at: now }));
      await request("POST", "?on_conflict=collection,id", { body, prefer: "resolution=merge-duplicates,return=minimal" });
      for (const [key, r] of chunk) persisted.set(key, r.json);
    }
    for (const [name, ids] of deletes) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        await request("DELETE", `?collection=eq.${encodeURIComponent(name)}&id=in.(${part.join(",")})`, { prefer: "return=minimal" });
        for (const id of part) persisted.delete(`${name}:${id}`);
      }
    }
    state.lastFlushAt = new Date().toISOString();
    state.lastError = null;
  } catch (err) {
    state.lastError = err.message;
    throw err;
  }
}

function flush() {
  if (!enabled) return Promise.resolve();
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function init(seedFn) {
  if (!enabled) return { storage: "memory" };
  const rows = await loadAll();
  if (rows === 0 && seedFn) {
    seedFn();
    await flush();
  }
  if (!timer) {
    timer = setInterval(() => {
      flush().catch((err) => console.error(`[supabase] save failed, will retry: ${err.message}`));
    }, cfg.flushMs);
    timer.unref();
  }
  return { storage: "supabase", rows };
}

async function shutdown() {
  if (timer) { clearInterval(timer); timer = null; }
  if (!enabled) return;
  try {
    if (flushing) await flushing.catch(() => {});
    await flush();
  } catch (err) {
    console.error(`[supabase] final save failed: ${err.message}`);
  }
}

const status = () => ({ storage: enabled ? "supabase" : "memory", lastSavedAt: state.lastFlushAt, lastError: state.lastError });

module.exports = { enabled, init, flush, shutdown, status };