const crypto = require("crypto");
const config = require("../config");
const { users, sessions } = require("../repositories");
const rewardService = require("./rewardService");
const notificationService = require("./notificationService");
const { hashPassword, verifyPassword } = require("../utils/password");
const { normalizePhone, nowIso } = require("../utils/helpers");
const { ConflictError, UnauthorizedError } = require("../utils/errors");

// Never send passwordHash to the client.
function toPublicUser(user) {
  return {
    id: user.id, fullName: user.fullName, email: user.email, phone: user.phone,
    phoneDisplay: `+63 ${user.phone.slice(1, 4)} ${user.phone.slice(4, 7)} ${user.phone.slice(7)}`,
    address: user.address, avatarUrl: user.avatarUrl, role: user.role,
    tier: rewardService.tierFor(user.lifetimePoints),
    pointsBalance: user.pointsBalance, createdAt: user.createdAt,
  };
}

async function startSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.tokenTtlHours * 3600 * 1000).toISOString();
  await sessions.create({ token, userId: user.id, expiresAt, createdAt: nowIso() });
  return { token, tokenType: "Bearer", expiresAt, user: toPublicUser(user) };
}

exports.toPublicUser = toPublicUser;

exports.register = async (body) => {
  if (await users.findByEmail(body.email)) throw new ConflictError("An account with this email already exists", "EMAIL_TAKEN");
  if (await users.findByPhone(body.phone)) throw new ConflictError("An account with this phone number already exists", "PHONE_TAKEN");
  const user = await users.create({
    role: "customer", fullName: body.fullName, email: body.email.toLowerCase(), phone: normalizePhone(body.phone),
    address: body.address, passwordHash: hashPassword(body.password), avatarUrl: null,
    pointsBalance: 0, lifetimePoints: 0, createdAt: nowIso(),
  });
  await rewardService.addPoints(user, config.signupBonusPoints, "SIGNUP_BONUS", "Welcome bonus");
  await notificationService.push(user.id, "rewards", "Welcome to Brew Go!", `You got ${config.signupBonusPoints} bonus points for signing up.`);
  return startSession(user);
};

exports.login = async ({ identifier, password }) => {
  const user = await users.findByIdentifier(identifier);
  // Same message for "no such user" and "wrong password" so nobody can probe which accounts exist.
  if (!user || !verifyPassword(password, user.passwordHash)) throw new UnauthorizedError("Incorrect email/phone or password", "INVALID_CREDENTIALS");
  return startSession(user);
};

exports.logout = (token) => sessions.removeByToken(token);
