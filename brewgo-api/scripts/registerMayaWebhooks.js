const config = require("../config");
const { MayaClient } = require("../services/gateways/mayaGateway");

const SHARED_SANDBOX_SECRETS = [
  "sk-X8qolYjy62kIzEbr0QRK1h4b4KDVHaNcwMYk39jInSl", "sk-KfmfLJXFdV5t1inYN8lIOwSrueC1G27SCAklBqYCdrU",
  "sk-fzukI3GXrzNIUyvXY3n16cji8VTJITfzylz5o5QzZMC", "sk-VGDKY3P90NYZZ0kSWqBFaD1NTIXQCxtdS7SbQXvcA4g",
  "sk-8MqXdZYWV9UJB92Mc0i149CtzTWT7BYBQeiarM27iAi",
];

const EVENTS = ["PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "PAYMENT_CANCELLED"];

async function main() {
  if (!config.payment.maya.secretKey) throw new Error("Set MAYA_SECRET_KEY first (see .env.example)");
  if (SHARED_SANDBOX_SECRETS.includes(config.payment.maya.secretKey)) {
    throw new Error("These are Maya's shared public sandbox keys. Webhooks would collide with other users'. Generate your own sandbox keys in Maya Business Manager first. (You don't need webhooks to test: the payment return page verifies with Maya directly.)");
  }
  if (!config.publicApiUrl.startsWith("https://")) throw new Error("PUBLIC_API_URL must be an https:// URL that Maya can reach");
  const callbackUrl = `${config.publicApiUrl}/api/v1/webhooks/maya?token=${encodeURIComponent(config.webhookSecret)}`;
  const client = new MayaClient(config.payment.maya);

  const existing = await client.listWebhooks();
  const list = Array.isArray(existing.data) ? existing.data : [];
  const ours = new URL(callbackUrl).origin;
  for (const hook of list.filter((h) => EVENTS.includes(h.name) && String(h.callbackUrl).startsWith(ours))) {
    await client.deleteWebhook(hook.id); // replace only OUR old registrations of these events
    console.log(`removed old ${hook.name} webhook`);
  }
  for (const name of EVENTS) {
    const res = await client.createWebhook(name, callbackUrl);
    console.log(`${name}: ${res.ok ? "registered" : `FAILED (${res.status}) ${JSON.stringify(res.data)}`}`);
  }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
