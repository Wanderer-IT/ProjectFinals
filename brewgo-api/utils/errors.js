// One base error + small subclasses (inheritance). Every error carries the
// HTTP status and a machine-readable code that the React app can switch on.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "BAD_REQUEST", details) { super(400, code, message, details); }
}
class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", code = "UNAUTHORIZED", details) { super(401, code, message, details); }
}
class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that", code = "FORBIDDEN", details) { super(403, code, message, details); }
}
class NotFoundError extends AppError {
  constructor(resource = "Resource", code = "NOT_FOUND", details) { super(404, code, `${resource} not found`, details); }
}
class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT", details) { super(409, code, message, details); }
}
class UnprocessableError extends AppError {
  constructor(message = "Validation failed", code = "VALIDATION_ERROR", details) { super(422, code, message, details); }
}
class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests", code = "RATE_LIMITED", retryAfter = 60) {
    super(429, code, message, { retryAfterSeconds: retryAfter });
    this.retryAfter = retryAfter;
  }
}
class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", code = "SERVICE_UNAVAILABLE", details) { super(503, code, message, details); }
}

module.exports = {
  AppError, BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError,
  ConflictError, UnprocessableError, TooManyRequestsError, ServiceUnavailableError,
};
