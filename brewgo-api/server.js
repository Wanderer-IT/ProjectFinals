const app = require("./app");
const config = require("./config");
const paymentService = require("./services/paymentService");
const { initDatabase } = require("./db/bootstrap");

async function main() {
  // Supabase is the only database. Fail fast (with a clear message) if it is not configured or not reachable,
  // and put the demo data in only when the database is completely empty.
  const db = await initDatabase();

  const server = app.listen(config.port, () => {
    console.log(`Brew Go API running on ${config.publicApiUrl}  (base: /api/v1)  payments: ${config.payment.provider}  database: supabase${db.seeded ? " (demo data added)" : ""}`);
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("Demo customer: maya.santos@email.com / Password123");
    console.log("Demo staff:    admin@brewgo.ph / Admin123!");
  }

  setInterval(() => paymentService.sweepStale().catch((e) => console.error(e)), 5 * 60 * 1000).unref();

  // Render sends SIGTERM on every redeploy/restart. Nothing needs saving (every change is already in Supabase).
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((err) => {
  console.error(`Startup failed: ${err.cause || err.message}`);
  process.exit(1);
});
