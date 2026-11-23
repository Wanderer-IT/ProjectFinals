const userService = require("../services/userService");
const { ok, created, noContent } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("users", {
  me: (req, res) => ok(res, userService.getProfile(req.user)),
  updateMe: (req, res) => ok(res, userService.updateProfile(req.user, req.body)),
  listPaymentMethods: (req, res) => ok(res, userService.listPaymentMethods(req.user)),
  addPaymentMethod: (req, res) => created(res, userService.addPaymentMethod(req.user, req.body)),
  removePaymentMethod: (req, res) => { userService.removePaymentMethod(req.user, req.params.id); noContent(res); },
});
