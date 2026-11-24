// FORGE webinar checkout. Not FWN.
//
// Each package is one Memberstack price: a $97/month subscription
// with the setup fee already enabled (997 and 997-foundation setup $900,
// 1797 setup $1,700, 2997-rich setup $2,900).
// Memberstack checkout charges that setup fee plus the first $97 month, so
// the first charge is the full tier price. This code must not add another
// one-time price or a second $97 line. That would charge the buyer twice.
// There is no Launch package and no Accelerator package.
//
// There is no free trial and no free months. The subscription starts at
// signup. No Stripe product or price is created here.
//
// Env vars override the defaults, which are the live plans and prices:
//
//   MEMBERSTACK_PLAN_WEBINAR_997=pln_forge-webinar-997-lw00b81
//   MEMBERSTACK_PRICE_WEBINAR_997=prc_forge-webinar-997-97-ui20bdr
//   MEMBERSTACK_PLAN_WEBINAR_1797=pln_forge-webinar-1-797-uf10b07
//   MEMBERSTACK_PRICE_WEBINAR_1797=prc_forge-webinar-1-797-97-s830bts
//   MEMBERSTACK_PLAN_WEBINAR_997_FOUNDATION=pln_forge-webinar-997-foundation-ry00fq6
//   MEMBERSTACK_PRICE_WEBINAR_997_FOUNDATION=prc_forge-webinar-997-foundation-97-i910fkd
//   MEMBERSTACK_PLAN_WEBINAR_2997_RICH=pln_forge-webinar-2-997-empire-rich-groves-k90037e
//   MEMBERSTACK_PRICE_WEBINAR_2997_RICH=prc_forge-webinar-2-997-97-rich-groves-7p103lj
//
// 997-foundation is Foundation access only (no Empire). 997, 1797, and
// 2997-rich include Empire. 2997-rich is the Rich Groves reseller checkout
// ($2,997 today, then $97/month). Stripe price price_1UddbfK4zh6RSWCrfTkor4cA
// is the live price behind the Memberstack price; this code still charges
// only the Memberstack price id.
//
// Attribution is saved on the member before checkout and sent as
// metadataForCheckout, the same fields FWN uses:
//   lead_source  sanitized ?src=   (required; fwn-virtual and fwn-raleigh rejected)
//   sold_by      cart | john | rep (?sold_by=, or rep when ?ref= is set)
//   rep          ?ref= via assets/js/ref-capture.js
//   ref          the same ?ref= value, also written to Stripe as metadata.ref
//   package      webinar-997 | webinar-1797 | webinar-997-foundation | webinar-2997-rich
//
// metadata.package is prefixed so the existing Stripe webhook can tell a
// webinar session from an FWN session without relaxing FWN src rules.
// FWN packages stay on /fwn/ and still require src=fwn-virtual|fwn-raleigh.

const { sanitize } = require('../../../assets/js/ref-capture');
const { json, preflight } = require('./http');

const MONTHLY_CENTS = 9700;
const FWN_LEAD_SOURCES = new Set(['fwn-virtual', 'fwn-raleigh']);
const SOLD_BY = new Set(['cart', 'john', 'rep']);
const METADATA_PACKAGES = new Set(['webinar-997', 'webinar-1797', 'webinar-997-foundation', 'webinar-2997-rich', 'webinar-997-3pay']);

// Flip this one constant to 'at_signup' if the $97 month should be charged
// inside each of the first three payments ($397, then $97). Default keeps
// the $97 start until the month after the third installment.
const THREE_PAY_MONTHLY_START = 'after_third';

