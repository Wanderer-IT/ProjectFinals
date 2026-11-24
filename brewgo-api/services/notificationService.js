const { notifications } = require("../repositories");
const { nowIso, paginate } = require("../utils/helpers");
const { NotFoundError } = require("../utils/errors");

exports.push = (userId, type, title, body, data = {}) =>
  notifications.create({ userId, type, title, body, data, read: false, createdAt: nowIso() });

exports.list = async (user, { page, limit }, unreadOnly) => {
  const mine = await notifications.findByUser(user.id);
  let items = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  if (unreadOnly) items = items.filter((n) => !n.read);
  const result = paginate(items, { page, limit });
  result.meta.unreadCount = mine.filter((n) => !n.read).length;
  return result;
};

exports.unreadCount = async (user) => (await notifications.findByUser(user.id)).filter((n) => !n.read).length;

exports.markRead = async (user, id) => {
  const n = await notifications.findById(id);
  if (!n || n.userId !== user.id) throw new NotFoundError("Notification");
  return (await notifications.update(n.id, { read: true })) || { ...n, read: true };
};

exports.markAllRead = async (user) => {
  const unread = (await notifications.findByUser(user.id)).filter((n) => !n.read);
  await Promise.all(unread.map((n) => notifications.update(n.id, { read: true })));
  return { updated: unread.length };
};
