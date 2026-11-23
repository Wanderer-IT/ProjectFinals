const config = require("../config");
const { products } = require("../repositories");
const productService = require("./productService");
const { ServiceUnavailableError } = require("../utils/errors");

// The "external" AI provider (stand-in for Gemini/OpenAI). It only ever sees the menu
// and returns text in ITS OWN format. Keys for a real provider would live in process.env.
class MockAiProvider {
  constructor() {
    this.synonyms = {
      sweet: ["sweet", "dessert", "sugary", "sugar", "treat"], creamy: ["creamy", "cream", "smooth", "milky"],
      strong: ["strong", "bold", "kick", "wake", "energy", "tired", "caffeine"], iced: ["cold", "iced", "ice", "refreshing", "cool", "hot day", "summer"],
      hot: ["hot", "warm", "cozy", "rainy"], pastry: ["pastry", "snack", "bite", "hungry", "food", "breakfast", "bread"],
      plantbased: ["vegan", "plant", "dairy-free", "dairy free", "lactose", "oat", "non-dairy"], light: ["light", "mild", "gentle"],
      caramel: ["caramel"], ube: ["ube", "purple"], matcha: ["matcha", "green tea"], chocolate: ["chocolate", "cocoa"],
      coconut: ["coconut", "tropical"], almond: ["almond", "nutty"], cinnamon: ["cinnamon"], buttery: ["butter", "buttery", "croissant"],
    };
  }
  complete({ prompt, menu }) {
    const text = prompt.toLowerCase();
    const wantedTags = Object.entries(this.synonyms).filter(([, words]) => words.some((w) => text.includes(w))).map(([tag]) => tag);
    const scored = menu
      .map((m) => ({ id: m.id, score: m.tags.filter((t) => wantedTags.includes(t)).length }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, 4);
    return { choices: [{ message: { content: JSON.stringify({ picks: scored.map((m) => m.id), matched: wantedTags }) } }] };
  }
}

// ADAPTER: hides the provider's response format; the rest of the app gets { productIds, matched }.
class AiProviderAdapter {
  constructor(provider) { this.provider = provider; }
  recommend(query, menu) {
    const raw = this.provider.complete({ prompt: query, menu });
    const parsed = JSON.parse(raw.choices[0].message.content);
    return { productIds: parsed.picks, matched: parsed.matched };
  }
}
const ai = new AiProviderAdapter(new MockAiProvider());

const unavailable = () =>
  new ServiceUnavailableError("Our AI assistant is taking a break. You can still search the menu.", "AI_UNAVAILABLE", {
    fallback: { endpoint: "/api/v1/products", queryParam: "search" },
  });

exports.recommend = (query, user, { simulateOutage = false } = {}) => {
  if (!config.aiEnabled || simulateOutage) throw unavailable(); // finals doc: 503 AI_UNAVAILABLE
  const menu = products.findAll((p) => productService.isAvailable(p)).map((p) => ({ id: p.id, name: p.name, tags: p.tags }));
  let result;
  try {
    result = ai.recommend(query, menu);
  } catch (err) {
    throw unavailable();
  }
  // GROUNDING: only real database products are returned - prices and stock come from our records, never from AI text.
  const picked = result.productIds.map((id) => products.findById(id)).filter((p) => p && productService.isAvailable(p));
  return {
    label: "AI-Assisted",
    disclaimer: "Suggestions are AI-assisted. Prices and availability come from our menu.",
    // The summary is built by us; the customer's raw text is never echoed back.
    summary: picked.length ? `Here ${picked.length === 1 ? "is 1 pick" : `are ${picked.length} picks`} that match what you're craving.` : "I couldn't find a match. Try words like sweet, iced, strong, plant-based or pastry.",
    products: picked.map((p) => productService.toView(p, user)),
  };
};
