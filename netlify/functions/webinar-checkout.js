// Memberstack checkout for a FORGE webinar package. Not FWN.
// Prices and secrets come from env. See netlify/functions/_Lib/webinar.js.
// Stripe metadata copy stays on the existing /api/fwn-stripe-webhook path.
// That webhook recognizes metadata.package webinar-997 and webinar-1797.

const { checkoutHandler } = require('./_Lib/webinar');

exports.handler = function (event) {
  return checkoutHandler(event);
};
