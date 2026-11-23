const app = require("./app");
const config = require("./config");
const paymentService = require("./services/paymentService");
const persistence = require("./models/persistence");
const { seedDemoData } = require("./models/seedDemo");

async function main() {
  // With Supabase: load saved data first (seeds demo data only if the database is empty). Fails fast if Supabase is unreachable.
  const storage = await persistence.init(seedDemoData);

  const server = app.listen(config.port, () => {
    console.log(`Brew Go API running on ${config.publicApiUrl}  (base: /api/v1)  payments: ${config.payment.provider}  storage: ${storage.storage}`);
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("Demo customer: maya.santos@email.com / Password123");
    console.log("Demo staff:    admin@brewgo.ph / Admin123!");
  }

  setInterval(() => paymentService.sweepStale().catch((e) => console.error(e)), 5 * 60 * 1000).unref();

  // Render sends SIGTERM on every redeploy/restart: save everything first.
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: saving data and shutting down...`);
    server.close();
    await persistence.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
