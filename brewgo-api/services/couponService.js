const { userCoupons, promoCoupons } = require("../repositories");
const { UnprocessableError } = require("../utils/errors");

// Finds a coupon the user is allowed to use and checks it (finals doc: 422 COUPON_EXPIRED etc.).
// Returns a small descriptor the cart/order can store.
exports.resolve = (rawCode, user, subtotal) => {
  const code = String(rawCode).trim().toUpperCase();
  let kind = "reward";
  let record = userCoupons.findByCode(code);
  if (record && record.userId !== user.id) record = undefined; // someone else's coupon looks like "not found"
  if (!record) {
    kind = "promo";
    record = promoCoupons.findByCode(code);
  }
  if (!record) throw new UnprocessableError("That coupon code is not valid", "COUPON_INVALID");
  if (Date.parse(record.expiresAt) < Date.now()) throw new UnprocessableError("This coupon has expired", "COUPON_EXPIRED");

  const used = kind === "reward" ? record.status === "used" : record.usedBy.includes(user.id);
  if (used) throw new UnprocessableError("You have already used this coupon", "COUPON_ALREADY_USED");

  if (subtotal < record.minSpend) {
    throw new UnprocessableError(`Spend at least \u20B1${record.minSpend} to use this coupon`, "COUPON_MIN_SPEND", { minSpend: record.minSpend, subtotal });
  }
  return { code, kind, id: record.id, title: record.title, type: record.type, value: record.value };
};

exports.markUsed = (coupon, user, orderId) => {
  if (!coupon) return;
  if (coupon.kind === "reward") Object.assign(userCoupons.findById(coupon.id), { status: "used", usedOrderId: orderId });
  else promoCoupons.findById(coupon.id).usedBy.push(user.id);
};

// Cancelled order -> the coupon becomes usable again.
exports.release = (coupon, userId) => {
  if (!coupon) return;
  if (coupon.kind === "reward") Object.assign(userCoupons.findById(coupon.id) || {}, { status: "active", usedOrderId: null });
  else {
    const promo = promoCoupons.findById(coupon.id);
    if (promo) promo.usedBy = promo.usedBy.filter((id) => id !== userId);
  }
};
