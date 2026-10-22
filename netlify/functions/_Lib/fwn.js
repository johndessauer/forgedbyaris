// FWN webinar checkout.
//
// Unlisted pages under /fwn/* charge a one-time enrollment plus the FORGE
// subscription on the FORGE Stripe account. Billing follows
// signup-foundation-empire.html: the amount due today includes the first
// $97 month, the subscription starts at signup, and there is no free trial
// and no free months. Stripe Checkout therefore has two line items on the
// first invoice:
//
//   one-time Price  = package due-today minus $97
//   monthly Price   = $97, billed every month, first invoice at signup
//
// Price IDs come from env vars. This code does not create Stripe products
// or prices. Create them in the FORGE Stripe account (test mode first):
//
//   STRIPE_SECRET_KEY              FORGE Stripe secret key (sk_test_... or sk_live_...)
//   STRIPE_WEBHOOK_SECRET          signing secret for a NEW endpoint
//                                  POST https://forgedbyaris.com/api/fwn-stripe-webhook
//                                  events: checkout.session.completed,
//                                          checkout.session.async_payment_succeeded
//                                  Do not replace the webhook Memberstack already uses.
//   STRIPE_PRICE_FWN_MONTHLY       active USD recurring price, $97 / month (9700 cents)
//   STRIPE_PRICE_FWN_LAUNCH        active USD one-time price, $2,400 (240000 cents)
//   STRIPE_PRICE_FWN_ACCELERATOR   active USD one-time price, $4,900 (490000 cents)
//   STRIPE_PRICE_FWN_997           active USD one-time price, $900  (90000 cents)
//   STRIPE_PRICE_FWN_1797          active USD one-time price, $1,700 (170000 cents)
//
// Due today on the page is one-time + $97:
//   Launch $2,497, Accelerator $4,997, 997 $997, 1797 $1,797.
//
// Memberstack plans do not exist yet. Create one FREE plan per package
// (no Stripe price on the plan — payment is collected by this Checkout).
// addFreePlan is what the admin SDK exposes, and a paid plan would open a
// second charge. Then replace the placeholders:
//
//   MEMBERSTACK_PLAN_FWN_LAUNCH=pln_fwn_launch_placeholder
//   MEMBERSTACK_PLAN_FWN_ACCELERATOR=pln_fwn_accelerator_placeholder
//   MEMBERSTACK_PLAN_FWN_997=pln_fwn_997_placeholder
//   MEMBERSTACK_PLAN_FWN_1797=pln_fwn_1797_placeholder
//
// Gated member pages keep their own hardcoded plan allowlists. A new plan
// id does not unlock those tools until the id is added there. That is
// intentionally not done here: the ids do not exist yet, and existing
// member pages are left unchanged.
//
// Attribution on every Checkout Session, both metadata and
// subscription_data.metadata:
//   lead_source  fwn-virtual | fwn-raleigh   (?src=)
//   sold_by      cart | john | rep           (?sold_by=, or rep when ?ref= is set)
//   rep          ?ref= via the same sanitize rules as assets/js/ref-capture.js

const https = require('https');
const crypto = require('crypto');
const { sanitize } = require('../../../assets/js/ref-capture');
const { json, preflight } = require('./http');

const FWN_GHL_HOOK = 'https://services.leadconnectorhq.com/hooks/3dQD2B6ZsBjZVIrWF8WR/webhook-trigger/50f73ea5-6f8b-49bd-8ba2-458aae6e7d9f';
const MONTHLY_CENTS = 9700;
const MONTHLY_ENV = 'STRIPE_PRICE_FWN_MONTHLY';
const STRIPE_API_VERSION = '2024-06-20';
const LEAD_SOURCES = new Set(['fwn-virtual', 'fwn-raleigh']);
const SOLD_BY = new Set(['cart', 'john', 'rep']);

const SUBMIT_MESSAGE = 'Due today is the one-time enrollment plus the first month of FORGE at $97. The subscription starts at signup. There is no free trial and no free months. After the first month, FORGE continues at $97/month.';

