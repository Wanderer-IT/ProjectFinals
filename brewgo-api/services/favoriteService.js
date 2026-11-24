const { favorites, products } = require("../repositories");
const productService = require("./productService");
const { nowIso } = require("../utils/helpers");
const { NotFoundError } = require("../utils/errors");

exports.list = async (user) => {
  const mine = await favorites.findByUser(user.id);
  const found = await products.findByIds(mine.map((f) => f.productId));
  const byId = new Map(found.map((p) => [p.id, p]));
  const liked = mine.map((f) => byId.get(f.productId)).filter(Boolean);
  return productService.toViews(liked, user);
};

// Returns { created } so the controller can answer 201 (new) or 200 (already a favorite).
exports.add = async (user, productId) => {
  const product = await productService.getRecord(productId);
  const existing = await favorites.find(user.id, product.id);
  if (!existing) await favorites.create({ userId: user.id, productId: product.id, createdAt: nowIso() });
  return { created: !existing, product: (await productService.toViews([product], user))[0] };
};

exports.remove = async (user, productId) => {
  const existing = await favorites.find(user.id, Number(productId));
  if (!existing) throw new NotFoundError("Favorite", "FAVORITE_NOT_FOUND");
  await favorites.remove(existing.id);
};
