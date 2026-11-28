// Extra Talk Mode minutes on the same Stripe account as skip-trace.
// Checkout uses MARKETING_STRIPE_SECRET_KEY. Live keys are accepted only
// when TALK_PACK_LIVE_CHECKOUT is the string "true". The default is test mode.
// automatic_tax is off. tax_behavior and tax codes are not sent.
const crypto = require('crypto');
const { readRuntimeEnv, keyReason } = require('./runtime-env');
const talk = require('../../../assets/js/aris-talk');

// Test-mode product and price on the FORGE account. Inline price_data is
// what Checkout charges. The ids are metadata only, so a tax code on the
// pre-made product is not applied.
const PACK_PRODUCT_ID = 'prod_Vi0PsLX2Yfw3y9';
const PACK_PRICE_ID = 'price_1UgaOnK4zh6RSWCry84qZAnS';

function liveCheckout(env) {
  return readRuntimeEnv(env, 'TALK_PACK_LIVE_CHECKOUT') === 'true';
}

function stripeSecret(env) {
  const key = readRuntimeEnv(env, 'MARKETING_STRIPE_SECRET_KEY');
  const testKey = key.startsWith('sk_test_') || key.startsWith('rk_test_');
  const liveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  if (testKey) return { key: key, live: false };
  if (liveKey && liveCheckout(env)) return { key: key, live: true };
  const err = new Error('Extra minutes are not available right now.');
  err.statusCode = 503;
  err.reason = keyReason(key);
  throw err;
}

function webhookSecret(env) {
  return readRuntimeEnv(env, 'TALK_PACK_STRIPE_WEBHOOK_SECRET');
}

function verifyWebhook(rawBody, header, secret) {
  const sig = String(header || '');
  const parts = {};
  sig.split(',').forEach(function (pair) {
    const cut = pair.indexOf('=');
    if (cut > 0) parts[pair.slice(0, cut)] = pair.slice(cut + 1);
  });
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1 || !secret) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(v1));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function createPackSession(options) {
  const secret = stripeSecret(options.env);
  const monthKey = String(options.monthKey || '');
  if (!/^[0-9]{4}-[0-9]{2}$/.test(monthKey)) {
    const err = new Error('Extra minutes could not be started.');
    err.statusCode = 400;
    throw err;
  }
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('payment_method_types[0]', 'card');
  body.set('success_url', options.successUrl);
  body.set('cancel_url', options.cancelUrl);
  body.set('client_reference_id', String(options.memberId));
  body.set('automatic_tax[enabled]', 'false');
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(talk.PACK_AMOUNT_CENTS));
  body.set(
    'line_items[0][price_data][product_data][name]',
    secret.live ? 'Talk Mode extra minutes' : 'Talk Mode extra minutes (test)'
  );
  body.set('metadata[purpose]', 'talk-extra-minutes');
  body.set('metadata[member_id]', String(options.memberId));
  body.set('metadata[minutes]', String(talk.PACK_MINUTES));
  body.set('metadata[month_key]', monthKey);
  body.set('metadata[amount_cents]', String(talk.PACK_AMOUNT_CENTS));
  body.set('metadata[product]', PACK_PRODUCT_ID);
  body.set('metadata[price]', PACK_PRICE_ID);
  const response = await options.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + secret.key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/g, '{CHECKOUT_SESSION_ID}'),
  });
  const data = await response.json();
  if (!response.ok || !data.url) {
    const err = new Error('Extra minutes could not be started.');
    err.statusCode = 502;
    throw err;
  }
  return { url: data.url, id: data.id, live: secret.live };
}

module.exports = {
  PACK_PRODUCT_ID,
  PACK_PRICE_ID,
  liveCheckout,
  stripeSecret,
  webhookSecret,
  verifyWebhook,
  createPackSession,
};
