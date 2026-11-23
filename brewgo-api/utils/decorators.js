// DECORATOR PATTERN (lecture: "withLogging(handler)").
// Adds request logging to a controller function without changing the function itself.
function withLogging(handler, label) {
  if (process.env.LOG_REQUESTS === "false") return handler;
  return function logged(req, res, next) {
    const started = Date.now();
    res.on("finish", () => {
      console.log(`[${req.id ? req.id.slice(0, 8) : "-"}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms) ${label}`);
    });
    return handler(req, res, next);
  };
}

// Decorate every function of a controller object in one go.
function decorateController(name, controller) {
  const result = {};
  for (const [key, fn] of Object.entries(controller)) result[key] = withLogging(fn, `${name}.${key}`);
  return result;
}

module.exports = { withLogging, decorateController };
