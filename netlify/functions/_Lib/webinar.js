// FORGE webinar checkout. Not FWN.
//
// Two packages only. Each is one Memberstack price: a $97/month subscription
// with the setup fee already enabled (997 setup $900, 1797 setup $1,700).
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
//
// Attribution is saved on the member before checkout and sent as
// metadataForCheckout, the same fields FWN uses:
//   lead_source  sanitized ?src=   (required; fwn-virtual and fwn-raleigh rejected)
//   sold_by      cart | john | rep (?sold_by=, or rep when ?ref= is set)
//   rep          ?ref= via assets/js/ref-capture.js
//   ref          the same ?ref= value, also written to Stripe as metadata.ref
//   package      webinar-997 | webinar-1797
//
// metadata.package is prefixed so the existing Stripe webhook can tell a
// webinar session from an FWN session without relaxing FWN src rules.
// FWN packages stay on /fwn/ and still require src=fwn-virtual|fwn-raleigh.

const { sanitize } = require('../../../assets/js/ref-capture');
const { json, preflight } = require('./http');

const MONTHLY_CENTS = 9700;
const FWN_LEAD_SOURCES = new Set(['fwn-virtual', 'fwn-raleigh']);
const SOLD_BY = new Set(['cart', 'john', 'rep']);
const METADATA_PACKAGES = new Set(['webinar-997', 'webinar-1797']);

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

    const priceId = resolvePriceId(pkg, env);
    const planId = resolvePlanId(pkg, env);
    const origin = options.origin || originFromEvent(event);
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
    return json(200, {
      priceId: priceId,
      planId: planId,
      package: pkg.metadataPackage,
      lead_source: attribution.lead_source,
      sold_by: attribution.sold_by,
      rep: attribution.rep,
      checkout: checkout,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    const publicMessage = err.publicMessage || 'Something went wrong. Please try again.';
    console.error('Webinar checkout:', err.message || err);
    return json(status, { error: publicMessage });
  }
}

module.exports = {
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
