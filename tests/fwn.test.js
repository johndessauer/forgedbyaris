const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fwn = require('../netlify/functions/_Lib/fwn');

const ROOT = path.join(__dirname, '..');
const SECRET = 'whsec_test_secret';
const TS = 1760000000;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function signed(payload, secret, ts) {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret || SECRET).update(ts + '.' + raw).digest('hex');
  return {
    httpMethod: 'POST',
    headers: { 'stripe-signature': 't=' + ts + ',v1=' + sig },
    body: raw,
  };
}

function paidSession(overrides) {
  return Object.assign({
    id: 'cs_test_123',
    mode: 'subscription',
    payment_status: 'paid',
    customer_details: { email: 'Ada@Example.com', name: 'Card Name', phone: '+15551212' },
    metadata: {
      package: 'launch',
      lead_source: 'fwn-virtual',
      sold_by: 'rep',
      rep: '023k-eddie',
      name: 'Ada Investor',
      email: 'Ada@Example.com',
      phone: '555-111-2222',
      memberstack_id: 'mem_wrong',
    },
  }, overrides || {});
}

function envWithPrices() {
  return {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_FWN_MONTHLY: 'price_monthly97',
    STRIPE_PRICE_FWN_LAUNCH: 'price_launch2400',
    STRIPE_PRICE_FWN_ACCELERATOR: 'price_acc4900',
    STRIPE_PRICE_FWN_997: 'price_p997',
    STRIPE_PRICE_FWN_1797: 'price_p1797',
    MEMBERSTACK_PLAN_FWN_LAUNCH: 'pln_fwn_launch_placeholder',
    MEMBERSTACK_SECRET_KEY: 'sk_memberstack',
  };
}

function pricesFor(centsDue) {
  return {
    oneTime: { id: 'price_one', active: true, type: 'one_time', currency: 'usd', unit_amount: centsDue - fwn.MONTHLY_CENTS },
    monthly: { id: 'price_month', active: true, type: 'recurring', currency: 'usd', unit_amount: fwn.MONTHLY_CENTS, recurring: { interval: 'month', interval_count: 1 } },
  };
}

test('package totals: one-time price is the page price minus the included first month', () => {
  assert.equal(fwn.PACKAGES.launch.dueTodayCents - fwn.MONTHLY_CENTS, 240000);
  assert.equal(fwn.PACKAGES.accelerator.dueTodayCents - fwn.MONTHLY_CENTS, 490000);
  assert.equal(fwn.PACKAGES['997'].dueTodayCents - fwn.MONTHLY_CENTS, 90000);
  assert.equal(fwn.PACKAGES['1797'].dueTodayCents - fwn.MONTHLY_CENTS, 170000);
  assert.equal(fwn.MONTHLY_CENTS, 9700);
});

test('validatePrices accepts the foundation-empire shape and rejects a full price plus $97', () => {
  const ok = fwn.validatePrices({ ...pricesFor(249700), dueTodayCents: 249700 });
  assert.equal(ok.ok, true);
  const doubled = fwn.validatePrices({
    oneTime: { active: true, type: 'one_time', currency: 'usd', unit_amount: 249700 },
    monthly: pricesFor(249700).monthly,
    dueTodayCents: 249700,
  });
  assert.equal(doubled.ok, false);
  const trialish = fwn.validatePrices({
    oneTime: pricesFor(249700).oneTime,
    monthly: { active: true, type: 'recurring', currency: 'usd', unit_amount: 0, recurring: { interval: 'month', interval_count: 1 } },
    dueTodayCents: 249700,
  });
  assert.equal(trialish.ok, false);
});

test('attribution: src is required, ref follows ForgeRef sanitize, sold_by defaults', () => {
  assert.throws(() => fwn.attributionFromInput({ src: '', ref: 'lexort' }), /src=fwn-virtual/);
  assert.throws(() => fwn.attributionFromInput({ src: 'virtual' }), /src=fwn-virtual/);
  assert.deepEqual(fwn.attributionFromInput({ src: 'FWN-Raleigh' }), {
    lead_source: 'fwn-raleigh', sold_by: 'cart', rep: '',
  });
  assert.deepEqual(fwn.attributionFromInput({ src: 'fwn-virtual', ref: '023K-Eddie' }), {
    lead_source: 'fwn-virtual', sold_by: 'rep', rep: '023k-eddie',
  });
  assert.deepEqual(fwn.attributionFromInput({ src: 'fwn-virtual', soldBy: 'john', ref: 'Lex<script>' }), {
    lead_source: 'fwn-virtual', sold_by: 'john', rep: 'lexscript',
  });
  assert.deepEqual(fwn.attributionFromInput({ src: 'fwn-virtual', soldBy: 'nope' }), {
    lead_source: 'fwn-virtual', sold_by: 'cart', rep: '',
  });
});