const PACKAGES = Object.freeze({
  '997': {
    slug: '997',
    metadataPackage: 'webinar-997',
    label: '997',
    dueTodayCents: 99700,
    dueTodayLabel: '$997',
    setupFeeCents: 90000,
    path: '/webinar/997',
    planEnv: 'MEMBERSTACK_PLAN_WEBINAR_997',
    priceEnv: 'MEMBERSTACK_PRICE_WEBINAR_997',
    defaultPlanId: 'pln_forge-webinar-997-lw00b81',
    defaultPriceId: 'prc_forge-webinar-997-97-ui20bdr',
  },
  '1797': {
    slug: '1797',
    metadataPackage: 'webinar-1797',
    label: '1797',
    dueTodayCents: 179700,
    dueTodayLabel: '$1,797',
    setupFeeCents: 170000,
    path: '/webinar/1797',
    planEnv: 'MEMBERSTACK_PLAN_WEBINAR_1797',
    priceEnv: 'MEMBERSTACK_PRICE_WEBINAR_1797',
    defaultPlanId: 'pln_forge-webinar-1-797-uf10b07',
    defaultPriceId: 'prc_forge-webinar-1-797-97-s830bts',
  },
  // Foundation only (no Empire). Same $900 setup + $97/month, no trial, as
  // the 997 package, on its own Memberstack plan so the site gates it as
  // Foundation. The existing 997 package (Empire included) is unchanged.
  '997-foundation': {
    slug: '997-foundation',
    metadataPackage: 'webinar-997-foundation',
    label: '997 Foundation',
    dueTodayCents: 99700,
    dueTodayLabel: '$997',
    setupFeeCents: 90000,
    path: '/webinar/997-foundation',
    planEnv: 'MEMBERSTACK_PLAN_WEBINAR_997_FOUNDATION',
    priceEnv: 'MEMBERSTACK_PRICE_WEBINAR_997_FOUNDATION',
    defaultPlanId: 'pln_forge-webinar-997-foundation-ry00fq6',
    defaultPriceId: 'prc_forge-webinar-997-foundation-97-i910fkd',
  },
  // Same Empire access as 1797. $2,900 setup + first $97 month = $2,997 today,
  // then $97/month. Reseller checkout for Rich Groves.
  '2997-rich': {
    slug: '2997-rich',
    metadataPackage: 'webinar-2997-rich',
    label: '2997-rich',
    dueTodayCents: 299700,
    dueTodayLabel: '$2,997',
    setupFeeCents: 290000,
    path: '/webinar/2997-rich',
    planEnv: 'MEMBERSTACK_PLAN_WEBINAR_2997_RICH',
    priceEnv: 'MEMBERSTACK_PRICE_WEBINAR_2997_RICH',
    defaultPlanId: 'pln_forge-webinar-2-997-empire-rich-groves-k90037e',
    defaultPriceId: 'prc_forge-webinar-2-997-97-rich-groves-7p103lj',
  },
  // Same Empire plan as 997. The Memberstack price is only the first
  // installment. The Stripe webhook turns that subscription into a schedule
  // so the installments stop after 3 and $97/month follows.
  '997-3pay': {
    slug: '997-3pay',
    metadataPackage: 'webinar-997-3pay',
    label: '997-3pay',
    dueTodayCents: 33233,
    dueTodayLabel: '$332.33',
    setupFeeCents: 0,
    path: '/webinar/997-3pay',
    planEnv: 'MEMBERSTACK_PLAN_WEBINAR_997_3PAY',
    priceEnv: 'MEMBERSTACK_PRICE_WEBINAR_997_3PAY',
    defaultPlanId: 'pln_forge-webinar-997-lw00b81',
    defaultPriceId: '',
    threePay: true,
  },
});

const PUBLIC_UNAVAILABLE = 'This checkout is not available right now. Please contact support@forgedbyaris.com.';
const SRC_REQUIRED = 'This checkout link needs a source. Open it with src set.';
const FWN_SRC_REJECTED = 'This page is not an FWN checkout. FWN enrollments use the FWN link.';

class WebinarError extends Error {
  constructor(statusCode, publicMessage, detail) {
    super(detail || publicMessage);
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) {
    throw new WebinarError(400, 'Enter your first and last name.');
  }
  return name;
}

function normalizePhone(value) {
  if (value == null || String(value).trim() === '') return '';
  const cleaned = String(value).trim().replace(/[^\d+().\-\s]/g, '').slice(0, 40);
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw new WebinarError(400, 'Enter a valid phone number, or leave phone blank.');
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
  const leadSource = sanitize(src);
  if (!leadSource) throw new WebinarError(400, SRC_REQUIRED);
  if (FWN_LEAD_SOURCES.has(leadSource)) throw new WebinarError(400, FWN_SRC_REJECTED);
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
    throw new WebinarError(500, PUBLIC_UNAVAILABLE, 'Missing or invalid ' + pkg.priceEnv);
  }
  return id;
}

