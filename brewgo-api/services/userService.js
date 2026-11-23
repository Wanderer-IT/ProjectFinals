const { orders, favorites, paymentMethods, users } = require("../repositories");
const rewardService = require("./rewardService");
const authService = require("./authService");
const { normalizePhone, nowIso } = require("../utils/helpers");
const { NotFoundError, ConflictError, UnprocessableError } = require("../utils/errors");

// FACADE: one call builds the whole Profile screen (stats + perks card).
exports.getProfile = (user) => ({
  user: authService.toPublicUser(user),
  stats: {
    orders: orders.findByUser(user.id).filter((o) => o.status !== "cancelled").length,
    favorites: favorites.findByUser(user.id).length,
    cards: paymentMethods.findByUser(user.id).length,
  },
  perks: rewardService.summary(user),
});

exports.updateProfile = (user, body) => {
  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone);
    const owner = users.findByPhone(phone);
    if (owner && owner.id !== user.id) throw new ConflictError("That phone number is already used by another account", "PHONE_TAKEN");
    user.phone = phone;
  }
  ["fullName", "address", "avatarUrl"].forEach((f) => { if (body[f] !== undefined) user[f] = body[f]; });
  return exports.getProfile(user);
};

exports.listPaymentMethods = (user) => paymentMethods.findByUser(user.id);

exports.addPaymentMethod = (user, body) => {
  if (body.type === "card" && !body.last4) {
    throw new UnprocessableError("Please fix the highlighted fields", "VALIDATION_ERROR", [{ field: "last4", message: "last4 is required for cards" }]);
  }
  // Only the brand and last 4 digits are kept. Real card numbers belong to the payment gateway.
  return paymentMethods.create({
    userId: user.id, type: body.type, provider: body.provider, last4: body.last4 || null,
    label: body.label || (body.last4 ? `${body.provider} ending in ${body.last4}` : body.provider), createdAt: nowIso(),
  });
};

exports.removePaymentMethod = (user, id) => {
  const method = paymentMethods.findById(id);
  if (!method || method.userId !== user.id) throw new NotFoundError("Payment method", "PAYMENT_METHOD_NOT_FOUND");
  paymentMethods.remove(id);
};
