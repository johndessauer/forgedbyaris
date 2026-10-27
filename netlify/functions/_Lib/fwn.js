// FWN webinar checkout.
//
// Each package is one Memberstack price: a $97/month subscription with a
// setup fee already enabled (Launch $2,400, Accelerator $4,900, 997 $900,
// 1797 $1,700). Memberstack checkout charges that setup fee plus the first
// $97 month, so the first charge is the full tier price. This code must not
// add another one-time price or a second $97 line. That would charge the
// buyer twice.
//
// Checkout is Memberstack purchasePlansWithCheckout for that single price
// id, the same call the other FORGE signup pages use. The browser asks this
// module for the price id. Env vars override the defaults, which are the
// live plans and prices:
//
//   MEMBERSTACK_PLAN_FWN_LAUNCH=pln_forge-launch-fwn--md00xzj
//   MEMBERSTACK_PRICE_FWN_LAUNCH=prc_forge-launch-fwn-2-497-97-ip10xow
//   MEMBERSTACK_PLAN_FWN_ACCELERATOR=pln_forge-accelerator-fwn--dz20xmt
//   MEMBERSTACK_PRICE_FWN_ACCELERATOR=prc_forge-accelerator-fwn-4-997-97-dh50xnp
//   MEMBERSTACK_PLAN_FWN_997=pln_forge-fwn-997-9x30xu2
//   MEMBERSTACK_PRICE_FWN_997=prc_forge-fwn-997-97-zm60xmi
//   MEMBERSTACK_PLAN_FWN_1797=pln_forge-fwn-1-797-es40xk6
//   MEMBERSTACK_PRICE_FWN_1797=prc_forge-fwn-1-797-97-qg70x6i
//
// There is no free trial and no free months. The subscription starts at
// signup. No Stripe product or price is created here.
//
// After Memberstack attaches the plan (member.plan.added), the Memberstack
// webhook POSTs the buyer to the FWN GoHighLevel hook. Attribution is saved
// on the member before checkout and sent as metadataForCheckout:
//   lead_source  fwn-virtual | fwn-raleigh   (?src=)
//   sold_by      cart | john | rep           (?sold_by=, or rep when ?ref= is set)
//   rep          ?ref= via assets/js/ref-capture.js
//   ref          the same ?ref= value, also written to Stripe as metadata.ref
//
// These plan ids are on the gated member allowlists, with the same access
// as Founding Member: the member tools and Empire. Existing plans stay.
//
// Optional STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET let the Stripe
// webhook copy session metadata onto the subscription. That update has no
// line items and does not charge the customer. Do not replace the webhook
// Memberstack already uses.
//
// FORGE webinar sessions are not FWN packages. The same webhook copies
// their attribution when metadata.package is webinar-997 or webinar-1797
// and lead_source is present and is not fwn-virtual or fwn-raleigh. FWN
// src validation is unchanged. Webinar checkout is _Lib/webinar.js.

const https = require('https');
const crypto = require('crypto');
const { sanitize } = require('../../../assets/js/ref-capture');
const { json, preflight } = require('./http');

const FWN_GHL_HOOK = 'https://services.leadconnectorhq.com/hooks/3dQD2B6ZsBjZVIrWF8WR/webhook-trigger/50f73ea5-6f8b-49bd-8ba2-458aae6e7d9f';
const MONTHLY_CENTS = 9700;
const STRIPE_API_VERSION = '2024-06-20';
const LEAD_SOURCES = new Set(['fwn-virtual', 'fwn-raleigh']);
const SOLD_BY = new Set(['cart', 'john', 'rep']);