test('checkout session sets metadata and subscription metadata, and does not start a trial', () => {
  const params = fwn.buildSessionParams({
    oneTimePriceId: 'price_launch2400',
    monthlyPriceId: 'price_monthly97',
    customerId: 'cus_123',
    successUrl: 'https://forgedbyaris.com/fwn/thank-you?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://forgedbyaris.com/fwn/launch?src=fwn-virtual',
    memberId: 'mem_123',
    name: 'Ada Investor',
    email: 'ada@example.com',
    phone: '555-111-2222',
    lead_source: 'fwn-virtual',
    sold_by: 'rep',
    rep: '023k-eddie',
    packageSlug: 'launch',
  });
  assert.equal(params.mode, 'subscription');
  assert.equal(params.line_items[0].price, 'price_launch2400');
  assert.equal(params.line_items[1].price, 'price_monthly97');
  assert.equal(params.metadata.lead_source, 'fwn-virtual');
  assert.equal(params.metadata.sold_by, 'rep');
  assert.equal(params.metadata.rep, '023k-eddie');
  assert.deepEqual(params.subscription_data.metadata, {
    lead_source: 'fwn-virtual',
    sold_by: 'rep',
    rep: '023k-eddie',
    package: 'launch',
  });
  assert.equal(fwn.containsTrialKey(params), false);
  assert.equal(params.subscription_data.trial_period_days, undefined);
  const encoded = fwn.toForm(params);
  assert.equal(encoded.includes('trial_period_days'), false);
  assert.equal(encoded.includes('trial_end'), false);
  const form = new URLSearchParams(encoded);
  assert.equal(form.get('metadata[lead_source]'), 'fwn-virtual');
  assert.equal(form.get('metadata[sold_by]'), 'rep');
  assert.equal(form.get('metadata[rep]'), '023k-eddie');
  assert.equal(form.get('subscription_data[metadata][lead_source]'), 'fwn-virtual');
  assert.equal(form.get('subscription_data[metadata][sold_by]'), 'rep');
  assert.equal(form.get('subscription_data[metadata][rep]'), '023k-eddie');
  assert.match(form.get('success_url'), /\{CHECKOUT_SESSION_ID\}$/);
  assert.match(form.get('custom_text[submit][message]'), /no free trial and no free months/i);
});

test('safe cancel path stays on an FWN page', () => {
  assert.equal(fwn.safeCancelPath('https://evil.example/steal', 'launch'), '/fwn/launch');
  assert.equal(fwn.safeCancelPath('//evil.example', 'accelerator'), '/fwn/accelerator');
  assert.equal(fwn.safeCancelPath('/fwn/997?src=fwn-raleigh&ref=lexort', '997'), '/fwn/997?src=fwn-raleigh&ref=lexort');
});

test('checkout handler creates a session only when prices sum to the page total', async () => {
  const calls = [];
  const good = pricesFor(249700);
  async function stripe(secret, method, path, body) {
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('/v1/customers')) return { data: [] };
    if (method === 'POST' && path === '/v1/customers') return { id: 'cus_new' };
    if (method === 'GET' && path === '/v1/prices/price_launch2400') return good.oneTime;
    if (method === 'GET' && path === '/v1/prices/price_monthly97') return good.monthly;
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      return { url: 'https://checkout.stripe.com/c/pay/cs_test_abc' };
    }
    throw new Error('unexpected ' + method + ' ' + path);
  }
  const event = {
    httpMethod: 'POST',
    headers: { host: 'forgedbyaris.com', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({
      package: 'launch',
      email: 'ada@example.com',
      name: 'Ada Investor',
      phone: '(555) 111-2222',
      memberId: 'mem_123',
      src: 'fwn-virtual',
      sold_by: 'rep',
      ref: '023K-Eddie',
      cancelPath: '/fwn/launch?src=fwn-virtual&ref=023K-Eddie',
    }),
  };
  const res = await fwn.checkoutHandler(event, { env: envWithPrices(), stripeRequest: stripe });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).url, 'https://checkout.stripe.com/c/pay/cs_test_abc');
  const sessionCall = calls.find(c => c.path === '/v1/checkout/sessions');
  const form = new URLSearchParams(sessionCall.body);
  assert.equal(form.get('metadata[rep]'), '023k-eddie');
  assert.equal(form.get('subscription_data[metadata][sold_by]'), 'rep');
  assert.equal(form.get('line_items[0][price]'), 'price_launch2400');
  assert.equal(form.get('line_items[1][price]'), 'price_monthly97');
  assert.equal(form.get('mode'), 'subscription');

  calls.length = 0;
  async function mismatch(secret, method, path) {
    calls.push(path);
    if (path.startsWith('/v1/customers')) return { data: [{ id: 'cus_existing' }] };
    if (path === '/v1/prices/price_launch2400') return { active: true, type: 'one_time', currency: 'usd', unit_amount: 249700 };
    if (path === '/v1/prices/price_monthly97') return good.monthly;
    throw new Error('should not create a session');
  }
  const bad = await fwn.checkoutHandler(event, { env: envWithPrices(), stripeRequest: mismatch });
  assert.equal(bad.statusCode, 500);
  assert.equal(calls.some(p => p === '/v1/checkout/sessions'), false);
});

