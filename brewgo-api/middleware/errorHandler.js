const ApiResponseBuilder = require("../utils/ApiResponseBuilder");
const { AppError, NotFoundError, TooManyRequestsError } = require("../utils/errors");

// Unknown route -> 404 in the standard envelope
exports.notFound = (req, res, next) => {
  next(new NotFoundError(`${req.method} ${req.path}`, "ROUTE_NOT_FOUND"));
};

// One place that turns ANY error into the error envelope.
exports.errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong on our side. Please try again.";
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
    if (err instanceof TooManyRequestsError) res.setHeader("Retry-After", String(err.retryAfter));
  } else if (err.type === "entity.parse.failed") {
    status = 400; code = "BAD_JSON"; message = "Request body contains invalid JSON";
  } else if (err.type === "entity.too.large") {
    status = 413; code = "PAYLOAD_TOO_LARGE"; message = "Request body is too large";
  } else {
    console.error(`[${req.id}] Unexpected error:`, err);
  }

  new ApiResponseBuilder().status(status).failure(code, message, details).requestId(req.id).send(res);
};