const PACKAGES = Object.freeze({
  launch: {
    slug: 'launch',
    label: 'Launch',
    dueTodayCents: 249700,
    dueTodayLabel: '$2,497',
    setupFeeCents: 240000,
    path: '/fwn/launch',
    planEnv: 'MEMBERSTACK_PLAN_FWN_LAUNCH',
    priceEnv: 'MEMBERSTACK_PRICE_FWN_LAUNCH',
    defaultPlanId: 'pln_forge-launch-fwn--md00xzj',
    defaultPriceId: 'prc_forge-launch-fwn-2-497-97-ip10xow',
  },
  accelerator: {
    slug: 'accelerator',
    label: 'Accelerator',
    dueTodayCents: 499700,
    dueTodayLabel: '$4,997',
    setupFeeCents: 490000,
    path: '/fwn/accelerator',
    planEnv: 'MEMBERSTACK_PLAN_FWN_ACCELERATOR',
    priceEnv: 'MEMBERSTACK_PRICE_FWN_ACCELERATOR',
    defaultPlanId: 'pln_forge-accelerator-fwn--dz20xmt',
    defaultPriceId: 'prc_forge-accelerator-fwn-4-997-97-dh50xnp',
  },
  '997': {
    slug: '997',
    label: '997',
    dueTodayCents: 99700,
    dueTodayLabel: '$997',
    setupFeeCents: 90000,
    path: '/fwn/997',
    planEnv: 'MEMBERSTACK_PLAN_FWN_997',
    priceEnv: 'MEMBERSTACK_PRICE_FWN_997',
    defaultPlanId: 'pln_forge-fwn-997-9x30xu2',
    defaultPriceId: 'prc_forge-fwn-997-97-zm60xmi',
  },
  '1797': {
    slug: '1797',
    label: '1797',
    dueTodayCents: 179700,
    dueTodayLabel: '$1,797',
    setupFeeCents: 170000,
    path: '/fwn/1797',
    planEnv: 'MEMBERSTACK_PLAN_FWN_1797',
    priceEnv: 'MEMBERSTACK_PRICE_FWN_1797',
    defaultPlanId: 'pln_forge-fwn-1-797-es40xk6',
    defaultPriceId: 'prc_forge-fwn-1-797-97-qg70x6i',
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

function isMemberstackPriceId(id) {
  return typeof id === 'string' && /^prc_[A-Za-z0-9_-]+$/.test(id);
}

function isRealPlanId(id) {
  return typeof id === 'string' && /^pln_[A-Za-z0-9_-]+$/.test(id) && !/placeholder/i.test(id);
}

function configuredId(env, key, fallback) {
  const raw = env && env[key];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return fallback;
}

function resolvePriceId(pkg, env) {
  const id = configuredId(env, pkg.priceEnv, pkg.defaultPriceId);
  if (!isMemberstackPriceId(id)) {
    throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Missing or invalid ' + pkg.priceEnv);
  }
  return id;
}

function resolvePlanId(pkg, env) {
  const id = configuredId(env, pkg.planEnv, pkg.defaultPlanId);
  if (!isRealPlanId(id)) {
    throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Missing or invalid ' + pkg.planEnv);
  }
  return id;
}

function packageForPlanId(planId, env) {
  const id = String(planId || '').trim();
  if (!id) return null;
  return Object.values(PACKAGES).find((pkg) => {
    const configured = configuredId(env, pkg.planEnv, pkg.defaultPlanId);
    return isRealPlanId(configured) && configured === id;
  }) || null;
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

function buildMemberstackCheckout({
  priceId, successURL, cancelURL,
  memberId, name, email, phone, lead_source, sold_by, rep, packageSlug,
}) {
  return {
    priceId: priceId,
    successURL: successURL,
    cancelURL: cancelURL,
    autoRedirect: false,
    metadataForCheckout: checkoutMetadata({
      lead_source: lead_source,
      sold_by: sold_by,
      rep: rep || '',
      package: packageSlug,
      name: clip(name, 120),
      email: clip(email, 200),
      phone: clip(phone, 40),
      memberstack_id: memberId || '',
    }),
  };
}

function checkoutMetadata(fields) {
  const metadata = {};
  Object.keys(fields).forEach((key) => {
    metadata[key] = String(fields[key] == null ? '' : fields[key]);
  });
  const ref = sanitize(metadata.ref || metadata.rep);
  if (ref) metadata.ref = ref;
  else delete metadata.ref;
  return metadata;
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
  };
  if (buyer.phone) body.phone = buyer.phone;
  if (sessionId) body.stripe_checkout_session_id = sessionId;
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

function customFieldValue(customFields, key) {
  if (!customFields) return '';
  if (Array.isArray(customFields)) {
    const hit = customFields.find((field) => field && (field.key === key || field.id === key || field.name === key));
    return hit ? String(hit.value || hit.field_value || '').trim() : '';
  }
  return String(customFields[key] || '').trim();
}

function buyerFromMember({ planId, email, customFields, metaData, json, env }) {
  const pkg = packageForPlanId(planId, env || {});
  if (!pkg) return null;
  const stored = (json && json.fwn && typeof json.fwn === 'object') ? json.fwn : {};
  const meta = metaData || {};
  const first = customFieldValue(customFields, 'first-name') || meta['first-name'] || meta.firstName || '';
  const last = customFieldValue(customFields, 'last-name') || meta['last-name'] || meta.lastName || '';
  const fallbackName = [first, last].filter(Boolean).join(' ').trim();
  const fallbackRep = customFieldValue(customFields, 'referral-source') || meta['referral-source'] || '';
  return {
    name: String(stored.name || fallbackName).trim(),
    email: String(email || stored.email || '').trim(),
    phone: String(stored.phone || '').trim(),
    package: pkg.slug,
    lead_source: String(stored.lead_source || '').trim(),
    sold_by: String(stored.sold_by || '').trim(),
    rep: String(stored.rep || fallbackRep).trim(),
  };
}

async function notifyFwnPlanAdded({ planId, email, customFields, metaData, json, env, postJson: send }) {
  const buyer = buyerFromMember({ planId, email, customFields, metaData, json, env });
  if (!buyer) return { posted: false };
  if (!buyer.email) throw new FwnError(500, 'FWN hook failed', 'missing email');
  const payload = ghlPayload(buyer, '');
  const ghl = await (send || postJson)(FWN_GHL_HOOK, payload);
  if (!ghl || ghl.statusCode < 200 || ghl.statusCode >= 300) {
    throw new FwnError(502, 'FWN hook failed', 'GHL HTTP ' + (ghl && ghl.statusCode));
  }
  return { posted: true, package: buyer.package };
}

function assertSingleMemberstackPrice(checkout) {
  if (!checkout || !isMemberstackPriceId(checkout.priceId)) {
    throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Checkout is not a single Memberstack price');
  }
  const serialized = JSON.stringify(checkout);
  if (checkout.line_items || checkout.lineItems || /"price_/.test(serialized) || serialized.includes('line_items') || serialized.includes('one_time')) {
    throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Refusing an extra one-time price');
  }
}

async function checkoutHandler(event, deps) {
  const options = deps || {};
  if (!event || event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const env = options.env || process.env;

  try {
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

    const priceId = resolvePriceId(pkg, env);
    const planId = resolvePlanId(pkg, env);
    const origin = options.origin || originFromEvent(event);
    const checkout = buildMemberstackCheckout({
      priceId: priceId,
      successURL: origin + '/fwn/thank-you',
      cancelURL: origin + safeCancelPath(body.cancelPath, pkg.slug),
      memberId: memberId,
      name: name,
      email: email,
      phone: phone,
      lead_source: attribution.lead_source,
      sold_by: attribution.sold_by,
      rep: attribution.rep,
      packageSlug: pkg.slug,
    });
    if (containsTrialKey(checkout)) {
      throw new FwnError(500, PUBLIC_UNAVAILABLE, 'Refusing to start a trial');
    }
    assertSingleMemberstackPrice(checkout);
    return json(200, {
      priceId: priceId,
      planId: planId,
      package: pkg.slug,
      lead_source: attribution.lead_source,
      sold_by: attribution.sold_by,
      rep: attribution.rep,
      checkout: checkout,
    });
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

  const paid = paidCheckoutSession(stripeEvent);
  if (!paid.session) return json(200, { received: true, ignored: true, reason: paid.reason });

  const outcome = classifyStripeEvent(stripeEvent);
  // Webinar sessions are distinguished by metadata.package, not by adding
  // them to PACKAGES. A failure here must not change the FWN result.
  let webinar = false;
  if (!outcome.process) {
    try {
      webinar = require('./webinar').isWebinarAttributionSession(paid.session);
    } catch (err) {
      console.error('Webinar session check failed:', err.message || err);
      webinar = false;
    }
  }
  const ref = sanitize((paid.session.metadata && (paid.session.metadata.ref || paid.session.metadata.rep)) || '');
  if (!outcome.process && !webinar && !ref) {
    return json(200, { received: true, ignored: true, reason: outcome.reason || 'no_ref' });
  }

  const copied = await copyCheckoutMetadata(paid.session, env, options.stripeRequest || stripeRequest, {
    fwn: outcome.process || webinar,
    ref: ref,
  });
  return json(200, { received: true, charged: false, metadata: copied.copied ? 'copied' : copied.reason, ref: !!ref });
}

function paidCheckoutSession(stripeEvent) {
  const type = stripeEvent && stripeEvent.type;
  const session = stripeEvent && stripeEvent.data && stripeEvent.data.object;
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
    return { session: null, reason: 'event' };
  }
  if (type === 'checkout.session.completed' && (!session || session.payment_status !== 'paid')) {
    return { session: null, reason: 'unpaid' };
  }
  if (!session) return { session: null, reason: 'event' };
  return { session: session, reason: '' };
}

function subscriptionIdFromSession(session) {
  const sub = session && session.subscription;
  if (typeof sub === 'string') return sub;
  if (sub && typeof sub.id === 'string') return sub.id;
  return '';
}

function stripeId(value, prefix) {
  if (typeof value === 'string' && value.startsWith(prefix)) return value;
  if (value && typeof value.id === 'string' && value.id.startsWith(prefix)) return value.id;
  return '';
}

function metadataForm(metadata) {
  const form = toForm({ metadata: metadata });
  if (form.includes('line_items') || /(^|&)price=/.test(form)) {
    throw new FwnError(500, 'Refusing an extra price', 'metadata update included a price');
  }
  return form;
}

async function postMetadata(stripe, secret, path, metadata) {
  const keys = Object.keys(metadata || {}).filter((key) => metadata[key] !== '' && metadata[key] != null);
  if (!keys.length) return false;
  const body = {};
  keys.forEach((key) => { body[key] = String(metadata[key]); });
  await stripe(secret, 'POST', path, metadataForm(body));
  return true;
}

async function copyCheckoutMetadata(session, env, stripe, opts) {
  const options = opts || {};
  if (!env.STRIPE_SECRET_KEY) return { copied: false, reason: 'no_stripe_key' };
  const ref = sanitize(options.ref || '');
  const md = (session && session.metadata) || {};
  let copied = false;
  let failed = false;

  async function write(path, metadata) {
    try {
      const did = await postMetadata(stripe, env.STRIPE_SECRET_KEY, path, metadata);
      if (did) copied = true;
    } catch (err) {
      failed = true;
      console.error('Checkout metadata copy failed:', path, err.message || err);
    }
  }

  const subId = subscriptionIdFromSession(session);
  if (subId) {
    const subscriptionMetadata = {};
    if (options.fwn) {
      subscriptionMetadata.lead_source = String(md.lead_source || '');
      subscriptionMetadata.sold_by = String(md.sold_by || '');
      subscriptionMetadata.rep = String(md.rep || '');
      subscriptionMetadata.package = String(md.package || '');
    }
    if (ref) subscriptionMetadata.ref = ref;
    await write('/v1/subscriptions/' + encodeURIComponent(subId), subscriptionMetadata);
  }

  if (ref) {
    const customerId = stripeId(session && session.customer, 'cus_');
    if (customerId) await write('/v1/customers/' + encodeURIComponent(customerId), { ref: ref });

    const paymentIntent = session && session.payment_intent;
    const paymentIntentId = stripeId(paymentIntent, 'pi_');
    let chargeId = stripeId(paymentIntent && paymentIntent.latest_charge, 'ch_') || stripeId(session && session.latest_charge, 'ch_');
    if (paymentIntentId && !chargeId) {
      try {
        const pi = await stripe(env.STRIPE_SECRET_KEY, 'GET', '/v1/payment_intents/' + encodeURIComponent(paymentIntentId));
        chargeId = stripeId(pi && pi.latest_charge, 'ch_');
        if (!chargeId && pi && pi.charges && Array.isArray(pi.charges.data) && pi.charges.data[0]) {
          chargeId = stripeId(pi.charges.data[0].id || pi.charges.data[0], 'ch_');
        }
      } catch (err) {
        failed = true;
        console.error('Checkout payment lookup failed:', err.message || err);
      }
    }
    if (paymentIntentId) await write('/v1/payment_intents/' + encodeURIComponent(paymentIntentId), { ref: ref });
    if (chargeId) await write('/v1/charges/' + encodeURIComponent(chargeId), { ref: ref });
  }

  if (copied) return { copied: true };
  return { copied: false, reason: failed ? 'update_failed' : 'nothing_to_copy' };
}

module.exports = {
  FWN_GHL_HOOK,
  MONTHLY_CENTS,
  PACKAGES,
  FwnError,
  toForm,
  attributionFromInput,
  configuredId,
  resolvePriceId,
  resolvePlanId,
  packageForPlanId,
  isMemberstackPriceId,
  buildMemberstackCheckout,
  containsTrialKey,
  verifyStripeSignature,
  classifyStripeEvent,
  buyerFromSession,
  ghlPayload,
  isRealPlanId,
  notifyFwnPlanAdded,
  safeCancelPath,
  checkoutHandler,
  webhookHandler,
};
