const { favorites, products } = require("../repositories");
const productService = require("./productService");
const { nowIso } = require("../utils/helpers");
const { NotFoundError } = require("../utils/errors");

exports.list = (user) =>
  favorites.findByUser(user.id)
    .map((f) => products.findById(f.productId))
    .filter(Boolean)
    .map((p) => productService.toView(p, user));

// Returns { created } so the controller can answer 201 (new) or 200 (already a favorite).
exports.add = (user, productId) => {
  const product = productService.getRecord(productId);
  const existing = favorites.find(user.id, product.id);
  if (!existing) favorites.create({ userId: user.id, productId: product.id, createdAt: nowIso() });
  return { created: !existing, product: productService.toView(product, user) };
};

exports.remove = (user, productId) => {
  const existing = favorites.find(user.id, Number(productId));
  if (!existing) throw new NotFoundError("Favorite", "FAVORITE_NOT_FOUND");
  favorites.remove(existing.id);
};
