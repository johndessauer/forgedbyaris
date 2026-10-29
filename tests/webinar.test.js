const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const webinar = require('../netlify/functions/_Lib/webinar');
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

const DEFAULTS = {
  '997': {
    plan: 'pln_forge-webinar-997-lw00b81',
    price: 'prc_forge-webinar-997-97-ui20bdr',
    setup: 90000,
    due: 99700,
    metadataPackage: 'webinar-997',
  },
  '1797': {
    plan: 'pln_forge-webinar-1-797-uf10b07',
    price: 'prc_forge-webinar-1-797-97-s830bts',
    setup: 170000,
    due: 179700,
    metadataPackage: 'webinar-1797',
  },
};

test('each webinar price is $97/month plus its setup fee, and there is no Launch or Accelerator', () => {
  assert.equal(webinar.MONTHLY_CENTS, 9700);
  assert.deepEqual(Object.keys(webinar.PACKAGES).sort(), ['1797', '997']);
  for (const slug of Object.keys(DEFAULTS)) {
    const pkg = webinar.PACKAGES[slug];
    const expected = DEFAULTS[slug];
    assert.equal(pkg.setupFeeCents + webinar.MONTHLY_CENTS, pkg.dueTodayCents, slug);
    assert.equal(pkg.setupFeeCents, expected.setup);
    assert.equal(pkg.dueTodayCents, expected.due);
    assert.equal(pkg.defaultPlanId, expected.plan);
    assert.equal(pkg.defaultPriceId, expected.price);
    assert.equal(pkg.metadataPackage, expected.metadataPackage);
    assert.equal(webinar.resolvePlanId(pkg, {}), expected.plan);
    assert.equal(webinar.resolvePriceId(pkg, {}), expected.price);
  }
  assert.equal(fwn.PACKAGES['997'].defaultPlanId, 'pln_forge-fwn-997-9x30xu2');
  assert.equal(fwn.PACKAGES['webinar-997'], undefined);
  assert.equal(read('netlify/functions/_Lib/fwn.js').includes('pln_forge-webinar-997-lw00b81'), false);
});

test('attribution requires a sanitized src and rejects FWN sources', () => {
  assert.throws(() => webinar.attributionFromInput({ src: '', ref: 'lexort' }), /src set/);
  assert.throws(() => webinar.attributionFromInput({ src: '!!!' }), /src set/);
  assert.throws(() => webinar.attributionFromInput({ src: 'fwn-virtual' }), /not an FWN checkout/);
  assert.throws(() => webinar.attributionFromInput({ src: 'FWN-Raleigh' }), /not an FWN checkout/);
  assert.deepEqual(webinar.attributionFromInput({ src: 'Organic' }), {
    lead_source: 'organic', sold_by: 'cart', rep: '',
  });
  assert.deepEqual(webinar.attributionFromInput({ src: 'Organic Webinar!', ref: '023K-Eddie' }), {
    lead_source: 'organicwebinar', sold_by: 'rep', rep: '023k-eddie',
  });
  assert.deepEqual(webinar.attributionFromInput({ src: 'partner', soldBy: 'john', ref: 'Lex<script>' }), {
    lead_source: 'partner', sold_by: 'john', rep: 'lexscript',
  });
  assert.deepEqual(webinar.attributionFromInput({ src: 'partner', soldBy: 'nope' }), {
    lead_source: 'partner', sold_by: 'cart', rep: '',
  });
});

