// Marketing wallet checkout. Uses MARKETING_STRIPE_SECRET_KEY only.
// A sandbox secret (sk_test_) or sandbox restricted key (rk_test_) is accepted.
// Live keys are refused. Live checkout env vars are never read.
const crypto = require('crypto');
const { TOP_UPS_CENTS } = require('./marketing-pricing');
const { readRuntimeEnv, keyReason } = require('./runtime-env');

function assertTestStripeKey(env) {
  const key = readRuntimeEnv(env, 'MARKETING_STRIPE_SECRET_KEY');
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return key;
  const err = new Error('Test checkout is not configured.');
  err.statusCode = 503;
  err.reason = keyReason(key);
  throw err;
}

function allowedTopUp(cents) {
  const amount = Math.floor(Number(cents) || 0);
  return TOP_UPS_CENTS.indexOf(amount) !== -1 ? amount : 0;
}

async function createTopUpSession(options) {
  const secret = assertTestStripeKey(options.env);
  const amount = allowedTopUp(options.amountCents);
  if (!amount) {
    const err = new Error('Choose $25, $50, $100, or $250.');
    err.statusCode = 400;
    throw err;
  }
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', options.successUrl);
  body.set('cancel_url', options.cancelUrl);
  body.set('client_reference_id', String(options.memberId));
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(amount));
  body.set('line_items[0][price_data][product_data][name]', 'FORGE Marketing credits (test)');
  body.set('metadata[purpose]', 'marketing-wallet');
  body.set('metadata[member_id]', String(options.memberId));
  body.set('metadata[amount_cents]', String(amount));
  const response = await options.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + secret,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/g, '{CHECKOUT_SESSION_ID}'),
  });
  const data = await response.json();
  if (!response.ok || !data.url) {
    const err = new Error('Test checkout could not be started.');
    err.statusCode = 502;
    throw err;
  }
  return { url: data.url, id: data.id, amountCents: amount };
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

module.exports = {
  assertTestStripeKey: assertTestStripeKey,
  readWebhookSecret: function (env) { return readRuntimeEnv(env, 'MARKETING_STRIPE_WEBHOOK_SECRET'); },
  allowedTopUp: allowedTopUp,
  createTopUpSession: createTopUpSession,
  verifyWebhook: verifyWebhook,
};