test('checkout handler rejects a missing source and a missing price env', async () => {
  const event = {
    httpMethod: 'POST',
    headers: { host: 'forgedbyaris.com' },
    body: JSON.stringify({ package: 'launch', email: 'ada@example.com', name: 'Ada Investor' }),
  };
  const missingSrc = await fwn.checkoutHandler(event, { env: envWithPrices(), stripeRequest: async () => { throw new Error('no stripe'); } });
  assert.equal(missingSrc.statusCode, 400);
  assert.match(JSON.parse(missingSrc.body).error, /src=fwn-virtual/);

  const noPrice = await fwn.checkoutHandler({
    httpMethod: 'POST',
    headers: { host: 'forgedbyaris.com' },
    body: JSON.stringify({ package: 'accelerator', email: 'ada@example.com', name: 'Ada Investor', src: 'fwn-raleigh' }),
  }, { env: { STRIPE_SECRET_KEY: 'sk_test_123' }, stripeRequest: async () => { throw new Error('no stripe'); } });
  assert.equal(noPrice.statusCode, 500);
  assert.match(JSON.parse(noPrice.body).error, /not available/);
});

test('webhook posts the buyer to the FWN hook and skips a placeholder plan', async () => {
  const posts = [];
  const event = signed({
    type: 'checkout.session.completed',
    data: { object: paidSession() },
  }, SECRET, TS);
  const res = await fwn.webhookHandler(event, {
    env: envWithPrices(),
    nowSec: TS,
    postJson: async (url, body) => { posts.push({ url, body }); return { statusCode: 200, body: 'ok' }; },
    memberstack: { members: { addFreePlan: async () => { throw new Error('should not attach a placeholder plan'); } } },
  });
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ghl, true);
  assert.equal(parsed.plan, 'not_configured');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://services.leadconnectorhq.com/hooks/3dQD2B6ZsBjZVIrWF8WR/webhook-trigger/50f73ea5-6f8b-49bd-8ba2-458aae6e7d9f');
  assert.equal(posts[0].body.email, 'Ada@Example.com');
  assert.equal(posts[0].body.name, 'Ada Investor');
  assert.equal(posts[0].body.phone, '555-111-2222');
  assert.equal(posts[0].body.package, 'launch');
  assert.equal(posts[0].body.lead_source, 'fwn-virtual');
  assert.equal(posts[0].body.sold_by, 'rep');
  assert.equal(posts[0].body.rep, '023k-eddie');
  assert.equal(fwn.isRealPlanId('pln_fwn_launch_placeholder'), false);
});

test('webhook attaches a real free plan to the member with the payer email', async () => {
  const added = [];
  const env = envWithPrices();
  env.MEMBERSTACK_PLAN_FWN_LAUNCH = 'pln_fwn_launch_real1';
  const event = signed({
    type: 'checkout.session.async_payment_succeeded',
    data: { object: paidSession() },
  }, SECRET, TS);
  const res = await fwn.webhookHandler(event, {
    env: env,
    nowSec: TS,
    postJson: async () => ({ statusCode: 200 }),
    memberstack: {
      members: {
        async retrieve(query) {
          if (query.id) return { data: { id: query.id, auth: { email: 'other@example.com' }, planConnections: [] } };
          return { data: { id: 'mem_real', auth: { email: query.email }, planConnections: [] } };
        },
        async addFreePlan(params) { added.push(params); return 'ok'; },
      },
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(added, [{ id: 'mem_real', data: { planId: 'pln_fwn_launch_real1' } }]);
});

test('webhook ignores unpaid, unrelated, and badly signed events', async () => {
  let posts = 0;
  const postJson = async () => { posts += 1; return { statusCode: 200 }; };
  const env = envWithPrices();
  const unpaid = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: paidSession({ payment_status: 'unpaid' }) },
  }, SECRET, TS), { env, nowSec: TS, postJson });
  assert.equal(JSON.parse(unpaid.body).reason, 'unpaid');

  const other = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: paidSession({ metadata: { package: 'foundation', lead_source: 'fwn-virtual' } }) },
  }, SECRET, TS), { env, nowSec: TS, postJson });
  assert.equal(JSON.parse(other.body).reason, 'not_fwn');

  const bad = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: paidSession() },
  }, 'whsec_other', TS), { env, nowSec: TS, postJson });
  assert.equal(bad.statusCode, 400);
  assert.equal(posts, 0);
});

