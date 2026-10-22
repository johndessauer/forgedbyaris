// Creates a Stripe Checkout Session for an FWN package.
// Prices and secrets come from env. See netlify/functions/_Lib/fwn.js.

const { checkoutHandler } = require('./_Lib/fwn');

exports.handler = function (event) {
  return checkoutHandler(event);
};
