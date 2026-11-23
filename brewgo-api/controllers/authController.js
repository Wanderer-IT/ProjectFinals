const authService = require("../services/authService");
const { ok, created } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("auth", {
  register: (req, res) => created(res, authService.register(req.body)),
  login: (req, res) => ok(res, authService.login(req.body)),
  logout: (req, res) => { authService.logout(req.token); ok(res, { loggedOut: true }); },
});
