const crypto = require("crypto");
// Every request gets an id; it is echoed in the X-Request-Id header and in error bodies.
module.exports = function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
};
