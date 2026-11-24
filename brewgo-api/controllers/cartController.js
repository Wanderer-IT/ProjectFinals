const cartService = require("../services/cartService");
const checkoutFacade = require("../services/checkoutFacade");
const { UnprocessableError } = require("../utils/errors");
const { ok, created, noContent } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("cart", {
  get: async (req, res) => {
    const fulfillment = req.query.fulfillment || "pickup";
    if (!["pickup", "delivery"].includes(fulfillment)) {
      throw new UnprocessableError("Invalid fulfillment", "VALIDATION_ERROR", [{ field: "fulfillment", message: "fulfillment must be pickup or delivery" }]);
    }
    ok(res, await cartService.getView(req.user, fulfillment));
  },
  clear: async (req, res) => { await cartService.clear(req.user); noContent(res); },
  addItem: async (req, res) => created(res, await cartService.addItem(req.user, req.body)),
  updateItem: async (req, res) => {
    const { quantity, options, note } = req.body;
    if (quantity === undefined && options === undefined && note === undefined) {
      throw new UnprocessableError("Nothing to update", "VALIDATION_ERROR", [{ field: "body", message: "send quantity, options or note" }]);
    }
    ok(res, await cartService.updateItem(req.user, req.params.itemId, req.body));
  },
  removeItem: async (req, res) => ok(res, await cartService.removeItem(req.user, req.params.itemId)), // 200 + fresh totals (server is the source of truth)
  applyCoupon: async (req, res) => ok(res, await cartService.applyCoupon(req.user, req.body.code)),
  removeCoupon: async (req, res) => ok(res, await cartService.removeCoupon(req.user)),

  checkout: async (req, res) => {
    const { replayed, data } = await checkoutFacade.checkout(req.user, req.body, req.get("Idempotency-Key"));
    if (replayed) res.setHeader("Idempotent-Replayed", "true");
    (replayed ? ok : created)(res, data);
  },
});
