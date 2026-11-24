// Menu content taken from the Figma prototype (Brew Go). Prices are placeholders - edit freely.
const { products, branches, promoCoupons, rewards } = require("../repositories");
const { addDays, nowIso } = require("../utils/helpers");
const { buildOptionGroups } = require("../services/optionTemplates");

async function seedCatalog() {
  const menu = [
    ["hot", "Spanish Latte", 120, 100, true, false, ["sweet", "creamy", "milk", "coffee", "hot"], "Espresso with steamed milk and sweetened condensed milk."],
    ["hot", "Caramel Macchiato", 130, 100, true, false, ["sweet", "caramel", "coffee", "hot", "creamy"], "Vanilla milk, espresso and a golden caramel drizzle."],
    ["hot", "Ube Cloud Brew", 140, 80, false, false, ["sweet", "ube", "creamy", "coffee", "hot"], "Purple yam cream floating over a smooth espresso."],
    ["hot", "Oat Flat White", 135, 100, false, true, ["oat", "plantbased", "strong", "coffee", "hot", "smooth"], "Velvety oat milk and a double ristretto shot."],
    ["iced", "Sea Salt Cream Cold Brew", 145, 80, true, false, ["strong", "salty", "coldbrew", "coffee", "iced", "refreshing"], "Slow-steeped cold brew topped with sea salt cream."],
    ["iced", "Iced Spanish Latte", 150, 100, true, false, ["sweet", "creamy", "coffee", "iced"], "Our best-selling Spanish latte, served over ice."],
    ["iced", "Coconut Water Cold Brew", 150, 60, false, true, ["plantbased", "coconut", "refreshing", "light", "coffee", "iced"], "Cold brew over fresh coconut water. Light and tropical."],
    ["iced", "Iced Caramel Macchiato", 150, 100, false, false, ["sweet", "caramel", "coffee", "iced", "creamy"], "Layered iced macchiato with caramel."],
    ["pastries", "Cinnamon Brioche Roll", 95, 25, false, false, ["sweet", "cinnamon", "pastry", "breakfast"], "Soft brioche swirled with cinnamon sugar."],
    ["pastries", "Matcha Cookie", 85, 0, false, false, ["matcha", "sweet", "pastry", "snack"], "Chewy cookie with white chocolate and matcha."],
    ["pastries", "Pain au Chocolat", 100, 20, false, false, ["chocolate", "sweet", "pastry", "breakfast"], "Flaky laminated pastry with dark chocolate."],
    ["pastries", "Almond Croissant", 100, 3, false, false, ["almond", "buttery", "pastry", "breakfast"], "Butter croissant filled with almond cream."],
    ["pastries", "Butter Croissant", 90, 30, true, false, ["buttery", "pastry", "breakfast", "light"], "Classic all-butter croissant, baked every morning."],
  ];
  for (const [category, name, price, stock, isBestSeller, plantBased, tags, description] of menu) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await products.create({
      name, description, category, price, stock, isBestSeller, plantBased, tags,
      available: true,
      imageUrl: `/images/${slug}.svg`,
      optionGroups: buildOptionGroups(category, { plantBased, name }),
      createdAt: nowIso(),
    });
  }

  for (const [name, address, city, openTime, closeTime, phone] of [
    ["BGC High Street", "9th Ave cor. 28th St, Bonifacio Global City", "Taguig City", "07:00", "21:00", "02 8123 4567"],
    ["Greenbelt Makati", "Greenbelt 3, Ayala Center", "Makati City", "08:00", "22:00", "02 8123 4568"],
    ["Iligan City Center", "Quezon Avenue, Poblacion", "Iligan City", "07:00", "20:00", "063 221 0000"],
  ]) await branches.create({ name, address, city, openTime, closeTime, phone, acceptsDelivery: true });

  await promoCoupons.create({ code: "BREWGO10", title: "10% off your order", type: "percent", value: 10, minSpend: 100, expiresAt: addDays(new Date(), 365).toISOString(), usedBy: [] });
  await promoCoupons.create({ code: "SUMMER20", title: "Summer 20% off (expired)", type: "percent", value: 20, minSpend: 0, expiresAt: "2025-08-31T00:00:00.000Z", usedBy: [] }); // handy for testing COUPON_EXPIRED

  for (const [title, value, pointsCost, minSpend, perk] of [
    ["PHP 10 coupon", 10, 10, 0, null],
    ["PHP 20 coupon", 20, 25, 0, null],
    ["PHP 20 coupon + Bag", 20, 50, 0, "Free tote bag"],
    ["PHP 100 coupon", 100, 100, 120, null],
    ["Free Handcrafted Drink", 150, 150, 0, null],
    ["PHP 75 coupon + Tumbler", 75, 150, 0, "Free Brew Go tumbler"],
    ["PHP 250 coupon", 250, 250, 300, null],
  ]) await rewards.create({ title: title.replace("PHP ", "\u20B1"), type: "fixed", value, pointsCost, minSpend, perk, category: perk ? "Merch" : "Bakery & Drinks" });
}

module.exports = { seedCatalog };
