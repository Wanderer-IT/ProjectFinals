// PROTOTYPE PATTERN (lecture: structuredClone(baseConfig)):
// every product starts as a deep clone of a template for its category, then is tweaked.
const TEMPLATES = {
  size: { key: "size", label: "Size", required: true, choices: [
    { value: "regular", label: "Regular (12oz)", priceDelta: 0 },
    { value: "large", label: "Large (16oz)", priceDelta: 40 },
  ] },
  milk: { key: "milk", label: "Milk", required: true, choices: [
    { value: "whole", label: "Whole Milk", priceDelta: 0 },
    { value: "oat", label: "Oat Milk", priceDelta: 25 },
    { value: "almond", label: "Almond Milk", priceDelta: 25 },
  ] },
  sweetness: { key: "sweetness", label: "Sweetness", required: true, choices: [
    { value: "100", label: "Regular (100%)", priceDelta: 0 },
    { value: "50", label: "Less Sweet (50%)", priceDelta: 0 },
    { value: "25", label: "Light (25%)", priceDelta: 0 },
    { value: "0", label: "No Sugar (0%)", priceDelta: 0 },
  ] },
  ice: { key: "ice", label: "Ice", required: true, choices: [
    { value: "regular", label: "Regular Ice", priceDelta: 0 },
    { value: "less", label: "Less Ice", priceDelta: 0 },
  ] },
  warmed: { key: "warmed", label: "Serving", required: true, choices: [
    { value: "no", label: "As is", priceDelta: 0 },
    { value: "yes", label: "Warmed", priceDelta: 0 },
  ] },
  drizzle: { key: "drizzle", label: "Extras", required: false, choices: [
    { value: "none", label: "No extras", priceDelta: 0 },
    { value: "extra-drizzle", label: "Extra Drizzle", priceDelta: 15 },
  ] },
};

const CATEGORY_GROUPS = {
  hot: ["size", "milk", "sweetness", "drizzle"],
  iced: ["size", "milk", "sweetness", "ice", "drizzle"],
  pastries: ["warmed"],
};

function buildOptionGroups(category, { plantBased = false, name = "" } = {}) {
  let keys = CATEGORY_GROUPS[category] || [];
  if (/coconut water/i.test(name)) keys = keys.filter((k) => k !== "milk"); // no milk in this one
  const groups = structuredClone(keys.map((k) => TEMPLATES[k]));
  if (plantBased) {
    const milk = groups.find((g) => g.key === "milk");
    if (milk) milk.choices = milk.choices.filter((c) => c.value !== "whole"); // plant-based drinks: no dairy
  }
  return groups;
}

module.exports = { buildOptionGroups };
