const fs = require("fs");
const path = require("path");

(function loadEnvFile() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith("#")) return;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  });
})();

const mayaPublicKey = process.env.MAYA_PUBLIC_KEY || "";
const mayaSecretKey = process.env.MAYA_SECRET_KEY || "";
const port = Number(process.env.PORT) || 3000;
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const supabaseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "").trim();

module.exports = {
  port,
  publicApiUrl: process.env.PUBLIC_API_URL || `http://localhost:${port}`,
  frontendUrl,
  corsOrigins: (process.env.CORS_ORIGINS || `${frontendUrl},http://localhost:5173,http://localhost:4173`)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  webhookSecret: process.env.WEBHOOK_SECRET || "whsec_demo_change_me",
  aiEnabled: process.env.AI_ENABLED !== "false",
  tokenTtlHours: Number(process.env.TOKEN_TTL_HOURS) || 24,
  rateLimit: { windowMs: 60 * 1000, max: Number(process.env.RATE_LIMIT_MAX) || 30 },

  // PAYMENT_PROVIDER=maya uses the real Maya Checkout API; "mock" uses the built-in sandbox page.
  payment: {
    provider: process.env.PAYMENT_PROVIDER || (mayaPublicKey && mayaSecretKey ? "maya" : "mock"),
    maya: {
      baseUrl: (process.env.MAYA_BASE_URL || "https://pg-sandbox.paymaya.com").replace(/\/$/, ""),
      publicKey: mayaPublicKey,
      secretKey: mayaSecretKey,
      timeoutMs: 10000,
    },
    pendingExpiryMinutes: Number(process.env.PENDING_EXPIRY_MINUTES) || 65, // Maya checkout sessions last 1 hour
  },

  // Supabase persistence. Needs BOTH values; without them the API keeps data in memory only (demo mode).
  // Use the SERVICE ROLE key (server-side secret). Never put it in the React app.
  supabase: {
    enabled: Boolean(supabaseUrl && supabaseKey) && process.env.PERSISTENCE !== "off",
    url: supabaseUrl,
    serviceKey: supabaseKey,
    table: process.env.SUPABASE_TABLE || "brewgo_records",
    flushMs: Number(process.env.SUPABASE_FLUSH_MS) || 2000,
    timeoutMs: 15000,
  },

  currency: "PHP",
  deliveryFee: 50,
  pesosPerPoint: 10, // 1 point for every PHP 10 spent
  freeDrinkPoints: 150,
  signupBonusPoints: 50,
  streakTarget: 5,
  streakRewardPoints: 25,
  pickupEtaMinutes: 10,
  deliveryEtaMinutes: 35,
};
