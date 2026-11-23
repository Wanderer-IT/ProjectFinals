// FACADE (lecture example: StudentDashboardFacade): the Home screen needs greeting + points,
// categories, best sellers, favorites and the live order. One request instead of five.
const productService = require("./productService");
const favoriteService = require("./favoriteService");
const notificationService = require("./notificationService");
const orderService = require("./orderService");
const { orders } = require("../repositories");

exports.getHome = (user) => {
  const best = productService.list({ bestSeller: "true", available: "true" }, { page: 1, limit: 10 }, user).items;
  const home = {
    greeting: user ? `Hi, ${user.fullName.split(" ")[0]}` : "Hi there",
    user: user ? { id: user.id, fullName: user.fullName, pointsBalance: user.pointsBalance, avatarUrl: user.avatarUrl } : null,
    categories: productService.categories(),
    bestSellers: best,
    favorites: [],
    activeOrder: null,
    unreadNotifications: 0,
  };
  if (user) {
    home.favorites = favoriteService.list(user);
    home.unreadNotifications = notificationService.unreadCount(user);
    const live = orders.findByUser(user.id).filter((o) => ["pending_payment", "paid", "preparing", "ready"].includes(o.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    home.activeOrder = live ? orderService.toView(live) : null;
  }
  return home;
};
