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
// The database adds the points in one atomic step (so two requests can never overwrite each other),
// and it refuses a deduction that would make the balance negative. `user` is refreshed with the new numbers.
async function addPoints(user, points, type, description, orderId = null, createdAt = nowIso()) {
  const balance = await users.adjust(user.id, "pointsBalance", points, points < 0 ? 0 : null);
  if (balance === null || balance === undefined) {
    throw new UnprocessableError("You do not have enough points for this", "INSUFFICIENT_POINTS", { balance: user.pointsBalance });
  }
  user.pointsBalance = balance;
  if (points > 0) user.lifetimePoints = await users.adjust(user.id, "lifetimePoints", points);
  return ledger.create({ userId: user.id, type, points, balanceAfter: balance, description, orderId, createdAt });
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
async function streakState(user) {
  const rec = await streaks.findByUser(user.id);
  const today = manilaDateKey();
  if (!rec) return { rec: null, completed: 0, checkedInToday: false };
  const checkedInToday = rec.lastDate === today;
  const wasYesterday = dayDiff(rec.lastDate, today) === 1;
  const completed = checkedInToday || wasYesterday ? rec.count : 0; // a missed day breaks the streak
  return { rec, completed, checkedInToday };
}

async function getStreak(user) {
  const { completed, checkedInToday } = await streakState(user);
  return {
    title: "Daily Brew Streak",
    completed: Math.min(completed, config.streakTarget),
    target: config.streakTarget,
    checkedInToday,
    rewardPoints: config.streakRewardPoints,
  };
}

async function checkIn(user) {
  const { rec, completed, checkedInToday } = await streakState(user);
  if (checkedInToday) throw new ConflictError("You already checked in today. Come back tomorrow!", "ALREADY_CHECKED_IN");
  const base = completed >= config.streakTarget ? 0 : completed; // finished cycle -> start a new one
  const count = base + 1;
  const today = manilaDateKey();
  if (rec) await streaks.update(rec.id, { count, lastDate: today });
  else await streaks.create({ userId: user.id, count, lastDate: today });

  let rewardAwarded = 0;
  if (count === config.streakTarget) {
    rewardAwarded = config.streakRewardPoints;
    await addPoints(user, rewardAwarded, "STREAK_BONUS", `${config.streakTarget}-day Brew Streak reward`);
    await notificationService.push(user.id, "rewards", "Streak complete!", `+${rewardAwarded} pts for your ${config.streakTarget}-day streak.`);
  }
  return { streak: await getStreak(user), rewardAwarded, pointsBalance: user.pointsBalance };
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

async function getMissions(user) {
  const week = manilaWeekKey();
  const done = await Promise.all(MISSIONS.map((m) => missionLog.find(user.id, m.key, week)));
  return MISSIONS.map(({ key, title, description, rewardPoints }, i) => ({
    key, title, description, rewardPoints, period: "This Week", completed: Boolean(done[i]),
  }));
}

// Called by the order service when an order becomes paid. Returns the points earned (the caller saves them on the order).
async function onOrderPaid(order) {
  const user = await users.findById(order.userId);
  if (!user) return 0;
  const spend = Math.max(0, order.pricing.subtotal - order.pricing.discount);
  const pts = Math.floor(spend / config.pesosPerPoint);
  if (pts > 0) await addPoints(user, pts, "ORDER_PAID", `Order ${order.orderNumber}`, order.id);

  const week = manilaWeekKey();
  for (const m of MISSIONS) {
    const done = await missionLog.find(user.id, m.key, week);
    if (!done && m.qualifies(order)) {
      await missionLog.create({ userId: user.id, key: m.key, week, orderId: order.id });
      await addPoints(user, m.rewardPoints, "MISSION_BONUS", `Mission: ${m.title}`, order.id);
    }
  }
  await notificationService.push(user.id, "rewards", "Points added", `You earned ${pts} pts from order ${order.orderNumber}.`, { orderId: order.id });
  return pts;
}

// ---------- Redeem rewards ----------
async function catalog(user) {
  return (await rewards.findAll()).map((r) => ({
    ...r,
    canRedeem: user.pointsBalance >= r.pointsCost,
    pointsNeeded: Math.max(0, r.pointsCost - user.pointsBalance),
  }));
}

async function redeem(user, rewardId) {
  const reward = await rewards.findById(rewardId);
  if (!reward) throw new NotFoundError("Reward");
  if (user.pointsBalance < reward.pointsCost) {
    throw new UnprocessableError(
      `You need ${reward.pointsCost - user.pointsBalance} more points for this reward`,
      "INSUFFICIENT_POINTS",
      { required: reward.pointsCost, balance: user.pointsBalance, pointsNeeded: reward.pointsCost - user.pointsBalance }
    );
  }
  await addPoints(user, -reward.pointsCost, "REDEEM", `Redeemed ${reward.title}`); // points first, so a failure never hands out a free coupon
  const coupon = await userCoupons.create({
    userId: user.id, rewardId: reward.id, code: randomCode("BG"), title: reward.title, type: reward.type, value: reward.value,
    minSpend: reward.minSpend, perk: reward.perk, status: "active", usedOrderId: null,
    expiresAt: addDays(new Date(), 30).toISOString(), createdAt: nowIso(),
  });
  await notificationService.push(user.id, "rewards", "Reward redeemed", `${reward.title} is ready. Use code ${coupon.code} at checkout.`);
  return { coupon, pointsBalance: user.pointsBalance };
}

async function listCoupons(user, status) {
  const now = Date.now();
  return (await userCoupons.findByUser(user.id))
    .map((c) => ({ ...c, status: c.status === "active" && Date.parse(c.expiresAt) < now ? "expired" : c.status }))
    .filter((c) => !status || c.status === status);
}

async function history(user, query) {
  const paging = parsePagination(query);
  const items = (await ledger.findByUser(user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return paginate(items, paging);
}

async function summary(user) {
  const [streak, missions] = await Promise.all([getStreak(user), getMissions(user)]);
  return {
    pointsBalance: user.pointsBalance,
    lifetimePoints: user.lifetimePoints,
    tier: tierFor(user.lifetimePoints),
    nextFreeDrink: nextFreeDrink(user),
    streak,
    missions,
  };
}

module.exports = { tierFor, addPoints, nextFreeDrink, getStreak, checkIn, getMissions, onOrderPaid, catalog, redeem, listCoupons, history, summary };
