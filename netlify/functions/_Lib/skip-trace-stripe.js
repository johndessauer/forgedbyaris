// Skip-trace credit packs on the same Stripe account as Marketing.
// Checkout uses MARKETING_STRIPE_SECRET_KEY. Live keys are accepted when
// SKIP_TRACE_LIVE_CHECKOUT or MARKETING_LIVE_MAIL is the string "true".
// This file does not read or write the Marketing wallet.
const crypto = require('crypto');
const { readRuntimeEnv, keyReason } = require('./runtime-env');
const shared = require('../../../assets/js/skip-trace-shared');

function liveCheckout(env) {
  return readRuntimeEnv(env, 'SKIP_TRACE_LIVE_CHECKOUT') === 'true'
    || readRuntimeEnv(env, 'MARKETING_LIVE_MAIL') === 'true';
}

function stripeSecret(env) {
  const key = readRuntimeEnv(env, 'MARKETING_STRIPE_SECRET_KEY');
  const testKey = key.startsWith('sk_test_') || key.startsWith('rk_test_');
  const liveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  if (testKey) return { key: key, live: false };
  if (liveKey && liveCheckout(env)) return { key: key, live: true };
  const err = new Error('Skip-trace checkout is not configured.');
  err.statusCode = 503;
  err.reason = keyReason(key);
  throw err;
}

function webhookSecret(env) {
  return readRuntimeEnv(env, 'SKIP_TRACE_STRIPE_WEBHOOK_SECRET')
    || readRuntimeEnv(env, 'MARKETING_STRIPE_WEBHOOK_SECRET');
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
  const pack = shared.packById(options.packId);
  if (!pack) {
    const err = new Error('Choose the $10, $25, or $50 pack.');
    err.statusCode = 400;
    throw err;
  }
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('payment_method_types[0]', 'card');
  body.set('success_url', options.successUrl);
  body.set('cancel_url', options.cancelUrl);
  body.set('client_reference_id', String(options.memberId));
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(pack.amountCents));
  body.set('line_items[0][price_data][product_data][name]', secret.live ? 'FORGE skip-trace credits' : 'FORGE skip-trace credits (test)');
  body.set('metadata[purpose]', 'skip-trace-credits');
  body.set('metadata[member_id]', String(options.memberId));
  body.set('metadata[amount_cents]', String(pack.amountCents));
  body.set('metadata[pack_id]', pack.id);
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
    const err = new Error('Checkout could not be started.');
    err.statusCode = 502;
    throw err;
  }
  return { url: data.url, id: data.id, amountCents: pack.amountCents, live: secret.live };
}

module.exports = {
  liveCheckout,
  stripeSecret,
  webhookSecret,
  verifyWebhook,
  createPackSession,
};
