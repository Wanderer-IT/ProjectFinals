const userService = require("../services/userService");
const { ok, created, noContent } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("users", {
  me: async (req, res) => ok(res, await userService.getProfile(req.user)),
  updateMe: async (req, res) => ok(res, await userService.updateProfile(req.user, req.body)),
  listPaymentMethods: async (req, res) => ok(res, await userService.listPaymentMethods(req.user)),
  addPaymentMethod: async (req, res) => created(res, await userService.addPaymentMethod(req.user, req.body)),
  removePaymentMethod: async (req, res) => { await userService.removePaymentMethod(req.user, req.params.id); noContent(res); },
});
