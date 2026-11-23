const config = require("../config");
const { TooManyRequestsError } = require("../utils/errors");

// Simple in-memory limiter -> 429 Too Many Requests + Retry-After (see "Consuming APIs").
module.exports = function rateLimit(name, max = config.rateLimit.max, windowMs = config.rateLimit.windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      throw new TooManyRequestsError(`Too many ${name} requests. Please wait a moment.`, "RATE_LIMITED", Math.ceil((entry.resetAt - now) / 1000));
    }
    next();
  };
};
