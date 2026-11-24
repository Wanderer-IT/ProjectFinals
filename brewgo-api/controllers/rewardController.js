const rewardService = require("../services/rewardService");
const notificationService = require("../services/notificationService");
const aiService = require("../services/aiService");
const contactService = require("../services/contactService");
const { parsePagination } = require("../utils/helpers");
const { ok, created } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("extras", {
  summary: async (req, res) => ok(res, await rewardService.summary(req.user)),
  catalog: async (req, res) => ok(res, await rewardService.catalog(req.user)),
  redeem: async (req, res) => created(res, await rewardService.redeem(req.user, req.body.rewardId)),
  coupons: async (req, res) => ok(res, await rewardService.listCoupons(req.user, req.query.status)),
  history: async (req, res) => { const { items, meta } = await rewardService.history(req.user, req.query); ok(res, items, meta); },
  checkIn: async (req, res) => ok(res, await rewardService.checkIn(req.user)),

  listNotifications: async (req, res) => {
    const { items, meta } = await notificationService.list(req.user, parsePagination(req.query), req.query.unread === "true");
    ok(res, items, meta);
  },
  readNotification: async (req, res) => ok(res, await notificationService.markRead(req.user, req.params.id)),
  readAllNotifications: async (req, res) => ok(res, await notificationService.markAllRead(req.user)),

  aiRecommend: async (req, res) => ok(res, await aiService.recommend(req.body.query, req.user, { simulateOutage: req.get("X-Simulate-AI-Outage") === "true" })),

  contactChannels: (req, res) => ok(res, contactService.channels()),
  contact: async (req, res) => created(res, await contactService.create(req.body, req.user)),
});
