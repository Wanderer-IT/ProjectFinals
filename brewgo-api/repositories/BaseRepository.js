// Base class: generic CRUD over one collection, stored in Supabase.
// Concrete repositories extend it and add their own finders (inheritance).
// Every method is async: the data lives in the database, not in memory.
const db = require("../db/supabase");

class BaseRepository {
  constructor(collectionName) {
    this.name = collectionName;
  }

  // where = { field: value, "nested.field": value }  (all must match)
  findAll(where = {}) { return db.select(this.name, where); }
  async findOne(where) { return (await db.select(this.name, where, { limit: 1 }))[0]; }
  async findById(id) {
    const n = Number(id);
    if (!Number.isSafeInteger(n)) return undefined;
    return (await db.select(this.name, {}, { ids: [n], limit: 1 }))[0];
  }
  async findByIds(ids) {
    const list = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
    return list.length ? db.select(this.name, {}, { ids: list }) : [];
  }

  async create(data) {
    const record = { id: await db.nextId(this.name), ...data };
    await db.insert(this.name, record.id, record);
    return record;
  }

  // Changes only the given fields (the other fields are untouched). Returns the whole updated record, or undefined.
  async update(id, changes) {
    const merged = await db.rpc("brewgo_merge", { p_collection: this.name, p_id: Number(id), p_changes: changes });
    return merged || undefined;
  }

  // Atomic "add delta to a number field" (stock, points). Returns the new value, or null if it would go below `min`.
  adjust(id, field, delta, min = null) {
    return db.rpc("brewgo_adjust", { p_collection: this.name, p_id: Number(id), p_field: field, p_delta: delta, p_min: min });
  }

  async remove(id) { return (await db.remove(this.name, {}, { ids: [Number(id)] })) > 0; }
  removeWhere(where) { return db.remove(this.name, where); }
}

module.exports = BaseRepository;
