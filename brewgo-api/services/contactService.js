const { contactMessages, orders } = require("../repositories");
const { nowIso } = require("../utils/helpers");
const { UnprocessableError } = require("../utils/errors");

exports.channels = () => ({
  chat: { label: "Chat with a barista", hours: "7:00 AM - 9:00 PM daily" },
  call: { label: "Call us", phone: "+63 2 8123 4567", hours: "7:00 AM - 9:00 PM daily" },
  email: { label: "Email us", address: "hello@brewgo.example", responseTime: "within 24 hours" },
});

exports.create = async (body, user) => {
  if (body.orderId !== undefined) {
    const order = await orders.findById(body.orderId);
    if (!order || !user || order.userId !== user.id) {
      throw new UnprocessableError("Please fix the highlighted fields", "VALIDATION_ERROR", [{ field: "orderId", message: "orderId does not match one of your orders" }]);
    }
  }
  const message = await contactMessages.create({
    userId: user ? user.id : null, name: body.name, email: body.email.toLowerCase(), message: body.message,
    channel: body.channel || "email", orderId: body.orderId || null, status: "open", createdAt: nowIso(),
  });
  return { ticketId: `CT-${1000 + message.id}`, status: message.status, channel: message.channel, createdAt: message.createdAt };
};
