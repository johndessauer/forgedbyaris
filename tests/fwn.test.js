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

const DEFAULTS = {
  launch: {
    plan: 'pln_forge-launch-fwn--md00xzj',
    price: 'prc_forge-launch-fwn-2-497-97-ip10xow',
    setup: 240000,
    due: 249700,
  },
  accelerator: {
    plan: 'pln_forge-accelerator-fwn--dz20xmt',
    price: 'prc_forge-accelerator-fwn-4-997-97-dh50xnp',
    setup: 490000,
    due: 499700,
  },
  '997': {
    plan: 'pln_forge-fwn-997-9x30xu2',
    price: 'prc_forge-fwn-997-97-zm60xmi',
    setup: 90000,
    due: 99700,
  },
  '1797': {
    plan: 'pln_forge-fwn-1-797-es40xk6',
    price: 'prc_forge-fwn-1-797-97-qg70x6i',
    setup: 170000,
    due: 179700,
  },
};

function envWithWebhook() {
  return {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: SECRET,
  };
}

test('each Memberstack price is $97/month plus its setup fee, which is the full tier', () => {
  assert.equal(fwn.MONTHLY_CENTS, 9700);
  for (const slug of Object.keys(DEFAULTS)) {
    const pkg = fwn.PACKAGES[slug];
    const expected = DEFAULTS[slug];
    assert.equal(pkg.setupFeeCents + fwn.MONTHLY_CENTS, pkg.dueTodayCents, slug);
    assert.equal(pkg.setupFeeCents, expected.setup);
    assert.equal(pkg.dueTodayCents, expected.due);
    assert.equal(pkg.defaultPlanId, expected.plan);
    assert.equal(pkg.defaultPriceId, expected.price);
    assert.equal(fwn.resolvePlanId(pkg, {}), expected.plan);
    assert.equal(fwn.resolvePriceId(pkg, {}), expected.price);
  }
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

test('Memberstack checkout is one price with metadata and no extra one-time fee', () => {
  const params = fwn.buildMemberstackCheckout({
    priceId: DEFAULTS.launch.price,
    successURL: 'https://forgedbyaris.com/fwn/thank-you',
    cancelURL: 'https://forgedbyaris.com/fwn/launch?src=fwn-virtual',
    memberId: 'mem_123',
    name: 'Ada Investor',
    email: 'ada@example.com',
    phone: '555-111-2222',
    lead_source: 'fwn-virtual',
    sold_by: 'rep',
    rep: '023k-eddie',
    packageSlug: 'launch',
  });
  assert.equal(params.priceId, DEFAULTS.launch.price);
  assert.equal(params.metadataForCheckout.lead_source, 'fwn-virtual');
  assert.equal(params.metadataForCheckout.sold_by, 'rep');
  assert.equal(params.metadataForCheckout.rep, '023k-eddie');
  assert.equal(params.metadataForCheckout.ref, '023k-eddie');
  assert.equal(params.metadataForCheckout.package, 'launch');
  assert.equal(params.line_items, undefined);
  assert.equal(params.subscription_data, undefined);
  assert.equal(fwn.containsTrialKey(params), false);
  const serialized = JSON.stringify(params);
  assert.equal(serialized.includes('line_items'), false);
  assert.equal(serialized.includes('price_'), false);
  assert.equal(serialized.includes('one_time'), false);
  assert.equal(serialized.includes('trial_period_days'), false);
  assert.equal(serialized.includes('trial_end'), false);
});

test('safe cancel path stays on an FWN page', () => {
  assert.equal(fwn.safeCancelPath('https://evil.example/steal', 'launch'), '/fwn/launch');
  assert.equal(fwn.safeCancelPath('//evil.example', 'accelerator'), '/fwn/accelerator');
  assert.equal(fwn.safeCancelPath('/fwn/997?src=fwn-raleigh&ref=lexort', '997'), '/fwn/997?src=fwn-raleigh&ref=lexort');
});

function checkoutEvent(overrides) {
  return {
    httpMethod: 'POST',
    headers: { host: 'forgedbyaris.com', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(Object.assign({
      package: 'launch',
      email: 'ada@example.com',
      name: 'Ada Investor',
      phone: '(555) 111-2222',
      memberId: 'mem_123',
      src: 'fwn-virtual',
      sold_by: 'rep',
      ref: '023K-Eddie',
      cancelPath: '/fwn/launch?src=fwn-virtual&ref=023K-Eddie',
    }, overrides || {})),
  };
}

test('checkout returns the default Memberstack price and never calls Stripe', async () => {
  let stripeCalls = 0;
  const res = await fwn.checkoutHandler(checkoutEvent(), {
    env: {},
    stripeRequest: async () => { stripeCalls += 1; throw new Error('stripe must not be called'); },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(stripeCalls, 0);
  const body = JSON.parse(res.body);
  assert.equal(body.priceId, DEFAULTS.launch.price);
  assert.equal(body.planId, DEFAULTS.launch.plan);
  assert.equal(body.checkout.priceId, DEFAULTS.launch.price);
  assert.equal(body.lead_source, 'fwn-virtual');
  assert.equal(body.sold_by, 'rep');
  assert.equal(body.rep, '023k-eddie');
  assert.equal(body.checkout.metadataForCheckout.rep, '023k-eddie');
  assert.equal(body.url, undefined);
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('line_items'), false);
  assert.equal(serialized.includes('price_'), false);
  assert.equal(serialized.includes('one_time'), false);
});

test('a Memberstack price env override is used, and a Stripe price override is rejected', async () => {
  const override = 'prc_custom-launch-price';
  const replaced = await fwn.checkoutHandler(checkoutEvent(), {
    env: { MEMBERSTACK_PRICE_FWN_LAUNCH: override },
    stripeRequest: async () => { throw new Error('stripe must not be called'); },
  });
  assert.equal(replaced.statusCode, 200);
  assert.equal(JSON.parse(replaced.body).priceId, override);

  const stripePrice = await fwn.checkoutHandler(checkoutEvent(), {
    env: { MEMBERSTACK_PRICE_FWN_LAUNCH: 'price_launch2400' },
    stripeRequest: async () => { throw new Error('stripe must not be called'); },
  });
  assert.equal(stripePrice.statusCode, 500);
  assert.match(JSON.parse(stripePrice.body).error, /not available/);
});

test('checkout handler rejects a missing source', async () => {
  const missingSrc = await fwn.checkoutHandler(checkoutEvent({ src: '' }), {
    env: {},
    stripeRequest: async () => { throw new Error('no stripe'); },
  });
  assert.equal(missingSrc.statusCode, 400);
  assert.match(JSON.parse(missingSrc.body).error, /src=fwn-virtual/);
});

test('member.plan.added posts the FWN buyer and ignores other plans', async () => {
  const posts = [];
  const send = async (url, body) => { posts.push({ url, body }); return { statusCode: 200, body: 'ok' }; };
  const posted = await fwn.notifyFwnPlanAdded({
    planId: DEFAULTS.launch.plan,
    email: 'Ada@Example.com',
    customFields: { 'first-name': 'Ada', 'last-name': 'Investor', 'referral-source': 'fallback-rep' },
    json: { fwn: { name: 'Ada Investor', phone: '555-111-2222', lead_source: 'fwn-virtual', sold_by: 'rep', rep: '023k-eddie' } },
    env: {},
    postJson: send,
  });
  assert.equal(posted.posted, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://services.leadconnectorhq.com/hooks/3dQD2B6ZsBjZVIrWF8WR/webhook-trigger/50f73ea5-6f8b-49bd-8ba2-458aae6e7d9f');
  assert.equal(posts[0].body.email, 'Ada@Example.com');
  assert.equal(posts[0].body.name, 'Ada Investor');
  assert.equal(posts[0].body.phone, '555-111-2222');
  assert.equal(posts[0].body.package, 'launch');
  assert.equal(posts[0].body.lead_source, 'fwn-virtual');
  assert.equal(posts[0].body.sold_by, 'rep');
  assert.equal(posts[0].body.rep, '023k-eddie');
  assert.equal(Object.prototype.hasOwnProperty.call(posts[0].body, 'stripe_checkout_session_id'), false);

  const other = await fwn.notifyFwnPlanAdded({
    planId: 'pln_some-other-plan',
    email: 'ada@example.com',
    postJson: send,
  });
  assert.equal(other.posted, false);
  assert.equal(posts.length, 1);

  await assert.rejects(() => fwn.notifyFwnPlanAdded({
    planId: DEFAULTS.accelerator.plan,
    email: 'ada@example.com',
    json: { fwn: { name: 'Ada Investor', lead_source: 'fwn-raleigh', sold_by: 'cart' } },
    postJson: async () => ({ statusCode: 500, body: 'no' }),
  }));
});

test('stripe webhook copies metadata only and does not add a price or a plan', async () => {
  const calls = [];
  const session = paidSession({ subscription: 'sub_123' });
  const res = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: session },
  }, SECRET, TS), {
    env: envWithWebhook(),
    nowSec: TS,
    postJson: async () => { throw new Error('stripe webhook must not post to GHL'); },
    memberstack: { members: { addFreePlan: async () => { throw new Error('must not add a plan'); } } },
    stripeRequest: async (secret, method, path, body) => {
      calls.push({ secret, method, path, body });
      return { id: 'sub_123' };
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).charged, false);
  assert.equal(JSON.parse(res.body).metadata, 'copied');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/v1/subscriptions/sub_123');
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('metadata[lead_source]'), 'fwn-virtual');
  assert.equal(form.get('metadata[sold_by]'), 'rep');
  assert.equal(form.get('metadata[rep]'), '023k-eddie');
  assert.equal(form.get('metadata[ref]'), '023k-eddie');
  assert.equal(form.get('metadata[package]'), 'launch');
  assert.equal(calls[0].body.includes('line_items'), false);
  assert.equal(calls[0].body.includes('price_'), false);

  const failed = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: session },
  }, SECRET, TS), {
    env: envWithWebhook(),
    nowSec: TS,
    stripeRequest: async () => { throw new Error('stripe down'); },
  });
  assert.equal(failed.statusCode, 200);
  assert.equal(JSON.parse(failed.body).metadata, 'update_failed');
  assert.equal(fwn.isRealPlanId('pln_fwn_launch_placeholder'), false);
});