function resolvePlanId(pkg, env) {
  const id = configuredId(env, pkg.planEnv, pkg.defaultPlanId);
  if (!isRealPlanId(id)) {
    throw new WebinarError(500, PUBLIC_UNAVAILABLE, 'Missing or invalid ' + pkg.planEnv);
  }
  return id;
}

function safeCancelPath(input, packageSlug) {
  const fallback = (PACKAGES[packageSlug] && PACKAGES[packageSlug].path) || '/webinar/997';
  if (typeof input !== 'string') return fallback;
  if (!input.startsWith('/webinar/')) return fallback;
  if (input.startsWith('//') || input.includes('://') || input.includes('\\')) return fallback;
  if (input.length > 500) return fallback;
  return input;
}

function originFromEvent(event) {
  const headers = event.headers || {};
  const host = headers['x-forwarded-host'] || headers.host || headers.Host;
  const proto = (headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https').split(',')[0].trim();
  if (!host || /[\s/]/.test(host) || !/^https?$/.test(proto)) {
    throw new WebinarError(500, PUBLIC_UNAVAILABLE, 'bad host header');
  }
  return proto + '://' + host;
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

function threePayMode(env) {
  const raw = String(env && env.WEBINAR_997_3PAY_MONTHLY_START || '').trim();
  if (raw === 'at_signup' || raw === 'after_third') return raw;
  return THREE_PAY_MONTHLY_START;
}

function threePayOffer(mode) {
  const selected = mode === 'at_signup' ? 'at_signup' : 'after_third';
  if (selected === 'at_signup') {
    return {
      mode: 'at_signup',
      dueTodayCents: 39700,
      installments: [
        { number: 1, cents: 39700, when: 'signup day' },
        { number: 2, cents: 39700, when: '1 month after signup' },
        { number: 3, cents: 39700, when: '2 months after signup' },
      ],
      monthlyCents: MONTHLY_CENTS,
      monthlyStarts: 'with the first payment',
      monthlyWhen: 'signup day, and again 1 month and 2 months after signup, then every month',
    };
  }
  return {
    mode: 'after_third',
    dueTodayCents: 33233,
    installments: [
      { number: 1, cents: 33233, when: 'signup day' },
      { number: 2, cents: 33233, when: '1 month after signup' },
      { number: 3, cents: 33234, when: '2 months after signup' },
    ],
    monthlyCents: MONTHLY_CENTS,
    monthlyStarts: 'the month after the third payment',
    monthlyWhen: '3 months after signup, then every month',
  };
}

function isStripePriceId(id) {
  return typeof id === 'string' && /^price_[A-Za-z0-9]+$/.test(id);
}

function threePayPriceIds(env, mode) {
  const monthly = configuredId(env, 'STRIPE_PRICE_WEBINAR_997_MONTHLY', '');
  const last = configuredId(env, 'STRIPE_PRICE_WEBINAR_997_3PAY_LAST', '');
  if (!isStripePriceId(monthly)) return null;
  if (mode !== 'at_signup' && !isStripePriceId(last)) return null;
  return { monthly: monthly, last: last };
}

function threePaySchedulePhases(input) {
  const offer = threePayOffer(input.mode);
  const current = input.currentPriceId;
  const prices = offer.installments.map(function (row, index) {
    if (offer.mode === 'after_third' && index === 2) return input.lastInstallmentPriceId;
    return current;
  });
  const shared = {
    lead_source: String(input.lead_source || ''),
    sold_by: String(input.sold_by || ''),
    rep: String(input.rep || ''),
    ref: String(input.ref || ''),
    package: 'webinar-997-3pay',
  };
  const phases = prices.map(function (price, index) {
    return {
      items: [{ price: price, quantity: 1 }],
      iterations: 1,
      proration_behavior: 'none',
      metadata: Object.assign({}, shared, {
        installment_number: String(index + 1),
        installment_of: '3',
      }),
    };
  });
  phases.push({
    items: [{ price: input.monthlyPriceId, quantity: 1 }],
    proration_behavior: 'none',
    metadata: shared,
  });
  return phases;
}

function encodeSchedulePhases(phases, startDate) {
  const body = {};
  phases.forEach(function (phase, index) {
    const prefix = 'phases[' + index + ']';
    if (index === 0) body[prefix + '[start_date]'] = String(startDate);
    body[prefix + '[items][0][price]'] = phase.items[0].price;
    body[prefix + '[items][0][quantity]'] = '1';
    body[prefix + '[proration_behavior]'] = 'none';
    if (phase.iterations) body[prefix + '[iterations]'] = String(phase.iterations);
    Object.keys(phase.metadata || {}).forEach(function (key) {
      if (phase.metadata[key]) body[prefix + '[metadata][' + key + ']'] = String(phase.metadata[key]);
    });
  });
  body.end_behavior = 'release';
  return body;
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
    metadataForCheckout: checkoutMetadata(Object.assign({
      lead_source: lead_source,
      sold_by: sold_by,
      rep: rep || '',
      package: packageSlug,
      name: clip(name, 120),
      email: clip(email, 200),
      phone: clip(phone, 40),
      memberstack_id: memberId || '',
    }, packageSlug === 'webinar-997-3pay' ? {
      installment_number: '1',
      installment_of: '3',
    } : {})),
  };
}

function containsTrialKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some((key) => {
    if (key === 'trial_period_days' || key === 'trial_end') return true;
    return containsTrialKey(value[key]);
  });
}

