const { notifications } = require("../repositories");
const { nowIso, paginate } = require("../utils/helpers");
const { NotFoundError } = require("../utils/errors");

exports.push = (userId, type, title, body, data = {}) =>
  notifications.create({ userId, type, title, body, data, read: false, createdAt: nowIso() });

exports.list = (user, { page, limit }, unreadOnly) => {
  let items = notifications.findByUser(user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (unreadOnly) items = items.filter((n) => !n.read);
  const result = paginate(items, { page, limit });
  result.meta.unreadCount = notifications.findByUser(user.id).filter((n) => !n.read).length;
  return result;
};

exports.unreadCount = (user) => notifications.findByUser(user.id).filter((n) => !n.read).length;

exports.markRead = (user, id) => {
  const n = notifications.findById(id);
  if (!n || n.userId !== user.id) throw new NotFoundError("Notification");
  n.read = true;
  return n;
};

exports.markAllRead = (user) => {
  const mine = notifications.findByUser(user.id);
  mine.forEach((n) => { n.read = true; });
  return { updated: mine.length };
};
