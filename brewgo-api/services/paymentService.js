const config = require("../config");
const { paymentSessions, orders } = require("../repositories");
const orderService = require("./orderService");
const { nextId } = require("../models/store");
const { NotFoundError, UnauthorizedError, ConflictError } = require("../utils/errors");

// ---------------------------------------------------------------------------
// The "external" payment gateway (stand-in for PayMongo / Maya sandbox).
// It deliberately uses ITS OWN field names (snake_case, nested) like a real provider.
// ---------------------------------------------------------------------------
class MockGateway {
  create_checkout_session({ amount_centavos, reference_number, payment_method_types }) {
    const sessionId = `cs_${nextId("gatewaySession", 1000)}_${Math.random().toString(36).slice(2, 8)}`;
    paymentSessions.create({ sessionId, amount: amount_centavos, reference: reference_number, methods: payment_method_types, status: "active" });
    return {
      data: {
        id: sessionId,
        attributes: {
          checkout_url: `${config.publicApiUrl}/api/v1/payments/sandbox/${sessionId}`,
          status: "active", amount: amount_centavos, reference_number, payment_method_types,
        },
      },
    };
  }
  retrieve_checkout_session(sessionId) {
    const s = paymentSessions.findOne((x) => x.sessionId === sessionId);
    if (!s) return null;
    return { data: { id: s.sessionId, attributes: { status: s.status, amount: s.amount, reference_number: s.reference, payment_method_types: s.methods } } };
  }
  // What the customer does on the hosted page.
  simulate_customer_action(sessionId, action) {
    const s = paymentSessions.findOne((x) => x.sessionId === sessionId);
    if (s && s.status === "active") s.status = action === "pay" ? "paid" : "cancelled";
    return s;
  }
}
const gateway = new MockGateway();

// ADAPTER PATTERN (lab + lecture): converts the gateway's format into the format our app uses.
class GatewayAdapter {
  constructor(externalGateway) { this.gateway = externalGateway; }
  createSession(order) {
    const raw = this.gateway.create_checkout_session({
      amount_centavos: Math.round(order.pricing.total * 100),
      reference_number: order.orderNumber,
      payment_method_types: order.payment.method === "card" ? ["card"] : ["gcash", "paymaya"],
    });
    return { sessionId: raw.data.id, checkoutUrl: raw.data.attributes.checkout_url, status: raw.data.attributes.status };
  }
  getSession(sessionId) {
    const raw = this.gateway.retrieve_checkout_session(sessionId);
    return raw ? { sessionId: raw.data.id, status: raw.data.attributes.status, amount: raw.data.attributes.amount / 100, reference: raw.data.attributes.reference_number } : null;
  }
}
const mockAdapter = new GatewayAdapter(gateway);

const { MayaAdapter } = require("./gateways/mayaGateway");
let mayaAdapter = null;
// Which provider runs is a setting (PAYMENT_PROVIDER). The rest of the app never knows.
const adapter = {
  current() {
    if (config.payment.provider === "maya") {
      if (!config.payment.maya.publicKey || !config.payment.maya.secretKey) throw new Error("PAYMENT_PROVIDER=maya needs MAYA_PUBLIC_KEY and MAYA_SECRET_KEY");
      mayaAdapter = mayaAdapter || new MayaAdapter();
      return mayaAdapter;
    }
    return mockAdapter;
  },
  createSession: (order, buyer) => adapter.current().createSession(order, buyer),
  getSession: (sessionId) => adapter.current().getSession(sessionId),
};

// ---------------------------------------------------------------------------
// BRIDGE PATTERN: PaymentProcessor (abstraction) is separate from the
// payment-method providers (implementations). A new method = a new provider class.
// ---------------------------------------------------------------------------
class PaymentProvider { start() { throw new Error("start() must be implemented"); } }
class EWalletProvider extends PaymentProvider { start(order, buyer) { return adapter.createSession(order, buyer); } }
class CardProvider extends PaymentProvider { start(order, buyer) { return adapter.createSession(order, buyer); } }
class CashProvider extends PaymentProvider { start() { return null; } } // nothing to redirect to

class PaymentProcessor {
  constructor(provider) { this.provider = provider; }
  start(order, buyer) { return this.provider.start(order, buyer); }
}
const PROVIDERS = { ewallet: new EWalletProvider(), card: new CardProvider(), cash: new CashProvider() };
exports.forMethod = (method) => new PaymentProcessor(PROVIDERS[method]);
exports.providerName = () => config.payment.provider;

// Applies what the PROVIDER says (not what the browser or webhook body says) to the order. Safe to run many times.
async function applySession(order, session) {
  if (!session || order.status !== "pending_payment") return false;
  if (session.status === "paid") {
    if (session.amount !== undefined && Math.abs(session.amount - order.pricing.total) > 0.01) {
      console.warn(`[payments] amount mismatch for ${order.orderNumber}: provider ${session.amount} vs order ${order.pricing.total}. Not marking as paid.`);
      return false;
    }
    orderService.transition(order, "paid");
    return true;
  }
  if (session.status === "cancelled") {
    orderService.transition(order, "cancelled");
    return true;
  }
  return false; // still pending (or a failed attempt the customer can retry)
}

exports.verifyWebhookSecret = (secret) => {
  if (!secret || secret !== config.webhookSecret) throw new UnauthorizedError("Invalid webhook secret", "WEBHOOK_UNAUTHORIZED");
};

// Webhook received: look the order up, then ask the provider for the real status.
exports.handleWebhook = async ({ sessionId, reference }) => {
  const baseNumber = reference && String(reference).match(/^BG-\d+/); // "BG-8922-a1b2c3" -> "BG-8922"
  const order = (sessionId && orders.findBySession(sessionId)) || (baseNumber && orders.findByNumber(baseNumber[0]));
  if (!order || !order.payment.sessionId) return { applied: false, order: null };
  const applied = await applySession(order, await adapter.getSession(order.payment.sessionId));
  return { applied, order };
};

// Backup for a missed webhook (and what the /payment/success page triggers): ask the provider, then sync the order.
exports.reconcile = async (order) => {
  if (!order.payment.sessionId) throw new ConflictError("This order has no online payment to verify", "NO_PAYMENT_SESSION");
  await applySession(order, await adapter.getSession(order.payment.sessionId));
  return order;
};

// Abandoned checkouts: after the session expires, release the stock. Check with the provider first, in case it was paid.
exports.sweepStale = async (now = Date.now()) => {
  const limit = config.payment.pendingExpiryMinutes * 60000;
  const stale = orders.findAll((o) => o.status === "pending_payment" && now - Date.parse(o.createdAt) > limit);
  for (const order of stale) {
    try {
      await exports.reconcile(order);
      if (order.status === "pending_payment") orderService.transition(order, "cancelled");
    } catch (error) {
      console.error(`[payments] could not sweep ${order.orderNumber}: ${error.message}`);
    }
  }
  return stale.length;
};

// ---- mock sandbox page only ----
exports.getSandboxSession = async (sessionId) => {
  const session = await mockAdapter.getSession(sessionId);
  if (!session) throw new NotFoundError("Payment session");
  return session;
};
exports.simulateCustomerAction = async (sessionId, action) => {
  await exports.getSandboxSession(sessionId);
  gateway.simulate_customer_action(sessionId, action);
  const order = orders.findBySession(sessionId);
  if (order) await applySession(order, await mockAdapter.getSession(sessionId));
  return { order };
};