const PACKAGES = Object.freeze({
  launch: {
    slug: 'launch',
    label: 'Launch',
    dueTodayCents: 249700,
    dueTodayLabel: '$2,497',
    path: '/fwn/launch',
    oneTimeEnv: 'STRIPE_PRICE_FWN_LAUNCH',
    planEnv: 'MEMBERSTACK_PLAN_FWN_LAUNCH',
  },
  accelerator: {
    slug: 'accelerator',
    label: 'Accelerator',
    dueTodayCents: 499700,
    dueTodayLabel: '$4,997',
    path: '/fwn/accelerator',
    oneTimeEnv: 'STRIPE_PRICE_FWN_ACCELERATOR',
    planEnv: 'MEMBERSTACK_PLAN_FWN_ACCELERATOR',
  },
  '997': {
    slug: '997',
    label: '997',
    dueTodayCents: 99700,
    dueTodayLabel: '$997',
    path: '/fwn/997',
    oneTimeEnv: 'STRIPE_PRICE_FWN_997',
    planEnv: 'MEMBERSTACK_PLAN_FWN_997',
  },
  '1797': {
    slug: '1797',
    label: '1797',
    dueTodayCents: 179700,
    dueTodayLabel: '$1,797',
    path: '/fwn/1797',
    oneTimeEnv: 'STRIPE_PRICE_FWN_1797',
    planEnv: 'MEMBERSTACK_PLAN_FWN_1797',
  },
});

const PUBLIC_UNAVAILABLE = 'This checkout is not available right now. Please contact support@forgedbyaris.com.';

class FwnError extends Error {
  constructor(statusCode, publicMessage, detail) {
    super(detail || publicMessage);
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function encodeForm(value, prefix, pairs) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => encodeForm(item, prefix + '[' + i + ']', pairs));
    return;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      const next = prefix ? prefix + '[' + key + ']' : key;
      encodeForm(value[key], next, pairs);
    });
    return;
  }
  pairs.push(encodeURIComponent(prefix) + '=' + encodeURIComponent(String(value)));
}

function toForm(obj) {
  const pairs = [];
  encodeForm(obj, '', pairs);
  return pairs.join('&');
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) {
    throw new FwnError(400, 'Enter your first and last name.');
  }
  return name;
}

function normalizePhone(value) {
  if (value == null || String(value).trim() === '') return '';
  const cleaned = String(value).trim().replace(/[^\d+().\-\s]/g, '').slice(0, 40);
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw new FwnError(400, 'Enter a valid phone number, or leave phone blank.');
  }
  return cleaned;
}

function normalizeMemberId(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return '';
  return id;
}

function attributionFromInput({ src, soldBy, ref }) {
  const leadSource = String(src || '').trim().toLowerCase();
  if (!LEAD_SOURCES.has(leadSource)) {
    throw new FwnError(400, 'This checkout link needs src=fwn-virtual or src=fwn-raleigh.');
  }
  const rep = sanitize(ref);
  let sold = String(soldBy || '').trim().toLowerCase();
  if (!SOLD_BY.has(sold)) sold = rep ? 'rep' : 'cart';
  return { lead_source: leadSource, sold_by: sold, rep };
}

function isStripePriceId(id) {
  return typeof id === 'string' && /^price_[A-Za-z0-9]+$/.test(id);
}

function isRealPlanId(id) {
  return typeof id === 'string' && /^pln_[A-Za-z0-9_-]+$/.test(id) && !/placeholder/i.test(id);
}

function requirePriceId(env, key) {
  const id = env[key];
  if (!isStripePriceId(id)) {
    throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Missing or invalid ' + key);
  }
  return id;
}

function validatePrices({ oneTime, monthly, dueTodayCents }) {
  const problems = [];
  const oneTimeOk = oneTime && oneTime.active !== false && oneTime.type === 'one_time' &&
    oneTime.currency === 'usd' && Number.isInteger(oneTime.unit_amount);
  if (!oneTimeOk) problems.push('one-time price must be an active USD one-time price');

  const interval = monthly && monthly.recurring && monthly.recurring.interval;
  const intervalCount = monthly && monthly.recurring ? (monthly.recurring.interval_count || 1) : 0;
  const monthlyOk = monthly && monthly.active !== false && monthly.type === 'recurring' &&
    interval === 'month' && intervalCount === 1 && monthly.currency === 'usd' &&
    monthly.unit_amount === MONTHLY_CENTS;
  if (!monthlyOk) problems.push('monthly price must be an active USD price of $97 billed every month');

  if (oneTimeOk && monthly && Number.isInteger(monthly.unit_amount)) {
    const total = oneTime.unit_amount + monthly.unit_amount;
    if (total !== dueTodayCents) {
      problems.push('prices total ' + total + ' cents but this package is ' + dueTodayCents + ' cents due today. The one-time price must be the package price minus the included first $97 month.');
    }
  }
  return { ok: problems.length === 0, problems };
}

