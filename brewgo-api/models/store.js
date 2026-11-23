// SINGLETON: Node caches this module, so every file that requires it shares the
// same in-memory "database". DEMO ONLY - restarting the server resets all data
// (a real API would use a database).
const db = {
  users: [], sessions: [], branches: [], products: [], carts: [], orders: [],
  favorites: [], notifications: [], paymentMethods: [],
  rewards: [], userCoupons: [], promoCoupons: [], ledger: [], streaks: [], missionLog: [],
  idempotency: [], contactMessages: [], paymentSessions: [],
};

const counters = {};
function nextId(name, start = 1) {
  if (!(name in counters)) counters[name] = start;
  return counters[name]++;
}

module.exports = { db, nextId, counters };
