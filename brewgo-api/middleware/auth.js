const { sessions, users } = require("../repositories");
const { acquire } = require("../utils/mutex");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);

function readToken(req) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

// Finds the session, then the user. For requests that CHANGE data (not GET) the customer's requests are put in line,
// so two taps at the same moment (double "add to cart", double "checkout") are handled one after the other.
async function loadUser(token, res, { lock }) {
  const session = await sessions.findByToken(token);
  if (!session) return { error: new UnauthorizedError("Invalid or expired token", "TOKEN_INVALID") };
  if (Date.parse(session.expiresAt) < Date.now()) {
    await sessions.removeByToken(token);
    return { error: new UnauthorizedError("Your session has expired. Please log in again.", "TOKEN_EXPIRED") };
  }
  const release = lock ? await acquire(`user:${session.userId}`) : null;
  if (release) res.once("close", release);
  const user = await users.findById(session.userId); // loaded AFTER the lock, so it is the freshest copy
  if (!user) return { error: new UnauthorizedError("Account no longer exists", "TOKEN_INVALID") };
  return { user };
}

// Required login: 401 when the bearer token is missing/invalid/expired.
async function authenticate(req, res, next) {
  const token = readToken(req);
  if (!token) throw new UnauthorizedError("Missing bearer token", "TOKEN_MISSING");
  const { user, error } = await loadUser(token, res, { lock: !READ_ONLY.has(req.method) });
  if (error) throw error;
  req.user = user;
  req.token = token;
  next();
}

// Public route that personalises the answer when a valid token is present.
async function optionalAuthenticate(req, res, next) {
  const token = readToken(req);
  if (token) {
    const { user } = await loadUser(token, res, { lock: false });
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