function safeCancelPath(input, packageSlug) {
  const fallback = (PACKAGES[packageSlug] && PACKAGES[packageSlug].path) || '/fwn/launch';
  if (typeof input !== 'string') return fallback;
  if (!input.startsWith('/fwn/')) return fallback;
  if (input.startsWith('//') || input.includes('://') || input.includes('\\')) return fallback;
  if (input.length > 500) return fallback;
  return input;
}

function originFromEvent(event) {
  const headers = event.headers || {};
  const host = headers['x-forwarded-host'] || headers.host || headers.Host;
  const proto = (headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https').split(',')[0].trim();
  if (!host || /[\s/]/.test(host) || !/^https?$/.test(proto)) {
    throw new FwnError(500, PUBLIC_UNAVAILABLE, 'bad host header');
  }
  return proto + '://' + host;
}

function buildSessionParams({
  oneTimePriceId, monthlyPriceId, customerId, successUrl, cancelUrl,
  memberId, name, email, phone, lead_source, sold_by, rep, packageSlug,
}) {
  const attribution = {
    lead_source: lead_source,
    sold_by: sold_by,
    rep: rep || '',
    package: packageSlug,
  };
  return {
    mode: 'subscription',
    customer: customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: memberId || undefined,
    line_items: [
      { price: oneTimePriceId, quantity: 1 },
      { price: monthlyPriceId, quantity: 1 },
    ],
    metadata: {
      lead_source: attribution.lead_source,
      sold_by: attribution.sold_by,
      rep: attribution.rep,
      package: packageSlug,
      name: clip(name, 120),
      email: clip(email, 200),
      phone: clip(phone, 40),
      memberstack_id: memberId || '',
    },
    subscription_data: {
      metadata: {
        lead_source: attribution.lead_source,
        sold_by: attribution.sold_by,
        rep: attribution.rep,
        package: packageSlug,
      },
    },
    custom_text: {
      submit: { message: SUBMIT_MESSAGE },
    },
  };
}

function containsTrialKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some((key) => {
    if (key === 'trial_period_days' || key === 'trial_end') return true;
    return containsTrialKey(value[key]);
  });
}

function rawBody(event) {
  if (!event || event.body == null) return '';
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64').toString('utf8');
  return String(event.body);
}

function verifyStripeSignature(raw, header, secret, toleranceSec, nowSec) {
  if (!raw || !header || !secret) return false;
  const tolerance = toleranceSec == null ? 300 : toleranceSec;
  const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
  let timestamp = '';
  const signatures = [];
  String(header).split(',').forEach((part) => {
    const item = part.trim();
    const idx = item.indexOf('=');
    if (idx === -1) return;
    const key = item.slice(0, idx);
    const val = item.slice(idx + 1);
    if (key === 't') timestamp = val;
    if (key === 'v1') signatures.push(val);
  });
  if (!timestamp || !signatures.length) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + raw, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return signatures.some((sig) => {
    const buf = Buffer.from(sig, 'utf8');
    if (buf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(buf, expectedBuf);
  });
}

function classifyStripeEvent(stripeEvent) {
  const type = stripeEvent && stripeEvent.type;
  const session = stripeEvent && stripeEvent.data && stripeEvent.data.object;
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
    return { process: false, reason: 'event' };
  }
  if (type === 'checkout.session.completed' && (!session || session.payment_status !== 'paid')) {
    return { process: false, reason: 'unpaid' };
  }
  const packageSlug = session && session.metadata && session.metadata.package;
  if (!session || session.mode !== 'subscription' || !PACKAGES[packageSlug]) {
    return { process: false, reason: 'not_fwn' };
  }
  if (!LEAD_SOURCES.has(session.metadata.lead_source)) {
    return { process: false, reason: 'lead_source' };
  }
  return { process: true };
}

function buyerFromSession(session) {
  const md = (session && session.metadata) || {};
  const details = (session && session.customer_details) || {};
  return {
    name: String(md.name || details.name || '').trim(),
    email: String(details.email || session.customer_email || md.email || '').trim(),
    phone: String(md.phone || details.phone || '').trim(),
    package: String(md.package || '').trim(),
    lead_source: String(md.lead_source || '').trim(),
    sold_by: String(md.sold_by || '').trim(),
    rep: String(md.rep || '').trim(),
    memberstack_id: String(md.memberstack_id || (session && session.client_reference_id) || '').trim(),
  };
}

function ghlPayload(buyer, sessionId) {
  const body = {
    name: buyer.name || '',
    email: buyer.email,
    package: buyer.package,
    lead_source: buyer.lead_source,
    sold_by: buyer.sold_by,
    rep: buyer.rep || '',
    stripe_checkout_session_id: sessionId || '',
  };
  if (buyer.phone) body.phone = buyer.phone;
  return body;
}

