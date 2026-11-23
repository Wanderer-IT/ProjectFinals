const paymentService = require("../services/paymentService");
const config = require("../config");
const { escapeHtml } = require("../utils/helpers");
const { UnprocessableError } = require("../utils/errors");
const { ok } = require("../utils/respond");
const { decorateController } = require("../utils/decorators");

// What the customer does on the sandbox page. (A plain function, not a controller entry, so the logging decorator wraps real handlers only.)
async function sandboxAction(action, req, res) {
  const { order } = await paymentService.simulateCustomerAction(req.params.sessionId, action);
  const page = action === "pay" ? "success" : "cancelled";
  // Redirect back to the React app. That page must still ask the API for the real status.
  res.redirect(303, `${config.frontendUrl}/payment/${page}?orderId=${order ? order.id : ""}`);
}

module.exports = decorateController("payments", {
  // Stand-in for the gateway's hosted checkout page (PayMongo / Maya sandbox). No real money.
  sandboxPage: async (req, res) => {
    const s = await paymentService.getSandboxSession(req.params.sessionId);
    const base = `/api/v1/payments/sandbox/${encodeURIComponent(s.sessionId)}`;
    const active = s.status === "active";
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brew Go Sandbox Checkout</title>
<style>body{font-family:system-ui,sans-serif;background:#fbf2dd;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#fff;border-radius:20px;padding:28px;max-width:360px;width:90%;box-shadow:0 8px 30px #0002;text-align:center}
button{width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;margin-top:10px;cursor:pointer}
.pay{background:#5b2f1a;color:#fff}.cancel{background:#eee}small{color:#777}</style></head>
<body><main><h1>Brew Go</h1><p><small>SANDBOX - no real money is charged</small></p>
<p>Order <strong>${escapeHtml(s.reference)}</strong></p><h2>\u20B1${escapeHtml(s.amount.toFixed(2))}</h2>
${active ? `<form method="post" action="${base}/pay"><button class="pay" type="submit">Pay now</button></form>
<form method="post" action="${base}/cancel"><button class="cancel" type="submit">Cancel</button></form>` : `<p>This payment session is already <strong>${escapeHtml(s.status)}</strong>.</p>`}
</main></body></html>`);
  },
  sandboxPay: (req, res) => sandboxAction("pay", req, res),
  sandboxCancel: (req, res) => sandboxAction("cancel", req, res),
  // Mock-gateway webhook (secret in header).
  webhook: async (req, res) => {
    paymentService.verifyWebhookSecret(req.get("X-Webhook-Secret"));
    const { type, data } = req.body || {};
    if (typeof type !== "string" || !data || typeof data.sessionId !== "string") {
      throw new UnprocessableError("Invalid webhook payload", "VALIDATION_ERROR", [{ field: "body", message: "expected { type, data: { sessionId } }" }]);
    }
    const { applied } = await paymentService.handleWebhook({ sessionId: data.sessionId });
    ok(res, { received: true, applied });
  },
  // Maya webhook. Maya cannot send custom headers, so the secret travels in the URL you register: /webhooks/maya?token=...
  // The body is never trusted: we only use its id to ask Maya for the real payment status.
  mayaWebhook: async (req, res) => {
    paymentService.verifyWebhookSecret(req.query.token);
    const payload = req.body || {};
    try {
      await paymentService.handleWebhook({ sessionId: payload.id, reference: payload.requestReferenceNumber });
    } catch (error) {
      console.error(`[webhook] ${error.message}`); // still answer 200 so Maya does not keep retrying; /reconcile and the sweeper recover
    }
    ok(res, { received: true });
  },
});