test('main checkout ref is copied onto the customer, subscription, and payment', async () => {
  const calls = [];
  const session = {
    id: 'cs_main',
    mode: 'subscription',
    payment_status: 'paid',
    customer: 'cus_123',
    subscription: { id: 'sub_123' },
    payment_intent: 'pi_123',
    metadata: { ref: 'Lexort-Jeremy' },
  };
  const res = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: session },
  }, SECRET, TS), {
    env: envWithWebhook(),
    nowSec: TS,
    stripeRequest: async (secret, method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path === '/v1/payment_intents/pi_123') {
        return { id: 'pi_123', latest_charge: 'ch_123' };
      }
      return { id: 'ok' };
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ref, true);
  const posts = calls.filter(c => c.method === 'POST');
  assert.deepEqual(posts.map(c => c.path), [
    '/v1/subscriptions/sub_123',
    '/v1/customers/cus_123',
    '/v1/payment_intents/pi_123',
    '/v1/charges/ch_123',
  ]);
  posts.forEach((call) => {
    const form = new URLSearchParams(call.body);
    assert.equal(form.get('metadata[ref]'), 'lexort-jeremy');
    assert.equal(call.body.includes('line_items'), false);
    assert.equal(call.body.includes('price='), false);
    assert.equal(form.get('metadata[lead_source]'), null);
  });
});

