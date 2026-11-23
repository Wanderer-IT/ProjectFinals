// Validation rules for every endpoint that accepts a JSON body.
const { validateBody } = require("./validate");
const { normalizePhone } = require("../utils/helpers");

const CATEGORIES = ["hot", "iced", "pastries"];
const FULFILLMENT = ["pickup", "delivery"];
const PAYMENT_METHODS = ["ewallet", "card", "cash"];
const ORDER_STATUSES = ["pending_payment", "paid", "preparing", "ready", "completed", "cancelled"];

const emailRule = { type: "string", required: true, max: 120, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: "email is invalid" };
const phoneRule = { type: "string", custom: (v) => (normalizePhone(v) ? null : "phone must be a valid Philippine mobile number (e.g. 917 123 4567)") };

exports.CATEGORIES = CATEGORIES;
exports.FULFILLMENT = FULFILLMENT;
exports.PAYMENT_METHODS = PAYMENT_METHODS;
exports.ORDER_STATUSES = ORDER_STATUSES;

exports.validateRegister = validateBody({
  fullName: { type: "string", required: true, min: 2, max: 80 },
  email: emailRule,
  phone: { ...phoneRule, required: true },
  address: { type: "string", required: true, min: 5, max: 200 },
  password: { type: "string", required: true, min: 8, max: 72, trim: false, patternMessage: "password must be at least 8 characters" },
  acceptTerms: { type: "boolean", required: true, mustBe: true, mustBeMessage: "You must agree to the Terms of Service and Privacy Policy" },
});

exports.validateLogin = validateBody({
  identifier: { type: "string", required: true, max: 120, label: "email or phone number" },
  password: { type: "string", required: true, max: 72, trim: false },
});

exports.validateProfileUpdate = validateBody({
  fullName: { type: "string", min: 2, max: 80 },
  phone: phoneRule,
  address: { type: "string", min: 5, max: 200 },
  avatarUrl: { type: "string", max: 500 },
}, { partial: true });

exports.validatePaymentMethod = validateBody({
  type: { type: "string", required: true, enum: ["ewallet", "card"] },
  provider: { type: "string", required: true, min: 2, max: 30 },
  last4: { type: "string", pattern: /^\d{4}$/, patternMessage: "last4 must be exactly 4 digits" },
  label: { type: "string", max: 60 },
});

const productRules = {
  name: { type: "string", required: true, min: 2, max: 80 },
  description: { type: "string", max: 300 },
  category: { type: "string", required: true, enum: CATEGORIES },
  price: { type: "number", required: true, min: 1, max: 5000 },
  imageUrl: { type: "string", max: 300 },
  stock: { type: "integer", required: true, min: 0, max: 10000 },
  isBestSeller: { type: "boolean" },
  available: { type: "boolean" },
  plantBased: { type: "boolean" },
  tags: { type: "array", itemType: "string", max: 12 },
};
exports.validateProductCreate = validateBody(productRules);        // POST + PUT: core fields required
exports.validateProductPatch = validateBody(productRules, { partial: true }); // PATCH: only what is sent

exports.validateFavorite = validateBody({ productId: { type: "integer", required: true, min: 1 } });

exports.validateCartItem = validateBody({
  productId: { type: "integer", required: true, min: 1 },
  quantity: { type: "integer", min: 1, max: 20 },
  options: { type: "object" },
  note: { type: "string", max: 140 },
});
exports.validateCartItemUpdate = validateBody({
  quantity: { type: "integer", min: 1, max: 20 },
  options: { type: "object" },
  note: { type: "string", max: 140 },
}, { partial: true });

exports.validateCoupon = validateBody({ code: { type: "string", required: true, min: 3, max: 32 } });

exports.validateCheckout = validateBody({
  fulfillment: { type: "string", required: true, enum: FULFILLMENT },
  paymentMethod: { type: "string", required: true, enum: PAYMENT_METHODS },
  branchId: { type: "integer", min: 1 },
  pickupTime: { type: "string", pattern: /^(ASAP|([01]\d|2[0-3]):[0-5]\d)$/, patternMessage: 'pickupTime must be "ASAP" or a 24-hour time like "14:30"' },
  deliveryAddress: { type: "string", min: 5, max: 200 },
  couponCode: { type: "string", max: 32 },
  note: { type: "string", max: 140 },
});

exports.validateOrderStatus = validateBody({ status: { type: "string", required: true, enum: ORDER_STATUSES } });
exports.validateRedeem = validateBody({ rewardId: { type: "integer", required: true, min: 1 } });
exports.validateAiQuery = validateBody({ query: { type: "string", required: true, min: 3, max: 200 } });

exports.validateContact = validateBody({
  name: { type: "string", required: true, min: 2, max: 80 },
  email: emailRule,
  message: { type: "string", required: true, min: 10, max: 1000 },
  channel: { type: "string", enum: ["chat", "call", "email"] },
  orderId: { type: "integer", min: 1 },
});
