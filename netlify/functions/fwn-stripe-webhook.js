// Stripe webhook for FWN Checkout. On a paid session, POST the buyer to the
// FWN GoHighLevel hook and attach that package's Memberstack plan.
// Configure a dedicated endpoint. Do not replace Memberstack's webhook.

const { webhookHandler } = require('./_Lib/fwn');

exports.handler = function (event) {
  return webhookHandler(event);
};
