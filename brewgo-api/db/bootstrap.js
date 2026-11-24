// Startup: check that Supabase is reachable and set up (table + helper functions), and put the demo data
// in ONLY when the database is completely empty (first run).
const database = require("./supabase");

async function initDatabase({ seed = true } = {}) {
  database.assertConfigured();
  const { empty } = await database.verify();
  if (empty && seed) {
    const { seedDemoData } = require("../models/seedDemo"); // loaded only when needed
    await seedDemoData();
    return { database: "supabase", seeded: true };
  }
  return { database: "supabase", seeded: false };
}

module.exports = { initDatabase };
