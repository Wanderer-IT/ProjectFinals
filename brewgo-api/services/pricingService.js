const config = require("../config");
const { money } = require("../utils/helpers");

// STRATEGY PATTERN (Lab 4): fee and discount rules are swappable classes,
// so there are no if/else blocks for every option.
class FeeStrategy { calculate() { throw new Error("calculate() must be implemented"); } }
class PickupFee extends FeeStrategy { calculate() { return 0; } }
class DeliveryFee extends FeeStrategy { calculate() { return config.deliveryFee; } }

class DiscountStrategy { calculate() { throw new Error("calculate() must be implemented"); } }
class NoDiscount extends DiscountStrategy { calculate() { return 0; } }
class FixedDiscount extends DiscountStrategy { calculate(subtotal, coupon) { return Math.min(coupon.value, subtotal); } }
class PercentDiscount extends DiscountStrategy { calculate(subtotal, coupon) { return money((subtotal * coupon.value) / 100); } }

const FEES = { pickup: new PickupFee(), delivery: new DeliveryFee() };
const DISCOUNTS = { fixed: new FixedDiscount(), percent: new PercentDiscount() };
const NONE = new NoDiscount();

// CONTEXT: the ONLY place totals are calculated. The client never sends prices.
exports.quote = (lines, fulfillment, coupon) => {
  const subtotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const discount = coupon ? money((DISCOUNTS[coupon.type] || NONE).calculate(subtotal, coupon)) : 0;
  const deliveryFee = lines.length ? FEES[fulfillment].calculate() : 0;
  return { subtotal, discount, deliveryFee, total: money(subtotal - discount + deliveryFee), currency: config.currency };
};
