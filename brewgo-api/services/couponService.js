const { userCoupons, promoCoupons } = require("../repositories");
const { withLock } = require("../utils/mutex");
const { UnprocessableError } = require("../utils/errors");

// Finds a coupon the user is allowed to use and checks it (finals doc: 422 COUPON_EXPIRED etc.).
// Returns a small descriptor the cart/order can store.
exports.resolve = async (rawCode, user, subtotal) => {
  const code = String(rawCode).trim().toUpperCase();
  let kind = "reward";
  let record = await userCoupons.findByCode(code);
  if (record && record.userId !== user.id) record = undefined; // someone else's coupon looks like "not found"
  if (!record) {
    kind = "promo";
    record = await promoCoupons.findByCode(code);
  }
  if (!record) throw new UnprocessableError("That coupon code is not valid", "COUPON_INVALID");
  if (Date.parse(record.expiresAt) < Date.now()) throw new UnprocessableError("This coupon has expired", "COUPON_EXPIRED");

  const used = kind === "reward" ? record.status === "used" : record.usedBy.includes(user.id);
  if (used) throw new UnprocessableError("You have already used this coupon", "COUPON_ALREADY_USED");

  if (subtotal < record.minSpend) {
    throw new UnprocessableError(`Spend at least ₱${record.minSpend} to use this coupon`, "COUPON_MIN_SPEND", { minSpend: record.minSpend, subtotal });
  }
  return { code, kind, id: record.id, title: record.title, type: record.type, value: record.value };
};

// A promo code is shared by every customer, so its "usedBy" list is changed one request at a time.
const changePromoUsers = (promoId, change) =>
  withLock(`promo:${promoId}`, async () => {
    const promo = await promoCoupons.findById(promoId);
    if (promo) await promoCoupons.update(promo.id, { usedBy: change(promo.usedBy) });
  });

exports.markUsed = async (coupon, user, orderId) => {
  if (!coupon) return;
  if (coupon.kind === "reward") await userCoupons.update(coupon.id, { status: "used", usedOrderId: orderId });
  else await changePromoUsers(coupon.id, (usedBy) => (usedBy.includes(user.id) ? usedBy : [...usedBy, user.id]));
};

// Cancelled order -> the coupon becomes usable again.
exports.release = async (coupon, userId) => {
  if (!coupon) return;
  if (coupon.kind === "reward") await userCoupons.update(coupon.id, { status: "active", usedOrderId: null });
  else await changePromoUsers(coupon.id, (usedBy) => usedBy.filter((id) => id !== userId));
};
