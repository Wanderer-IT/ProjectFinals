const { sessions, users } = require("../repositories");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");

function readToken(req) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function loadUser(token) {
  const session = sessions.findByToken(token);
  if (!session) return { error: new UnauthorizedError("Invalid or expired token", "TOKEN_INVALID") };
  if (Date.parse(session.expiresAt) < Date.now()) {
    sessions.removeByToken(token);
    return { error: new UnauthorizedError("Your session has expired. Please log in again.", "TOKEN_EXPIRED") };
  }
  const user = users.findById(session.userId);
  if (!user) return { error: new UnauthorizedError("Account no longer exists", "TOKEN_INVALID") };
  return { user };
}

// Required login: 401 when the bearer token is missing/invalid/expired.
function authenticate(req, res, next) {
  const token = readToken(req);
  if (!token) throw new UnauthorizedError("Missing bearer token", "TOKEN_MISSING");
  const { user, error } = loadUser(token);
  if (error) throw error;
  req.user = user;
  req.token = token;
  next();
}

// Public route that personalises the answer when a valid token is present.
function optionalAuthenticate(req, res, next) {
  const token = readToken(req);
  if (token) {
    const { user } = loadUser(token);
    if (user) { req.user = user; req.token = token; }
  }
  next();
}

// 403 when logged in but the role is not allowed.
const requireRole = (role) => (req, res, next) => {
  if (req.user.role !== role) throw new ForbiddenError("This action is restricted to store staff", "FORBIDDEN");
  next();
};

module.exports = { authenticate, optionalAuthenticate, requireRole };
