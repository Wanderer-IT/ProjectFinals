const orderService = require("../services/orderService");
const paymentService = require("../services/paymentService");
const config = require("../config");
const { parsePagination, escapeHtml } = require("../utils/helpers");
const { UnprocessableError } = require("../utils/errors");
const { ok, noContent } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("orders", {
  list: async (req, res) => {
    const { items, meta } = await orderService.list(req.user, req.query, parsePagination(req.query, { defaultLimit: 10 }));
    ok(res, items, meta);
  },
  // The payment success/cancelled pages call THIS to show the real status.
  get: async (req, res) => ok(res, orderService.toView(await orderService.getRecordFor(req.user, req.params.id))),
  cancel: async (req, res) => ok(res, await orderService.cancel(req.user, req.params.id)),
  reorder: async (req, res) => ok(res, await orderService.reorder(req.user, req.params.id)),
  reconcile: async (req, res) => {
    const order = await orderService.getRecordFor(req.user, req.params.id);
    ok(res, orderService.toView(await paymentService.reconcile(order)));
  },
  updateStatus: async (req, res) => {
    const order = await orderService.getRecordFor(req.user, req.params.id);
    ok(res, orderService.toView(await orderService.transition(order, req.body.status)));
  },
});
