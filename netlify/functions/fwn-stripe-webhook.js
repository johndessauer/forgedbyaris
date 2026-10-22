// Stripe webhook for FORGE and FWN Checkout. Copies session metadata onto the
// Stripe customer, subscription, and payment. metadata.ref is the referral
// code. FWN sessions also keep lead_source, sold_by, rep, and package on the
// subscription. This does not add a price or charge the customer. Configure
// a dedicated endpoint for checkout.session.completed and
// checkout.session.async_payment_succeeded. Do not replace the webhook
// Memberstack already uses.

const { webhookHandler } = require('./_Lib/fwn');

exports.handler = function (event) {
  return webhookHandler(event);
};
