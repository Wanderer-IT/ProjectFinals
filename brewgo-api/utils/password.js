// Passwords are never stored in plain text. Uses Node's built-in crypto module.
const crypto = require("crypto");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(attempt, Buffer.from(hash, "hex"));
}
module.exports = { hashPassword, verifyPassword };