test('ghl payload includes phone only when present', () => {
  const withPhone = fwn.ghlPayload(fwn.buyerFromSession(paidSession()), 'cs_test_123');
  assert.equal(withPhone.phone, '555-111-2222');
  const session = paidSession();
  session.metadata.phone = '';
  session.customer_details.phone = '';
  const without = fwn.ghlPayload(fwn.buyerFromSession(session), 'cs_test_123');
  assert.equal(Object.prototype.hasOwnProperty.call(without, 'phone'), false);
  assert.equal(without.email, 'Ada@Example.com');
});

const PAGES = [
  'fwn-webinar.html',
  'fwn/launch.html',
  'fwn/accelerator.html',
  'fwn/997.html',
  'fwn/1797.html',
  'fwn/thank-you.html',
];

test('FWN pages are noindex, unlisted, and do not name forbidden brands or meeting links', () => {
  const banned = [/lifesurge/i, /kingdom\s*320/i, /tebow/i, /whop/i, /splitit/i, /zoom\.us/i, /meet\.google/i, /calendly/i, /widget\/bookings/i, /teams\.microsoft/i];
  for (const rel of PAGES) {
    const html = read(rel);
    assert.match(html, /name="robots" content="noindex, nofollow"/, rel);
    for (const re of banned) assert.equal(re.test(html), false, rel + ' matched ' + re);
  }
  const webinar = read('fwn-webinar.html');
  assert.match(webinar, /https:\/\/api\.leadconnectorhq\.com\/widget\/form\/J8OFLtP2ysAQFwxaMJP4/);
  assert.match(webinar, /form_embed\.js/);
  assert.match(webinar, /FWN Webinar Registration - Nov 10/);
  assert.match(webinar, /3dQD2B6ZsBjZVIrWF8WR/);
  assert.match(webinar, /November 10, 2026/);
  assert.match(webinar, /7:00–8:30 PM CT/);
  assert.equal(/checkout\.stripe\.com|\/api\/fwn-checkout|STRIPE_PRICE/.test(webinar), false);
  assert.equal(/https?:\/\/(?!fonts\.googleapis|api\.leadconnectorhq|link\.msgsndr|forgedbyaris)/.test(webinar.replace(/https:\/\/fonts\.googleapis\.com/g, '').replace(/https:\/\/api\.leadconnectorhq\.com/g, '').replace(/https:\/\/link\.msgsndr\.com/g, '')), false);

  for (const rel of ['fwn/launch.html', 'fwn/accelerator.html', 'fwn/997.html', 'fwn/1797.html']) {
    const html = read(rel);
    assert.match(html, /There is no free trial and no free months/);
    assert.match(html, /it is BNPL/);
    assert.match(html, /\/assets\/js\/ref-capture\.js/);
    assert.match(html, /\/assets\/js\/fwn-checkout\.js/);
    assert.match(html, /data-fwn-package="/);
    assert.equal(html.includes('30-day trial'), false, rel);
  }
  assert.match(read('fwn/launch.html'), /\$2,497/);
  assert.match(read('fwn/accelerator.html'), /\$4,997/);
  assert.match(read('fwn/997.html'), /\$997/);
  assert.match(read('fwn/1797.html'), /\$1,797/);

  const publicFiles = ['index.html', 'sitemap.xml', 'why-forge.html', 'about.html', 'blog.html', 'login.html'];
  for (const rel of publicFiles) {
    const html = read(rel);
    assert.equal(html.includes('/fwn'), false, rel);
    assert.equal(html.includes('fwn-webinar'), false, rel);
  }
  const robots = read('robots.txt');
  assert.match(robots, /Disallow: \/fwn\//);
  assert.match(robots, /Disallow: \/fwn-webinar/);
  const toml = read('netlify.toml');
  assert.match(toml, /\/api\/fwn-checkout/);
  assert.match(toml, /\/api\/fwn-stripe-webhook/);
  assert.match(toml, /X-Robots-Tag = "noindex, nofollow"/);
});
