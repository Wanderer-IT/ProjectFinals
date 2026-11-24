const authService = require("../services/authService");
const { ok, created } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("auth", {
  register: async (req, res) => created(res, await authService.register(req.body)),
  login: async (req, res) => ok(res, await authService.login(req.body)),
  logout: async (req, res) => { await authService.logout(req.token); ok(res, { loggedOut: true }); },
});
