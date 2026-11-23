const orderService = require("../services/orderService");
const paymentService = require("../services/paymentService");
const config = require("../config");
const { parsePagination, escapeHtml } = require("../utils/helpers");
const { UnprocessableError } = require("../utils/errors");
const { ok, noContent } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("orders", {
  list: (req, res) => {
    const { items, meta } = orderService.list(req.user, req.query, parsePagination(req.query, { defaultLimit: 10 }));
    ok(res, items, meta);
  },
  // The payment success/cancelled pages call THIS to show the real status.
  get: (req, res) => ok(res, orderService.toView(orderService.getRecordFor(req.user, req.params.id))),
  cancel: (req, res) => ok(res, orderService.cancel(req.user, req.params.id)),
  reorder: (req, res) => ok(res, orderService.reorder(req.user, req.params.id)),
  reconcile: async (req, res) => {
    const order = orderService.getRecordFor(req.user, req.params.id);
    ok(res, orderService.toView(await paymentService.reconcile(order)));
  },
  updateStatus: (req, res) => {
    const order = orderService.getRecordFor(req.user, req.params.id);
    ok(res, orderService.toView(orderService.transition(order, req.body.status)));
  },
});