test('Memberstack checkout is one price, with src and ref metadata, and no trial', () => {
  const params = webinar.buildMemberstackCheckout({
    priceId: DEFAULTS['997'].price,
    successURL: 'https://forgedbyaris.com/webinar/thank-you',
    cancelURL: 'https://forgedbyaris.com/webinar/997?src=organic&ref=test',
    memberId: 'mem_123',
    name: 'Ada Investor',
    email: 'ada@example.com',
    phone: '555-111-2222',
    lead_source: 'organic',
    sold_by: 'rep',
    rep: 'test',
    packageSlug: 'webinar-997',
  });
  assert.equal(params.priceId, DEFAULTS['997'].price);
  assert.equal(params.metadataForCheckout.lead_source, 'organic');
  assert.equal(params.metadataForCheckout.sold_by, 'rep');
  assert.equal(params.metadataForCheckout.rep, 'test');
  assert.equal(params.metadataForCheckout.ref, 'test');
  assert.equal(params.metadataForCheckout.package, 'webinar-997');
  assert.equal(params.line_items, undefined);
  assert.equal(params.subscription_data, undefined);
  assert.equal(webinar.containsTrialKey(params), false);
  const serialized = JSON.stringify(params);
  assert.equal(serialized.includes('line_items'), false);
  assert.equal(serialized.includes('price_'), false);
  assert.equal(serialized.includes('one_time'), false);
  assert.equal(serialized.includes('trial_period_days'), false);
  assert.equal(serialized.includes('trial_end'), false);
});

test('safe cancel path stays on a webinar page', () => {
  assert.equal(webinar.safeCancelPath('https://evil.example/steal', '997'), '/webinar/997');
  assert.equal(webinar.safeCancelPath('/fwn/997?src=fwn-virtual', '997'), '/webinar/997');
  assert.equal(webinar.safeCancelPath('//evil.example', '1797'), '/webinar/1797');
  assert.equal(webinar.safeCancelPath('/webinar/997?src=organic&ref=test', '997'), '/webinar/997?src=organic&ref=test');
});