function assertSingleMemberstackPrice(checkout) {
  if (!checkout || !isMemberstackPriceId(checkout.priceId)) {
    throw new WebinarError(500, PUBLIC_UNAVAILABLE, 'Checkout is not a single Memberstack price');
  }
  const serialized = JSON.stringify(checkout);
  if (checkout.line_items || checkout.lineItems || /"price_/.test(serialized) || serialized.includes('line_items') || serialized.includes('one_time')) {
    throw new WebinarError(500, PUBLIC_UNAVAILABLE, 'Refusing an extra one-time price');
  }
}

function isWebinarAttributionSession(session) {
  try {
    if (!session || session.mode !== 'subscription') return false;
    const md = session.metadata || {};
    const packageName = String(md.package || '').trim();
    if (!METADATA_PACKAGES.has(packageName)) return false;
    const leadSource = sanitize(md.lead_source);
    if (!leadSource || FWN_LEAD_SOURCES.has(leadSource)) return false;
    return true;
  } catch (err) {
    return false;
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
    catch (err) { throw new WebinarError(400, 'Invalid request.'); }
    if (!body || typeof body !== 'object') throw new WebinarError(400, 'Invalid request.');

    const pkg = PACKAGES[String(body.package || '').trim()];
    if (!pkg) throw new WebinarError(400, 'Unknown package.');

    const attribution = attributionFromInput({ src: body.src, soldBy: body.sold_by, ref: body.ref });
    const email = String(body.email || '').trim();
    if (!isEmail(email)) throw new WebinarError(400, 'Enter a valid email address.');
    const name = normalizeName(body.name);
    const phone = normalizePhone(body.phone);
    const memberId = normalizeMemberId(body.memberId);

    const mode = pkg.threePay ? threePayMode(env) : '';
    if (pkg.threePay && !threePayPriceIds(env, mode)) {
      throw new WebinarError(503, PUBLIC_UNAVAILABLE, '3-pay Stripe prices are not configured');
    }
    const priceId = resolvePriceId(pkg, env);
    const planId = resolvePlanId(pkg, env);
    const origin = options.origin || originFromEvent(event);
    const offer = pkg.threePay ? threePayOffer(mode) : null;
    const checkout = buildMemberstackCheckout({
      priceId: priceId,
      successURL: origin + '/webinar/thank-you',
      cancelURL: origin + safeCancelPath(body.cancelPath, pkg.slug),
      memberId: memberId,
      name: name,
      email: email,
      phone: phone,
      lead_source: attribution.lead_source,
      sold_by: attribution.sold_by,
      rep: attribution.rep,
      packageSlug: pkg.metadataPackage,
    });
    if (containsTrialKey(checkout)) {
      throw new WebinarError(500, PUBLIC_UNAVAILABLE, 'Refusing to start a trial');
    }
    assertSingleMemberstackPrice(checkout);
    const payload = {
      priceId: priceId,
      planId: planId,
      package: pkg.metadataPackage,
      lead_source: attribution.lead_source,
      sold_by: attribution.sold_by,
      rep: attribution.rep,
      checkout: checkout,
    };
    if (offer) {
      payload.threePay = offer;
      payload.cardOnly = true;
    }
    return json(200, payload);
  } catch (err) {
    const status = err.statusCode || 500;
    const publicMessage = err.publicMessage || 'Something went wrong. Please try again.';
    console.error('Webinar checkout:', err.message || err);
    return json(status, { error: publicMessage });
  }
}

