// Menu: home, branches, categories, products, favorites
const productService = require("../services/productService");
const favoriteService = require("../services/favoriteService");
const homeFacade = require("../services/homeFacade");
const { branches } = require("../repositories");
const { parsePagination } = require("../utils/helpers");
const { NotFoundError } = require("../utils/errors");
const { ok, created, noContent } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

module.exports = decorateController("catalog", {
  home: async (req, res) => ok(res, await homeFacade.getHome(req.user)),

  listBranches: async (req, res) => ok(res, await branches.findAll()),
  getBranch: async (req, res) => {
    const branch = await branches.findById(req.params.id);
    if (!branch) throw new NotFoundError("Branch", "BRANCH_NOT_FOUND");
    ok(res, branch);
  },

  categories: async (req, res) => ok(res, await productService.categories()),

  listProducts: async (req, res) => {
    const { items, meta } = await productService.list(req.query, parsePagination(req.query), req.user);
    ok(res, items, meta);
  },
  getProduct: async (req, res) => ok(res, await productService.get(req.params.id, req.user)),
  createProduct: async (req, res) => created(res, await productService.create(req.body)),
  replaceProduct: async (req, res) => ok(res, await productService.replace(req.params.id, req.body)),
  patchProduct: async (req, res) => ok(res, await productService.patch(req.params.id, req.body)),
  deleteProduct: async (req, res) => { await productService.remove(req.params.id); noContent(res); },

  listFavorites: async (req, res) => ok(res, await favoriteService.list(req.user)),
  addFavorite: async (req, res) => {
    const { created: isNew, product } = await favoriteService.add(req.user, req.body.productId);
    (isNew ? created : ok)(res, product);
  },
  removeFavorite: async (req, res) => { await favoriteService.remove(req.user, req.params.productId); noContent(res); },
});
