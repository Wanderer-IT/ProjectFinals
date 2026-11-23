// Base class: generic CRUD over one collection of the in-memory store.
// Concrete repositories extend it and add their own finders (inheritance).
const { db, nextId } = require("../models/store");

class BaseRepository {
  constructor(collectionName) {
    this.name = collectionName;
  }
  get items() { return db[this.name]; }

  findAll(predicate = () => true) { return this.items.filter(predicate); }
  findOne(predicate) { return this.items.find(predicate); }
  findById(id) {
    const n = Number(id);
    return this.items.find((r) => r.id === n);
  }
  create(data) {
    const record = { id: nextId(this.name), ...data };
    this.items.push(record);
    return record;
  }
  update(id, changes) {
    const record = this.findById(id);
    if (!record) return undefined;
    Object.assign(record, changes);
    return record;
  }
  remove(id) {
    const index = this.items.findIndex((r) => r.id === Number(id));
    if (index === -1) return false;
    this.items.splice(index, 1);
    return true;
  }
}

module.exports = BaseRepository;
