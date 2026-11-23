// ROUTES = the contract: URL + method -> middleware chain -> controller.
const express = require("express");
const { authenticate, optionalAuthenticate, requireRole } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const v = require("../middleware/validators");
const auth = require("../controllers/authController");
const users = require("../controllers/userController");
const catalog = require("../controllers/catalogController");
const cart = require("../controllers/cartController");
const orders = require("../controllers/orderController");
const payments = require("../controllers/paymentController");
const extras = require("../controllers/rewardController");
const { ok } = require("../utils/respond");

const router = express.Router();
const authLimiter = rateLimit("login");
const publicLimiter = rateLimit("public", 60);
const staff = [authenticate, requireRole("admin")];

router.get("/health", (req, res) => ok(res, { status: "ok", service: "brewgo-api", version: "v1", time: new Date().toISOString() }));

// --- Auth ---
router.post("/auth/register", authLimiter, v.validateRegister, auth.register);
router.post("/auth/login", authLimiter, v.validateLogin, auth.login);
router.post("/auth/logout", authenticate, auth.logout);

// --- Profile ---
router.get("/users/me", authenticate, users.me);
router.patch("/users/me", authenticate, v.validateProfileUpdate, users.updateMe);
router.get("/users/me/payment-methods", authenticate, users.listPaymentMethods);
router.post("/users/me/payment-methods", authenticate, v.validatePaymentMethod, users.addPaymentMethod);
router.delete("/users/me/payment-methods/:id", authenticate, users.removePaymentMethod);

// --- Menu ---
router.get("/home", optionalAuthenticate, catalog.home);
router.get("/branches", catalog.listBranches);
router.get("/branches/:id", catalog.getBranch);
router.get("/categories", catalog.categories);
router.get("/products", optionalAuthenticate, catalog.listProducts);
router.get("/products/:id", optionalAuthenticate, catalog.getProduct);
router.post("/products", ...staff, v.validateProductCreate, catalog.createProduct);
router.put("/products/:id", ...staff, v.validateProductCreate, catalog.replaceProduct);
router.patch("/products/:id", ...staff, v.validateProductPatch, catalog.patchProduct);
router.delete("/products/:id", ...staff, catalog.deleteProduct);

router.get("/favorites", authenticate, catalog.listFavorites);
router.post("/favorites", authenticate, v.validateFavorite, catalog.addFavorite);
router.delete("/favorites/:productId", authenticate, catalog.removeFavorite);

// --- Cart & checkout ---
router.get("/cart", authenticate, cart.get);
router.delete("/cart", authenticate, cart.clear);
router.post("/cart/items", authenticate, v.validateCartItem, cart.addItem);
router.patch("/cart/items/:itemId", authenticate, v.validateCartItemUpdate, cart.updateItem);
router.delete("/cart/items/:itemId", authenticate, cart.removeItem);
router.post("/cart/coupon", authenticate, v.validateCoupon, cart.applyCoupon);
router.delete("/cart/coupon", authenticate, cart.removeCoupon);
router.post("/checkout", authenticate, v.validateCheckout, cart.checkout);

// --- Orders ---
router.get("/orders", authenticate, orders.list);
router.get("/orders/:id", authenticate, orders.get);
router.post("/orders/:id/cancel", authenticate, orders.cancel);
router.post("/orders/:id/reorder", authenticate, orders.reorder);
router.post("/orders/:id/reconcile", authenticate, orders.reconcile);
router.patch("/orders/:id/status", ...staff, v.validateOrderStatus, orders.updateStatus);

// --- Payments (sandbox gateway + webhook) ---
router.get("/payments/sandbox/:sessionId", payments.sandboxPage);
router.post("/payments/sandbox/:sessionId/pay", payments.sandboxPay);
router.post("/payments/sandbox/:sessionId/cancel", payments.sandboxCancel);
router.post("/webhooks/payments", payments.webhook);
router.post("/webhooks/maya", payments.mayaWebhook);

// --- Rewards ---
router.get("/rewards", authenticate, extras.summary);
router.get("/rewards/catalog", authenticate, extras.catalog);
router.post("/rewards/redeem", authenticate, v.validateRedeem, extras.redeem);
router.get("/rewards/coupons", authenticate, extras.coupons);
router.get("/rewards/history", authenticate, extras.history);
router.post("/rewards/streak/check-in", authenticate, extras.checkIn);

// --- Notifications ---
router.get("/notifications", authenticate, extras.listNotifications);
router.post("/notifications/read-all", authenticate, extras.readAllNotifications);
router.patch("/notifications/:id/read", authenticate, extras.readNotification);

// --- AI discovery & contact ---
router.post("/ai/recommendations", publicLimiter, optionalAuthenticate, v.validateAiQuery, extras.aiRecommend);
router.get("/contact/channels", extras.contactChannels);
router.post("/contact", publicLimiter, optionalAuthenticate, v.validateContact, extras.contact);

module.exports = router;