// Event sources that get their own GHL tags when a webinar plan is added.
// The buyer's src is saved on the member JSON (json.webinar.lead_source) by
// assets/js/webinar-checkout.js before checkout. ref is saved as the
// referral-source custom field. Only listed sources are tagged.
// reseller-rich-groves tags that source and, when ref is set, rep-<ref>
// (rep-rich-groves when ref=rich-groves).
const EVENT_TAG_SOURCES = new Set(['rpm-newport-2026', 'weekly-webinar', 'reseller-rich-groves']);

function eventTagsForMember({ memberJson, referralSource }) {
  const stored = (memberJson && memberJson.webinar && typeof memberJson.webinar === 'object') ? memberJson.webinar : {};
  const source = sanitize(stored.lead_source);
  if (!source || !EVENT_TAG_SOURCES.has(source)) return [];
  const tags = [source];
  const rep = sanitize(stored.rep || referralSource);
  if (rep) tags.push('rep-' + rep);
  return tags;
}

function formBody(fields) {
  return Object.keys(fields).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(fields[key]);
  }).join('&');
}

async function applyThreePaySchedule(session, env, stripe) {
  const md = (session && session.metadata) || {};
  if (String(md.package || '') !== 'webinar-997-3pay') return { status: 'skipped' };
  const mode = threePayMode(env);
  const prices = threePayPriceIds(env, mode);
  if (!prices) throw new WebinarError(503, PUBLIC_UNAVAILABLE, '3-pay Stripe prices are not configured');
  const sub = session.subscription;
  const subId = typeof sub === 'string' ? sub : (sub && sub.id) || '';
  if (!subId) throw new WebinarError(500, PUBLIC_UNAVAILABLE, '3-pay checkout has no subscription');
  const created = await stripe(env.STRIPE_SECRET_KEY, 'POST', '/v1/subscription_schedules', formBody({ from_subscription: subId }));
  const current = created && created.phases && created.phases[0];
  const currentPrice = current && current.items && current.items[0] && (current.items[0].price && current.items[0].price.id || current.items[0].price);
  const start = current && current.start_date;
  if (!currentPrice || !start) throw new WebinarError(500, PUBLIC_UNAVAILABLE, '3-pay schedule is missing the current phase');
  const phases = threePaySchedulePhases({
    mode: mode,
    currentPriceId: currentPrice,
    lastInstallmentPriceId: prices.last,
    monthlyPriceId: prices.monthly,
    lead_source: md.lead_source,
    sold_by: md.sold_by,
    rep: md.rep,
    ref: md.ref || md.rep,
  });
  await stripe(env.STRIPE_SECRET_KEY, 'POST', '/v1/subscription_schedules/' + encodeURIComponent(created.id), formBody(encodeSchedulePhases(phases, start)));
  return { status: 'scheduled', mode: mode };
}

module.exports = {
  THREE_PAY_MONTHLY_START,
  threePayMode,
  threePayOffer,
  threePaySchedulePhases,
  encodeSchedulePhases,
  applyThreePaySchedule,
  EVENT_TAG_SOURCES,
  eventTagsForMember,
  MONTHLY_CENTS,
  PACKAGES,
  FWN_LEAD_SOURCES,
  METADATA_PACKAGES,
  WebinarError,
  attributionFromInput,
  configuredId,
  resolvePriceId,
  resolvePlanId,
  isMemberstackPriceId,
  buildMemberstackCheckout,
  containsTrialKey,
  isWebinarAttributionSession,
  safeCancelPath,
  checkoutHandler,
};
