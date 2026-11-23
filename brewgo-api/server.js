const app = require("./app");
const config = require("./config");

const paymentService = require("./services/paymentService");

app.listen(config.port, () => {
  console.log(`Brew Go API running on ${config.publicApiUrl}  (base: /api/v1)  payments: ${config.payment.provider}`);
});

if (process.env.NODE_ENV !== "production") {
  console.log("Demo customer: maya.santos@email.com / Password123");
  console.log("Demo staff:    admin@brewgo.ph / Admin123!");
}

// Every 5 minutes: cancel checkouts nobody paid (releases stock + coupons).
setInterval(() => paymentService.sweepStale().catch((e) => console.error(e)), 5 * 60 * 1000).unref();
