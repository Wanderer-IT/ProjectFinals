const rewardService = require("../services/rewardService");
const notificationService = require("../services/notificationService");
const aiService = require("../services/aiService");
const contactService = require("../services/contactService");
const { parsePagination } = require("../utils/helpers");
const { ok, created } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("extras", {
  summary: (req, res) => ok(res, rewardService.summary(req.user)),
  catalog: (req, res) => ok(res, rewardService.catalog(req.user)),
  redeem: (req, res) => created(res, rewardService.redeem(req.user, req.body.rewardId)),
  coupons: (req, res) => ok(res, rewardService.listCoupons(req.user, req.query.status)),
  history: (req, res) => { const { items, meta } = rewardService.history(req.user, req.query); ok(res, items, meta); },
  checkIn: (req, res) => ok(res, rewardService.checkIn(req.user)),

  listNotifications: (req, res) => {
    const { items, meta } = notificationService.list(req.user, parsePagination(req.query), req.query.unread === "true");
    ok(res, items, meta);
  },
  readNotification: (req, res) => ok(res, notificationService.markRead(req.user, req.params.id)),
  readAllNotifications: (req, res) => ok(res, notificationService.markAllRead(req.user)),

  aiRecommend: (req, res) => ok(res, aiService.recommend(req.body.query, req.user, { simulateOutage: req.get("X-Simulate-AI-Outage") === "true" })),

  contactChannels: (req, res) => ok(res, contactService.channels()),
  contact: (req, res) => created(res, contactService.create(req.body, req.user)),
});
