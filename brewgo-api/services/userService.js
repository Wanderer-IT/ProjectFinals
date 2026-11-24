const { orders, favorites, paymentMethods, users } = require("../repositories");
const rewardService = require("./rewardService");
const authService = require("./authService");
const { normalizePhone, nowIso } = require("../utils/helpers");
const { NotFoundError, ConflictError, UnprocessableError } = require("../utils/errors");

// FACADE: one call builds the whole Profile screen (stats + perks card).
exports.getProfile = async (user) => {
  const [myOrders, myFavorites, myCards, perks] = await Promise.all([
    orders.findByUser(user.id), favorites.findByUser(user.id), paymentMethods.findByUser(user.id), rewardService.summary(user),
  ]);
  return {
    user: authService.toPublicUser(user),
    stats: { orders: myOrders.filter((o) => o.status !== "cancelled").length, favorites: myFavorites.length, cards: myCards.length },
    perks,
  };
};

exports.updateProfile = async (user, body) => {
  const changes = {};
  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone);
    const owner = await users.findByPhone(phone);
    if (owner && owner.id !== user.id) throw new ConflictError("That phone number is already used by another account", "PHONE_TAKEN");
    changes.phone = phone;
  }
  ["fullName", "address", "avatarUrl"].forEach((f) => { if (body[f] !== undefined) changes[f] = body[f]; });
  const updated = Object.keys(changes).length ? (await users.update(user.id, changes)) || user : user;
  return exports.getProfile(updated);
};

exports.listPaymentMethods = (user) => paymentMethods.findByUser(user.id);

exports.addPaymentMethod = async (user, body) => {
  if (body.type === "card" && !body.last4) {
    throw new UnprocessableError("Please fix the highlighted fields", "VALIDATION_ERROR", [{ field: "last4", message: "last4 is required for cards" }]);
  }
  // Only the brand and last 4 digits are kept. Real card numbers belong to the payment gateway.
  return await paymentMethods.create({
    userId: user.id, type: body.type, provider: body.provider, last4: body.last4 || null,
    label: body.label || (body.last4 ? `${body.provider} ending in ${body.last4}` : body.provider), createdAt: nowIso(),
  });
};

exports.removePaymentMethod = async (user, id) => {
  const method = await paymentMethods.findById(id);
  if (!method || method.userId !== user.id) throw new NotFoundError("Payment method", "PAYMENT_METHOD_NOT_FOUND");
  await paymentMethods.remove(id);
};