function checkoutEvent(overrides) {
  return {
    httpMethod: 'POST',
    headers: { host: 'forgedbyaris.com', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(Object.assign({
      package: '997',
      email: 'ada@example.com',
      name: 'Ada Investor',
      phone: '(555) 111-2222',
      memberId: 'mem_123',
      src: 'organic',
      sold_by: 'rep',
      ref: 'test',
      cancelPath: '/webinar/997?src=organic&ref=test',
    }, overrides || {})),
  };
}

test('checkout returns the webinar Memberstack price and never calls Stripe', async () => {
  let stripeCalls = 0;
  const res = await webinar.checkoutHandler(checkoutEvent(), {
    env: {},
    stripeRequest: async () => { stripeCalls += 1; throw new Error('stripe must not be called'); },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(stripeCalls, 0);
  const body = JSON.parse(res.body);
  assert.equal(body.priceId, DEFAULTS['997'].price);
  assert.equal(body.planId, DEFAULTS['997'].plan);
  assert.equal(body.package, 'webinar-997');
  assert.equal(body.checkout.priceId, DEFAULTS['997'].price);
  assert.equal(body.checkout.successURL, 'https://forgedbyaris.com/webinar/thank-you');
  assert.equal(body.lead_source, 'organic');
  assert.equal(body.sold_by, 'rep');
  assert.equal(body.rep, 'test');
  assert.equal(body.checkout.metadataForCheckout.lead_source, 'organic');
  assert.equal(body.checkout.metadataForCheckout.ref, 'test');
  assert.equal(body.checkout.metadataForCheckout.package, 'webinar-997');
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('line_items'), false);
  assert.equal(serialized.includes('price_'), false);
  assert.equal(serialized.includes('one_time'), false);
  assert.equal(serialized.includes('trial_period_days'), false);
});

test('a Memberstack price env override is used, and a Stripe price override is rejected', async () => {
  const override = 'prc_custom-webinar-price';
  const replaced = await webinar.checkoutHandler(checkoutEvent(), {
    env: { MEMBERSTACK_PRICE_WEBINAR_997: override },
  });
  assert.equal(replaced.statusCode, 200);
  assert.equal(JSON.parse(replaced.body).priceId, override);

  const planOverride = 'pln_custom-webinar-plan';
  const planReplaced = await webinar.checkoutHandler(checkoutEvent({ package: '1797' }), {
    env: { MEMBERSTACK_PLAN_WEBINAR_1797: planOverride },
  });
  assert.equal(JSON.parse(planReplaced.body).planId, planOverride);
  assert.equal(JSON.parse(planReplaced.body).priceId, DEFAULTS['1797'].price);

  const stripePrice = await webinar.checkoutHandler(checkoutEvent(), {
    env: { MEMBERSTACK_PRICE_WEBINAR_997: 'price_webinar900' },
  });
  assert.equal(stripePrice.statusCode, 500);
  assert.match(JSON.parse(stripePrice.body).error, /not available/);
});

test('checkout handler rejects a missing source, an FWN source, and Launch', async () => {
  const missingSrc = await webinar.checkoutHandler(checkoutEvent({ src: '' }), { env: {} });
  assert.equal(missingSrc.statusCode, 400);
  assert.match(JSON.parse(missingSrc.body).error, /src set/);

  const fwnSrc = await webinar.checkoutHandler(checkoutEvent({ src: 'fwn-virtual' }), { env: {} });
  assert.equal(fwnSrc.statusCode, 400);
  assert.match(JSON.parse(fwnSrc.body).error, /not an FWN checkout/);

  const launch = await webinar.checkoutHandler(checkoutEvent({ package: 'launch' }), { env: {} });
  assert.equal(launch.statusCode, 400);
  assert.match(JSON.parse(launch.body).error, /Unknown package/);

  const fwnCheckout = await fwn.checkoutHandler(checkoutEvent({ src: 'organic' }), { env: {} });
  assert.equal(fwnCheckout.statusCode, 400);
  assert.match(JSON.parse(fwnCheckout.body).error, /src=fwn-virtual/);

  const bolted = await fwn.checkoutHandler(checkoutEvent({ package: 'webinar-997', src: 'organic' }), { env: {} });
  assert.equal(bolted.statusCode, 400);
  assert.match(JSON.parse(bolted.body).error, /Unknown package/);
});

test('webinar plan ids do not post to the FWN hook', async () => {
  let posts = 0;
  const result = await fwn.notifyFwnPlanAdded({
    planId: DEFAULTS['997'].plan,
    email: 'ada@example.com',
    json: { webinar: { name: 'Ada Investor', lead_source: 'organic', sold_by: 'cart', rep: 'test' } },
    postJson: async () => { posts += 1; return { statusCode: 200, body: 'ok' }; },
  });
  assert.equal(result.posted, false);
  assert.equal(posts, 0);
});

test('existing stripe webhook copies webinar attribution and does not add a price', async () => {
  const calls = [];
  const session = {
    id: 'cs_webinar',
    mode: 'subscription',
    payment_status: 'paid',
    customer: 'cus_123',
    subscription: 'sub_123',
    metadata: {
      package: 'webinar-997',
      lead_source: 'organic',
      sold_by: 'rep',
      rep: 'test',
      ref: 'test',
      name: 'Ada Investor',
      email: 'ada@example.com',
    },
  };
  assert.equal(webinar.isWebinarAttributionSession(session), true);
  assert.equal(webinar.isWebinarAttributionSession({
    mode: 'subscription',
    metadata: { package: '997', lead_source: 'organic' },
  }), false);
  assert.equal(webinar.isWebinarAttributionSession({
    mode: 'subscription',
    metadata: { package: 'webinar-997', lead_source: 'fwn-virtual' },
  }), false);

  const res = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: session },
  }, SECRET, TS), {
    env: { STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: SECRET },
    nowSec: TS,
    postJson: async () => { throw new Error('webinar metadata copy must not post to the FWN hook'); },
    stripeRequest: async (secret, method, path, body) => {
      calls.push({ method, path, body });
      return { id: 'ok' };
    },
  });
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.charged, false);
  assert.equal(parsed.metadata, 'copied');
  const sub = calls.find(call => call.path === '/v1/subscriptions/sub_123');
  const form = new URLSearchParams(sub.body);
  assert.equal(form.get('metadata[lead_source]'), 'organic');
  assert.equal(form.get('metadata[sold_by]'), 'rep');
  assert.equal(form.get('metadata[rep]'), 'test');
  assert.equal(form.get('metadata[ref]'), 'test');
  assert.equal(form.get('metadata[package]'), 'webinar-997');
  assert.equal(sub.body.includes('line_items'), false);
  assert.equal(sub.body.includes('price_'), false);
  assert.equal(sub.body.includes('price='), false);

  const ignored = await fwn.webhookHandler(signed({
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', payment_status: 'paid', metadata: { package: 'webinar-1797', lead_source: 'fwn-raleigh' } } },
  }, SECRET, TS), {
    env: { STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: SECRET },
    nowSec: TS,
    stripeRequest: async () => { throw new Error('must not copy an FWN source as webinar'); },
  });
  assert.equal(JSON.parse(ignored.body).ignored, true);
  assert.equal(JSON.parse(ignored.body).reason, 'not_fwn');
});