test('webhook ignores unpaid, unrelated, and badly signed events', async () => {
  let calls = 0;
  const stripeRequest = async () => { calls += 1; return {}; };
  const env = envWithWebhook();
  const unpaid = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: paidSession({ payment_status: 'unpaid' }) },
  }, SECRET, TS), { env, nowSec: TS, stripeRequest });
  assert.equal(JSON.parse(unpaid.body).reason, 'unpaid');

  const other = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: paidSession({ metadata: { package: 'foundation', lead_source: 'fwn-virtual' } }) },
  }, SECRET, TS), { env, nowSec: TS, stripeRequest });
  assert.equal(JSON.parse(other.body).reason, 'not_fwn');

  const bad = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: paidSession() },
  }, 'whsec_other', TS), { env, nowSec: TS, stripeRequest });
  assert.equal(bad.statusCode, 400);
  assert.equal(calls, 0);
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
    assert.match(html, /There is no additional one-time fee/);
    assert.match(html, /it is BNPL/);
    assert.equal(/one-time enrollment|line_items|STRIPE_PRICE_FWN/.test(html), false, rel);
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

  const source = read('netlify/functions/_Lib/fwn.js');
  assert.equal(source.includes('STRIPE_PRICE_FWN_MONTHLY'), false);
  assert.equal(source.includes('oneTimePriceId'), false);
  assert.equal(source.includes('addFreePlan'), false);
  assert.equal(/line_items\s*:/.test(source), false);
  const client = read('assets/js/fwn-checkout.js');
  assert.match(client, /purchasePlansWithCheckout/);
  assert.match(client, /metadataForCheckout/);
  assert.match(read('netlify/functions/memberstack-webhook.js'), /notifyFwnPlanAdded/);
});

