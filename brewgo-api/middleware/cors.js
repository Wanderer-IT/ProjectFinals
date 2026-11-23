const config = require("../config");
// The React PWA lives on another origin (Vercel/Netlify), so the browser needs CORS headers.
module.exports = function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && (config.corsOrigins.includes("*") || config.corsOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key,X-Simulate-AI-Outage");
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id,Idempotent-Replayed,Retry-After");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.status(204).send();
  next();
};