function stripeRequest(secret, method, path, formBody) {
  const body = formBody || '';
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stripe.com',
      path: path,
      method: method,
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (err) { parsed = {}; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else {
          const message = (parsed.error && parsed.error.message) || ('Stripe HTTP ' + res.statusCode);
          const error = new FwnError(502, PUBLIC_UNAVAILABLE, message);
          error.stripe = parsed;
          reject(error);
        }
      });
    });
    req.on('error', (err) => reject(new FwnError(502, PUBLIC_UNAVAILABLE, err.message)));
    if (body) req.write(body);
    req.end();
  });
}

function postJson(urlString, payload, timeoutMs) {
  const body = JSON.stringify(payload);
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs || 8000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('GHL hook timed out')));
    req.write(body);
    req.end();
  });
}

function memberstackClient(secret) {
  const memberstackAdmin = require('@memberstack/admin');
  return memberstackAdmin.init(secret);
}

function alreadyHasPlan(member, planId) {
  return ((member && member.planConnections) || []).some((pc) => {
    if (!pc) return false;
    if (typeof pc === 'string') return pc === planId;
    if (pc.planId !== planId) return false;
    const status = String(pc.status || '').toUpperCase();
    return status !== 'CANCELED' && status !== 'CANCELLED' && status !== 'EXPIRED';
  });
}

async function attachFwnPlan({ memberstack, email, memberId, planId }) {
  let member = null;
  if (memberId) {
    try {
      const byId = await memberstack.members.retrieve({ id: memberId });
      const found = byId && byId.data;
      const foundEmail = found && found.auth && found.auth.email;
      if (found && foundEmail && email && foundEmail.toLowerCase() === email.toLowerCase()) member = found;
    } catch (err) {
      member = null;
    }
  }
  if (!member && email) {
    const byEmail = await memberstack.members.retrieve({ email: email });
    member = byEmail && byEmail.data;
  }
  if (!member || !member.id) {
    throw new FwnError(500, 'Plan attach failed', 'No Memberstack member for ' + email);
  }
  if (alreadyHasPlan(member, planId)) return { attached: true, already: true, memberId: member.id };
  await memberstack.members.addFreePlan({ id: member.id, data: { planId: planId } });
  return { attached: true, memberId: member.id };
}

async function findOrCreateCustomer(stripe, secret, { email, name, phone }) {
  const listed = await stripe(secret, 'GET', '/v1/customers?email=' + encodeURIComponent(email) + '&limit=1');
  if (listed && Array.isArray(listed.data) && listed.data[0] && listed.data[0].id) return listed.data[0].id;
  const created = await stripe(secret, 'POST', '/v1/customers', toForm({
    email: email,
    name: name,
    phone: phone || undefined,
  }));
  if (!created || !created.id) throw new FwnError(502, PUBLIC_UNAVAILABLE, 'Stripe customer was not created');
  return created.id;
}