const GATED_PAGES = [
  'deal-network.html',
  'capital-radar.html',
  'crm.html',
  'dashboard.html',
  'deal-analyzer.html',
  'education.html',
  'profile.html',
  'property-search.html',
  'real-estate-lab.html',
  'document-vault.html',
  'market-oracle.html',
  'aris-coach.html',
];

test('FWN plans are on the member allowlists with Founding Member access', () => {
  const plans = require('../netlify/functions/_Lib/plans');
  const ids = Object.values(DEFAULTS).map(pkg => pkg.plan);
  for (const id of ids) {
    const live = [{ planId: id, status: 'ACTIVE' }];
    assert.equal(plans.hasEmpireAccess(live), true, id);
    assert.equal(plans.hasCompsAccess(live), true, id);
    assert.equal(plans.hasEmpireAccess([{ planId: id, status: 'CANCELED' }]), false, id);
  }
  assert.equal(plans.hasEmpireAccess([{ planId: plans.PLAN_IDS.FOUNDATION, status: 'ACTIVE' }]), false);
  assert.equal(plans.hasEmpireAccess([{ planId: plans.PLAN_IDS.FOUNDING_MEMBER, status: 'ACTIVE' }]), true);
  assert.equal(plans.PLAN_IDS.FORGE_ZERO, 'pln_forge-zero-psnx0aea');
  assert.equal(plans.PLAN_IDS.BETA_97, 'pln_-97-direct--jx9b09ut');

  for (const rel of GATED_PAGES) {
    const html = read(rel);
    for (const id of ids) {
      assert.equal(html.includes(id), true, rel + ' missing ' + id);
    }
    assert.match(html, /FWN_LAUNCH_PLAN_ID \|\| pc\.planId === FWN_ACCELERATOR_PLAN_ID/, rel);
    assert.match(html, /activeConn\.planId === FWN_1797_PLAN_ID/, rel);
    assert.match(html, /\[FWN_LAUNCH_PLAN_ID\]: 'FORGE Launch'/, rel);
    assert.match(html, /pln_founding-member-a1p70rff/, rel);
    assert.match(html, /pln_foundation--s11cv0hs9/, rel);
  }
  const empirePages = ['deal-network.html', 'dashboard.html', 'deal-analyzer.html', 'education.html', 'profile.html', 'property-search.html', 'real-estate-lab.html'];
  for (const rel of empirePages) {
    assert.match(read(rel), /hasEmpireAccess[\s\S]{0,1200}pc\.planId === FWN_1797_PLAN_ID/, rel);
  }
});
