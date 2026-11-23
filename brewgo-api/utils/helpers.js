const crypto = require("crypto");
const { UnprocessableError } = require("./errors");

const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const nowIso = () => new Date().toISOString();
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);

// The shop operates in Philippine time (UTC+8). Streaks and missions use it.
const manilaShift = (date = new Date()) => new Date(date.getTime() + 8 * 3600 * 1000);
const manilaDateKey = (date = new Date()) => manilaShift(date).toISOString().slice(0, 10);
const manilaHour = (date = new Date()) => manilaShift(date).getUTCHours();
function manilaWeekKey(date = new Date()) {
  const d = manilaShift(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d.toISOString().slice(0, 10);
}
const dayDiff = (keyA, keyB) => Math.round((Date.parse(keyB) - Date.parse(keyA)) / 86400000);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const randomCode = (prefix, bytes = 3) => `${prefix}-${crypto.randomBytes(bytes).toString("hex").toUpperCase()}`;

// Accepts "917 123 4567", "+63 917 123 4567", "0917-123-4567" -> "09171234567"
function normalizePhone(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("63") && d.length === 12) d = "0" + d.slice(2);
  else if (d.length === 10 && d.startsWith("9")) d = "0" + d;
  return /^09\d{9}$/.test(d) ? d : null;
}

// ?page=2&limit=10  (page-based pagination, as taught in "Consuming APIs")
function parsePagination(query, { defaultLimit = 20, maxLimit = 50 } = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  const errors = [];
  if (!Number.isInteger(page) || page < 1) errors.push({ field: "page", message: "page must be a positive integer" });
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit)
    errors.push({ field: "limit", message: `limit must be between 1 and ${maxLimit}` });
  if (errors.length) throw new UnprocessableError("Invalid pagination parameters", "VALIDATION_ERROR", errors);
  return { page, limit };
}

function paginate(items, { page, limit }) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), meta: { page, limit, total, totalPages, hasNext: page < totalPages } };
}

module.exports = {
  money, nowIso, addDays, manilaShift, manilaDateKey, manilaHour, manilaWeekKey, dayDiff,
  escapeHtml, randomCode, normalizePhone, parsePagination, paginate,
};
