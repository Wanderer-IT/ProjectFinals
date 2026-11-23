const crypto = require("crypto");
const config = require("../../config");
const { ServiceUnavailableError } = require("../../utils/errors");

class MayaClient {
  constructor(settings) { this.settings = settings; }
  basic(key) { return "Basic " + Buffer.from(`${key}:`).toString("base64"); }

  async request(method, path, key, body, attempt = 1) {
    try {
      const res = await fetch(`${this.settings.baseUrl}${path}`, {
        method,
        headers: { Authorization: this.basic(key), "Content-Type": "application/json", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
      if (method === "GET" && res.status >= 500 && attempt < 2) return this.request(method, path, key, body, attempt + 1);
      return { status: res.status, ok: res.ok, data };
    } catch (error) {
      if (method === "GET" && attempt < 2) return this.request(method, path, key, body, attempt + 1);
      console.error(`[maya] ${method} ${path} failed: ${error.message}`);
      throw new ServiceUnavailableError("The payment provider is not reachable right now. Please try again.", "PAYMENT_GATEWAY_ERROR", { provider: "maya", reason: "network" });
    }
  }
  createCheckout(body) { return this.request("POST", "/checkout/v1/checkouts", this.settings.publicKey, body); }
  getPayment(id) { return this.request("GET", `/payments/v1/payments/${encodeURIComponent(id)}`, this.settings.secretKey); }
  createWebhook(name, callbackUrl) { return this.request("POST", "/payments/v1/webhooks", this.settings.secretKey, { name, callbackUrl }); }
  listWebhooks() { return this.request("GET", "/payments/v1/webhooks", this.settings.secretKey); }
  deleteWebhook(id) { return this.request("DELETE", `/payments/v1/webhooks/${encodeURIComponent(id)}`, this.settings.secretKey); }
}

function mapStatus(payment) {
  const s = String(payment.paymentStatus || payment.status || "").toUpperCase();
  if (payment.isPaid === true || s === "PAYMENT_SUCCESS") return "paid";
  if (s === "PAYMENT_EXPIRED" || s === "PAYMENT_CANCELLED") return "cancelled";
  return "active"; // pending, failed attempt (customer may retry), authorized, ...
}

// ADAPTER: same interface as the mock gateway adapter, so the Bridge in paymentService doesn't care which one runs.
class MayaAdapter {
  constructor(client = new MayaClient(config.payment.maya)) { this.client = client; }

  async createSession(order, buyer) {
    const redirect = (page, extra = "") => `${config.frontendUrl}/payment/${page}?orderId=${order.id}${extra}`;
    const body = {
      totalAmount: {
        value: order.pricing.total,
        currency: config.currency,
        details: { subtotal: order.pricing.subtotal, shippingFee: order.pricing.deliveryFee, discount: order.pricing.discount },
      },
      buyer: {
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        contact: { phone: buyer.phone, email: buyer.email },
      },
      items: order.items.map((i) => ({
        name: i.name.slice(0, 255),
        quantity: i.quantity,
        code: String(i.productId),
        description: (i.optionLabels.join(", ") || i.category).slice(0, 255),
        amount: { value: i.unitPrice },
        totalAmount: { value: i.lineTotal },
      })),
      redirectUrl: { success: redirect("success"), failure: redirect("cancelled", "&reason=failed"), cancel: redirect("cancelled", "&reason=cancelled") },
      // 1-36 chars. The random suffix keeps it unique even after a server restart resets order numbers
      // (and when several students share the public sandbox merchant).
      requestReferenceNumber: `${order.orderNumber}-${crypto.randomBytes(3).toString("hex")}`,
      metadata: { orderId: String(order.id) },
    };
    const res = await this.client.createCheckout(body);
    if (!res.ok || !res.data || !res.data.checkoutId || !res.data.redirectUrl) {
      console.error(`[maya] create checkout rejected (${res.status}):`, JSON.stringify(res.data));
      throw new ServiceUnavailableError("We couldn't start the payment. Please try again in a moment.", "PAYMENT_GATEWAY_ERROR", { provider: "maya", status: res.status });
    }
    return { sessionId: res.data.checkoutId, checkoutUrl: res.data.redirectUrl, status: "active" };
  }

  // Truth from Maya, never from the browser or the webhook body.
  async getSession(sessionId) {
    const res = await this.client.getPayment(sessionId);
    if (res.status === 404) return { sessionId, status: "active" }; // customer has not attempted payment yet
    if (!res.ok || !res.data) {
      console.error(`[maya] get payment failed (${res.status}):`, JSON.stringify(res.data));
      throw new ServiceUnavailableError("We couldn't verify the payment right now. Please try again.", "PAYMENT_GATEWAY_ERROR", { provider: "maya", status: res.status });
    }
    const payment = Array.isArray(res.data) ? res.data[res.data.length - 1] || {} : res.data;
    const amount = payment.amount !== undefined ? Number(payment.amount && payment.amount.value !== undefined ? payment.amount.value : payment.amount) : undefined;
    return { sessionId, status: mapStatus(payment), amount: Number.isFinite(amount) ? amount : undefined, reference: payment.requestReferenceNumber, raw: { paymentStatus: payment.paymentStatus } };
  }
}

module.exports = { MayaClient, MayaAdapter, mapStatus };