async function checkoutHandler(event, deps) {
  const options = deps || {};
  if (!event || event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const env = options.env || process.env;
  const stripe = options.stripeRequest || stripeRequest;

  try {
    if (!env.STRIPE_SECRET_KEY) throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Missing STRIPE_SECRET_KEY');

    let body;
    try { body = JSON.parse(event.body || ''); }
    catch (err) { throw new FwnError(400, 'Invalid request.'); }
    if (!body || typeof body !== 'object') throw new FwnError(400, 'Invalid request.');

    const pkg = PACKAGES[String(body.package || '').trim()];
    if (!pkg) throw new FwnError(400, 'Unknown package.');

    const attribution = attributionFromInput({ src: body.src, soldBy: body.sold_by, ref: body.ref });
    const email = String(body.email || '').trim();
    if (!isEmail(email)) throw new FwnError(400, 'Enter a valid email address.');
    const name = normalizeName(body.name);
    const phone = normalizePhone(body.phone);
    const memberId = normalizeMemberId(body.memberId);

    const oneTimePriceId = requirePriceId(env, pkg.oneTimeEnv);
    const monthlyPriceId = requirePriceId(env, MONTHLY_ENV);
    const oneTime = await stripe(env.STRIPE_SECRET_KEY, 'GET', '/v1/prices/' + oneTimePriceId);
    const monthly = await stripe(env.STRIPE_SECRET_KEY, 'GET', '/v1/prices/' + monthlyPriceId);
    const priceCheck = validatePrices({ oneTime: oneTime, monthly: monthly, dueTodayCents: pkg.dueTodayCents });
    if (!priceCheck.ok) {
      throw new FwnError(500, PUBLIC_UNAVAILABLE, priceCheck.problems.join('; '));
    }

    const customerId = await findOrCreateCustomer(stripe, env.STRIPE_SECRET_KEY, { email: email, name: name, phone: phone });
    const origin = options.origin || originFromEvent(event);
    const successUrl = origin + '/fwn/thank-you?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl = origin + safeCancelPath(body.cancelPath, pkg.slug);
    const params = buildSessionParams({
      oneTimePriceId: oneTimePriceId,
      monthlyPriceId: monthlyPriceId,
      customerId: customerId,
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      memberId: memberId,
      name: name,
      email: email,
      phone: phone,
      lead_source: attribution.lead_source,
      sold_by: attribution.sold_by,
      rep: attribution.rep,
      packageSlug: pkg.slug,
    });
    if (containsTrialKey(params)) {
      throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Refusing to start a trial');
    }
    const session = await stripe(env.STRIPE_SECRET_KEY, 'POST', '/v1/checkout/sessions', toForm(params));
    if (!session || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
      throw new FwnError(502, PUBLIC_UNAVAILABLE, 'Stripe did not return a Checkout URL');
    }
    return json(200, { url: session.url });
  } catch (err) {
    const status = err.statusCode || 500;
    const publicMessage = err.publicMessage || 'Something went wrong. Please try again.';
    console.error('FWN checkout:', err.message || err);
    return json(status, { error: publicMessage });
  }
}

async function webhookHandler(event, deps) {
  const options = deps || {};
  if (!event || event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const env = options.env || process.env;
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return json(500, { error: 'Server configuration error' });
  }

  const raw = rawBody(event);
  const headers = event.headers || {};
  const signature = headers['stripe-signature'] || headers['Stripe-Signature'] || '';
  if (!verifyStripeSignature(raw, signature, secret, 300, options.nowSec)) {
    return json(400, { error: 'Invalid signature' });
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(raw); }
  catch (err) { return json(400, { error: 'Invalid JSON body' }); }

  const outcome = classifyStripeEvent(stripeEvent);
  if (!outcome.process) return json(200, { received: true, ignored: true, reason: outcome.reason });

  const session = stripeEvent.data.object;
  const buyer = buyerFromSession(session);
  if (!buyer.email) {
    console.error('FWN webhook missing email', session && session.id);
    return json(200, { received: true, skipped: true, reason: 'no email' });
  }

  const send = options.postJson || postJson;
  let ghl;
  try {
    ghl = await send(FWN_GHL_HOOK, ghlPayload(buyer, session.id));
  } catch (err) {
    console.error('FWN GHL hook error:', err.message || err);
    return json(500, { error: 'GHL hook failed' });
  }
  if (!ghl || ghl.statusCode < 200 || ghl.statusCode >= 300) {
    console.error('FWN GHL hook failed:', ghl && ghl.statusCode);
    return json(500, { error: 'GHL hook failed' });
  }

  const pkg = PACKAGES[buyer.package];
  const planId = env[pkg.planEnv];
  if (!isRealPlanId(planId)) {
    console.error('FWN Memberstack plan is not configured (' + pkg.planEnv + '). Create the free plan and set the env var. Session ' + session.id + ' was paid and sent to GHL, but the plan was not attached.');
    return json(200, { received: true, ghl: true, plan: 'not_configured' });
  }
  if (!env.MEMBERSTACK_SECRET_KEY && !options.memberstack) {
    console.error('Missing MEMBERSTACK_SECRET_KEY');
    return json(500, { error: 'Memberstack is not configured' });
  }

  try {
    const memberstack = options.memberstack || memberstackClient(env.MEMBERSTACK_SECRET_KEY);
    const attached = await attachFwnPlan({
      memberstack: memberstack,
      email: buyer.email,
      memberId: buyer.memberstack_id,
      planId: planId,
    });
    return json(200, { received: true, ghl: true, plan: attached });
  } catch (err) {
    console.error('FWN plan attach failed:', err.message || err);
    return json(500, { error: 'Plan attach failed' });
  }
}

module.exports = {
  FWN_GHL_HOOK,
  MONTHLY_CENTS,
  MONTHLY_ENV,
  PACKAGES,
  SUBMIT_MESSAGE,
  FwnError,
  toForm,
  attributionFromInput,
  validatePrices,
  buildSessionParams,
  containsTrialKey,
  verifyStripeSignature,
  classifyStripeEvent,
  buyerFromSession,
  ghlPayload,
  isRealPlanId,
  alreadyHasPlan,
  attachFwnPlan,
  safeCancelPath,
  checkoutHandler,
  webhookHandler,
};
