const config = require("../config");
const { products, favorites, carts } = require("../repositories");
const { buildOptionGroups } = require("./optionTemplates");
const { paginate, nowIso } = require("../utils/helpers");
const { NotFoundError, UnprocessableError } = require("../utils/errors");

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
};

const isAvailable = (p) => p.available && p.stock > 0;

// Shape sent to the app. Exact stock is only shown to staff; customers get lowStock.
function toView(p, user) {
  const view = {
    id: p.id, name: p.name, description: p.description, category: p.category,
    price: p.price, currency: config.currency, imageUrl: p.imageUrl,
    isBestSeller: p.isBestSeller, plantBased: p.plantBased, tags: p.tags,
    isAvailable: isAvailable(p), lowStock: p.stock > 0 && p.stock <= 5,
    optionGroups: p.optionGroups,
  };
  if (user) view.isFavorite = Boolean(favorites.find(user.id, p.id));
  if (user && user.role === "admin") view.stock = p.stock;
  return view;
}

exports.list = (query, paging, user) => {
  const sort = SORTS[query.sort] || SORTS.name;
  if (query.sort && !SORTS[query.sort]) {
    throw new UnprocessableError("Invalid sort option", "VALIDATION_ERROR", [{ field: "sort", message: `sort must be one of: ${Object.keys(SORTS).join(", ")}` }]);
  }
  if (query.category && !["hot", "iced", "pastries"].includes(query.category)) {
    throw new UnprocessableError("Invalid category", "VALIDATION_ERROR", [{ field: "category", message: "category must be one of: hot, iced, pastries" }]);
  }
  const found = products
    .search({
      category: query.category,
      q: query.search,
      bestSeller: query.bestSeller === undefined ? undefined : query.bestSeller === "true",
      availableOnly: query.available === "true",
    })
    .sort(sort);
  const { items, meta } = paginate(found, paging);
  return { items: items.map((p) => toView(p, user)), meta };
};

exports.get = (id, user) => {
  const product = products.findById(id);
  if (!product) throw new NotFoundError("Product", "PRODUCT_NOT_FOUND");
  return toView(product, user);
};

exports.getRecord = (id) => {
  const product = products.findById(id);
  if (!product) throw new NotFoundError("Product", "PRODUCT_NOT_FOUND");
  return product;
};

exports.categories = () =>
  ["hot", "iced", "pastries"].map((key) => ({
    key,
    label: { hot: "Hot", iced: "Iced", pastries: "Pastries" }[key],
    productCount: products.findAll((p) => p.category === key).length,
  }));

// ----- staff CRUD (PUT replaces, PATCH changes only what is sent) -----
exports.create = (body) =>
  toView(products.create({
    name: body.name, description: body.description || "", category: body.category, price: body.price,
    imageUrl: body.imageUrl || "/images/placeholder.svg", stock: body.stock,
    isBestSeller: body.isBestSeller || false, plantBased: body.plantBased || false,
    available: body.available !== false, tags: body.tags || [],
    optionGroups: buildOptionGroups(body.category, { plantBased: body.plantBased, name: body.name }),
    createdAt: nowIso(),
  }), { role: "admin" });

exports.replace = (id, body) => {
  const p = exports.getRecord(id);
  Object.assign(p, {
    name: body.name, description: body.description || "", category: body.category, price: body.price,
    imageUrl: body.imageUrl || "/images/placeholder.svg", stock: body.stock,
    isBestSeller: body.isBestSeller || false, plantBased: body.plantBased || false,
    available: body.available !== false, tags: body.tags || [],
    optionGroups: buildOptionGroups(body.category, { plantBased: body.plantBased, name: body.name }),
  });
  return toView(p, { role: "admin" });
};

exports.patch = (id, body) => {
  const p = exports.getRecord(id);
  const fields = ["name", "description", "category", "price", "imageUrl", "stock", "isBestSeller", "plantBased", "available", "tags"];
  fields.forEach((f) => { if (body[f] !== undefined) p[f] = body[f]; });
  if (body.category !== undefined || body.plantBased !== undefined || body.name !== undefined) {
    p.optionGroups = buildOptionGroups(p.category, { plantBased: p.plantBased, name: p.name });
  }
  return toView(p, { role: "admin" });
};

exports.remove = (id) => {
  exports.getRecord(id);
  products.remove(id);
  favorites.items.splice(0, favorites.items.length, ...favorites.items.filter((f) => f.productId !== Number(id)));
  carts.items.forEach((c) => { c.items = c.items.filter((i) => i.productId !== Number(id)); });
};

// Turns the customer's chosen options into a normalized choice + price. Missing groups fall back to the first choice.
exports.resolveOptions = (product, selected = {}) => {
  const errors = [];
  const groupKeys = product.optionGroups.map((g) => g.key);
  Object.keys(selected).forEach((key) => {
    if (!groupKeys.includes(key)) errors.push({ field: `options.${key}`, message: `${key} is not an option for ${product.name}` });
  });
  const normalized = {};
  const labels = [];
  let priceDelta = 0;
  product.optionGroups.forEach((group) => {
    const value = selected[group.key] === undefined ? group.choices[0].value : String(selected[group.key]);
    const choice = group.choices.find((c) => c.value === value);
    if (!choice) {
      errors.push({ field: `options.${group.key}`, message: `${group.label} must be one of: ${group.choices.map((c) => c.value).join(", ")}` });
      return;
    }
    normalized[group.key] = choice.value;
    priceDelta += choice.priceDelta;
    if (choice.priceDelta > 0 || !["none", "no", "regular"].includes(choice.value)) labels.push(choice.label);
  });
  if (errors.length) throw new UnprocessableError("Some options are not valid", "INVALID_OPTION", errors);
  return { options: normalized, labels, priceDelta, unitPrice: product.price + priceDelta };
};

exports.isAvailable = isAvailable;
exports.toView = toView;
