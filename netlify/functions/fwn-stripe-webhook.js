// Optional Stripe webhook for FWN Checkout. Copies session metadata onto the
// subscription. It does not add a price, charge the customer, or notify
// GoHighLevel. The Memberstack plan.added webhook does that. Configure a
// dedicated endpoint. Do not replace the webhook Memberstack already uses.

const { webhookHandler } = require('./_Lib/fwn');

exports.handler = function (event) {
  return webhookHandler(event);
};
