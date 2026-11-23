const config = require("../config");
const { users, ledger, rewards, userCoupons, streaks, missionLog, products } = require("../repositories");
const notificationService = require("./notificationService");
const { nowIso, addDays, randomCode, manilaDateKey, manilaHour, manilaWeekKey, dayDiff, parsePagination, paginate } = require("../utils/helpers");
const { NotFoundError, UnprocessableError, ConflictError } = require("../utils/errors");

const TIERS = [
  { name: "Gold Brew Member", min: 200 },
  { name: "Silver Brew Member", min: 100 },
  { name: "Brew Member", min: 0 },
];
const tierFor = (lifetimePoints) => TIERS.find((t) => lifetimePoints >= t.min).name;

// Every point movement is written to the ledger (history screen) and the balance is updated.
function addPoints(user, points, type, description, orderId = null, createdAt = nowIso()) {
  user.pointsBalance += points;
  if (points > 0) user.lifetimePoints += points;
  return ledger.create({ userId: user.id, type, points, balanceAfter: user.pointsBalance, description, orderId, createdAt });
}

function nextFreeDrink(user) {
  const target = config.freeDrinkPoints;
  const remaining = Math.max(0, target - user.pointsBalance);
  return {
    label: "Next Handcrafted Drink (Free)",
    current: user.pointsBalance,
    target,
    remaining,
    progressPercent: Math.min(100, Math.round((user.pointsBalance / target) * 100)),
    message: remaining > 0 ? `Only ${remaining} pts away from a cozy treat on the house!` : "You have enough points for a free handcrafted drink!",
  };
}

// ---------- Daily Brew Streak ----------
function streakState(user) {
  const rec = streaks.findByUser(user.id);
  const today = manilaDateKey();
  if (!rec) return { rec: null, completed: 0, checkedInToday: false };
  const checkedInToday = rec.lastDate === today;
  const wasYesterday = dayDiff(rec.lastDate, today) === 1;
  const completed = checkedInToday || wasYesterday ? rec.count : 0; // a missed day breaks the streak
  return { rec, completed, checkedInToday };
}

function getStreak(user) {
  const { completed, checkedInToday } = streakState(user);
  return {
    title: "Daily Brew Streak",
    completed: Math.min(completed, config.streakTarget),
    target: config.streakTarget,
    checkedInToday,
    rewardPoints: config.streakRewardPoints,
  };
}

function checkIn(user) {
  const { rec, completed, checkedInToday } = streakState(user);
  if (checkedInToday) throw new ConflictError("You already checked in today. Come back tomorrow!", "ALREADY_CHECKED_IN");
  const base = completed >= config.streakTarget ? 0 : completed; // finished cycle -> start a new one
  const count = base + 1;
  const today = manilaDateKey();
  if (rec) Object.assign(rec, { count, lastDate: today });
  else streaks.create({ userId: user.id, count, lastDate: today });

  let rewardAwarded = 0;
  if (count === config.streakTarget) {
    rewardAwarded = config.streakRewardPoints;
    addPoints(user, rewardAwarded, "STREAK_BONUS", `${config.streakTarget}-day Brew Streak reward`);
    notificationService.push(user.id, "rewards", "Streak complete!", `+${rewardAwarded} pts for your ${config.streakTarget}-day streak.`);
  }
  return { streak: getStreak(user), rewardAwarded, pointsBalance: user.pointsBalance };
}

// ---------- Bonus Missions (weekly) ----------
const MISSIONS = [
  {
    key: "morning-ritual", title: "Morning Ritual", description: "Order any cup before 9:00 AM", rewardPoints: 5,
    qualifies: (order) => manilaHour(new Date(order.createdAt)) < 9 && order.items.some((i) => i.category !== "pastries"),
  },
  {
    key: "plant-based-sip", title: "Plant-Based Sip", description: "Order a plant-based drink", rewardPoints: 5,
    qualifies: (order) => order.items.some((i) => i.plantBased),
  },
];

function getMissions(user) {
  const week = manilaWeekKey();
  return MISSIONS.map(({ key, title, description, rewardPoints }) => ({
    key, title, description, rewardPoints, period: "This Week",
    completed: Boolean(missionLog.findOne((m) => m.userId === user.id && m.key === key && m.week === week)),
  }));
}

// Called by the order service when an order becomes paid.
function onOrderPaid(order) {
  const user = users.findById(order.userId);
  if (!user) return 0;
  const spend = Math.max(0, order.pricing.subtotal - order.pricing.discount);
  const pts = Math.floor(spend / config.pesosPerPoint);
  if (pts > 0) addPoints(user, pts, "ORDER_PAID", `Order ${order.orderNumber}`, order.id);
  order.pointsEarned = pts;

  const week = manilaWeekKey();
  MISSIONS.forEach((m) => {
    const done = missionLog.findOne((l) => l.userId === user.id && l.key === m.key && l.week === week);
    if (!done && m.qualifies(order)) {
      missionLog.create({ userId: user.id, key: m.key, week, orderId: order.id });
      addPoints(user, m.rewardPoints, "MISSION_BONUS", `Mission: ${m.title}`, order.id);
    }
  });
  notificationService.push(user.id, "rewards", "Points added", `You earned ${pts} pts from order ${order.orderNumber}.`, { orderId: order.id });
  return pts;
}

// ---------- Redeem rewards ----------
function catalog(user) {
  return rewards.findAll().map((r) => ({
    ...r,
    canRedeem: user.pointsBalance >= r.pointsCost,
    pointsNeeded: Math.max(0, r.pointsCost - user.pointsBalance),
  }));
}

function redeem(user, rewardId) {
  const reward = rewards.findById(rewardId);
  if (!reward) throw new NotFoundError("Reward");
  if (user.pointsBalance < reward.pointsCost) {
    throw new UnprocessableError(
      `You need ${reward.pointsCost - user.pointsBalance} more points for this reward`,
      "INSUFFICIENT_POINTS",
      { required: reward.pointsCost, balance: user.pointsBalance, pointsNeeded: reward.pointsCost - user.pointsBalance }
    );
  }
  const coupon = userCoupons.create({
    userId: user.id, rewardId: reward.id, code: randomCode("BG"), title: reward.title, type: reward.type, value: reward.value,
    minSpend: reward.minSpend, perk: reward.perk, status: "active", usedOrderId: null,
    expiresAt: addDays(new Date(), 30).toISOString(), createdAt: nowIso(),
  });
  addPoints(user, -reward.pointsCost, "REDEEM", `Redeemed ${reward.title}`);
  notificationService.push(user.id, "rewards", "Reward redeemed", `${reward.title} is ready. Use code ${coupon.code} at checkout.`);
  return { coupon, pointsBalance: user.pointsBalance };
}

function listCoupons(user, status) {
  const now = Date.now();
  return userCoupons.findByUser(user.id)
    .map((c) => ({ ...c, status: c.status === "active" && Date.parse(c.expiresAt) < now ? "expired" : c.status }))
    .filter((c) => !status || c.status === status);
}

function history(user, query) {
  const paging = parsePagination(query);
  const items = ledger.findByUser(user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return paginate(items, paging);
}

function summary(user) {
  return {
    pointsBalance: user.pointsBalance,
    lifetimePoints: user.lifetimePoints,
    tier: tierFor(user.lifetimePoints),
    nextFreeDrink: nextFreeDrink(user),
    streak: getStreak(user),
    missions: getMissions(user),
  };
}

module.exports = { tierFor, addPoints, nextFreeDrink, getStreak, checkIn, getMissions, onOrderPaid, catalog, redeem, listCoupons, history, summary };
