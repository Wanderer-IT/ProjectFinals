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
  home: (req, res) => ok(res, homeFacade.getHome(req.user)),

  listBranches: (req, res) => ok(res, branches.findAll()),
  getBranch: (req, res) => {
    const branch = branches.findById(req.params.id);
    if (!branch) throw new NotFoundError("Branch", "BRANCH_NOT_FOUND");
    ok(res, branch);
  },

  categories: (req, res) => ok(res, productService.categories()),

  listProducts: (req, res) => {
    const { items, meta } = productService.list(req.query, parsePagination(req.query), req.user);
    ok(res, items, meta);
  },
  getProduct: (req, res) => ok(res, productService.get(req.params.id, req.user)),
  createProduct: (req, res) => created(res, productService.create(req.body)),
  replaceProduct: (req, res) => ok(res, productService.replace(req.params.id, req.body)),
  patchProduct: (req, res) => ok(res, productService.patch(req.params.id, req.body)),
  deleteProduct: (req, res) => { productService.remove(req.params.id); noContent(res); },

  listFavorites: (req, res) => ok(res, favoriteService.list(req.user)),
  addFavorite: (req, res) => {
    const { created: isNew, product } = favoriteService.add(req.user, req.body.productId);
    (isNew ? created : ok)(res, product);
  },
  removeFavorite: (req, res) => { favoriteService.remove(req.user, req.params.productId); noContent(res); },
});