const PAGES = ['webinar/997.html', 'webinar/1797.html', 'webinar/thank-you.html'];
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

test('webinar pages are noindex FORGE webinar enrollments and do not use the FWN checkout', () => {
  const banned = [/lifesurge/i, /kingdom\s*320/i, /tebow/i, /whop/i, /splitit/i, /zoom\.us/i, /meet\.google/i, /calendly/i];
  for (const rel of PAGES) {
    const html = read(rel);
    assert.match(html, /name="robots" content="noindex, nofollow"/, rel);
    assert.equal(html.includes('FWN enrollment'), false, rel);
    assert.equal(/data-fwn-package|fwn-checkout\.js|\/api\/fwn-checkout/.test(html), false, rel);
    for (const re of banned) assert.equal(re.test(html), false, rel + ' matched ' + re);
  }
  for (const rel of ['webinar/997.html', 'webinar/1797.html']) {
    const html = read(rel);
    assert.match(html, /FORGE webinar enrollment/);
    assert.match(html, /There is no free trial and no free months/);
    assert.match(html, /There is no additional one-time fee/);
    assert.match(html, /it is BNPL/);
    assert.match(html, /\/assets\/js\/ref-capture\.js/);
    assert.match(html, /\/assets\/js\/webinar-checkout\.js/);
    assert.match(html, /data-webinar-package="/);
    assert.equal(html.includes('30-day trial'), false, rel);
    assert.equal(/one-time enrollment|line_items|STRIPE_PRICE/.test(html), false, rel);
  }
  assert.match(read('webinar/997.html'), /\$997/);
  assert.match(read('webinar/1797.html'), /\$1,797/);
  assert.match(read('webinar/thank-you.html'), /FORGE webinar enrollment/);
  assert.match(read('fwn/997.html'), /FWN enrollment/);
  assert.match(read('fwn/997.html'), /\/assets\/js\/fwn-checkout\.js/);
  assert.equal(read('fwn/997.html').includes('webinar-checkout.js'), false);
  assert.equal(read('fwn/997.html').includes('pln_forge-webinar'), false);

  const publicFiles = ['index.html', 'sitemap.xml', 'why-forge.html', 'about.html', 'blog.html', 'login.html'];
  for (const rel of publicFiles) {
    assert.equal(read(rel).includes('/webinar'), false, rel);
  }
  const robots = read('robots.txt');
  assert.match(robots, /Disallow: \/webinar\//);
  assert.match(robots, /Disallow: \/fwn\//);
  const toml = read('netlify.toml');
  assert.match(toml, /\/api\/webinar-checkout/);
  assert.match(toml, /\/api\/fwn-checkout/);
  assert.match(toml, /\/api\/fwn-stripe-webhook/);
  assert.match(toml, /for = "\/webinar\/\*"/);

  const source = read('netlify/functions/_Lib/webinar.js');
  assert.equal(source.includes('addFreePlan'), false);
  assert.equal(source.includes('oneTimePriceId'), false);
  assert.equal(/line_items\s*:/.test(source), false);
  assert.equal(source.includes('MEMBERSTACK_PLAN_FWN'), false);
  const client = read('assets/js/webinar-checkout.js');
  assert.match(client, /purchasePlansWithCheckout/);
  assert.match(client, /metadataForCheckout/);
  assert.match(client, /\/api\/webinar-checkout/);
  assert.equal(client.includes('/api/fwn-checkout'), false);
  assert.equal(client.includes('line_items'), false);
  assert.match(read('netlify/functions/memberstack-webhook.js'), /FORGE Webinar 997/);
  assert.match(read('netlify/functions/memberstack-webhook.js'), /FORGE Webinar 1,797/);
  assert.match(read('netlify/functions/fwn-stripe-webhook.js'), /webinar-997/);
});

test('webinar plans grant Empire and comps access on the server and the gated pages', () => {
  const plans = require('../netlify/functions/_Lib/plans');
  assert.equal(plans.PLAN_IDS.WEBINAR_997, DEFAULTS['997'].plan);
  assert.equal(plans.PLAN_IDS.WEBINAR_1797, DEFAULTS['1797'].plan);
  for (const id of [plans.PLAN_IDS.WEBINAR_997, plans.PLAN_IDS.WEBINAR_1797]) {
    const live = [{ planId: id, status: 'ACTIVE' }];
    assert.equal(plans.hasEmpireAccess(live), true, id);
    assert.equal(plans.hasCompsAccess(live), true, id);
    assert.equal(plans.hasEmpireAccess([{ planId: id, status: 'CANCELED' }]), false, id);
  }
  assert.equal(plans.hasEmpireAccess([{ planId: plans.PLAN_IDS.FWN_997, status: 'ACTIVE' }]), true);
  assert.equal(plans.hasEmpireAccess([{ planId: plans.PLAN_IDS.FOUNDATION, status: 'ACTIVE' }]), false);

  for (const rel of GATED_PAGES) {
    const html = read(rel);
    assert.equal(html.includes(DEFAULTS['997'].plan), true, rel);
    assert.equal(html.includes(DEFAULTS['1797'].plan), true, rel);
    assert.match(html, /\[WEBINAR_997_PLAN_ID\]: 'FORGE Webinar 997'/, rel);
    assert.match(html, /pc\.planId === WEBINAR_1797_PLAN_ID/, rel);
  }
  const empirePages = ['deal-network.html', 'dashboard.html', 'deal-analyzer.html', 'education.html', 'profile.html', 'property-search.html', 'real-estate-lab.html'];
  for (const rel of empirePages) {
    assert.match(read(rel), /hasEmpireAccess[\s\S]{0,1600}pc\.planId === WEBINAR_1797_PLAN_ID/, rel);
  }
});

test('rpm-newport-2026 src is accepted by webinar checkout', () => {
  const a = webinar.attributionFromInput({ src: 'rpm-newport-2026', ref: 'eddie' });
  assert.equal(a.lead_source, 'rpm-newport-2026');
  assert.equal(a.rep, 'eddie');
  assert.equal(a.sold_by, 'rep');
});

test('event tags: rpm-newport-2026 plus rep tag', () => {
  assert.deepEqual(
    webinar.eventTagsForMember({ memberJson: { webinar: { lead_source: 'rpm-newport-2026', rep: 'chris' } } }),
    ['rpm-newport-2026', 'rep-chris']);
  assert.deepEqual(
    webinar.eventTagsForMember({ memberJson: { webinar: { lead_source: 'rpm-newport-2026' } }, referralSource: 'ian' }),
    ['rpm-newport-2026', 'rep-ian']);
  assert.deepEqual(webinar.eventTagsForMember({ memberJson: { webinar: { lead_source: 'other-src', rep: 'john' } } }), []);
  assert.deepEqual(webinar.eventTagsForMember({ memberJson: {} }), []);
});
