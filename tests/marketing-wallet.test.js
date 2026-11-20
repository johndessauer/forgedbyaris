const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const pricing = require('../netlify/functions/_Lib/marketing-pricing');
const wallet = require('../netlify/functions/_Lib/marketing-wallet');
const lob = require('../netlify/functions/_Lib/marketing-lob');
const stripe = require('../netlify/functions/_Lib/marketing-stripe');
const storeLib = require('../netlify/functions/_Lib/marketing-store');
const walletApi = require('../netlify/functions/_Lib/marketing-wallet-http');
const webhookApi = require('../netlify/functions/_Lib/marketing-stripe-webhook-http');
const orderApi = require('../netlify/functions/_Lib/marketing-order-http');
const app = require('../assets/js/marketing-app');

const SECRET = 'whsec_marketing_test';
const BRAND = {
  id: 'brand_1',
  businessName: 'Sample Buys',
  phone: '555-0100',
  returnAddress: { line1: '1 Main St', city: 'Sampletown', state: 'ST', zip: '00000' },
  colors: { primary: '#1F3348', accent: '#C89B3C' },
  disclosure: 'Independent real estate investor. Not a licensed real estate agent or broker unless stated.',
};
const LEAD = { owner: 'Pat Example', address: '123 Sample Street', city: 'Sampletown', state: 'ST', zip: '00000' };

function sign(body, secret) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
  return 't=' + t + ',v1=' + v1;
}

function rig(opts) {
  const o = opts || {};
  const blob = o.blob || storeLib.createMemoryBlobStore();
  const calls = [];
  const env = Object.assign({
    CONTEXT: 'production',
    MARKETING_STRIPE_SECRET_KEY: 'sk_test_marketing',
    MARKETING_STRIPE_WEBHOOK_SECRET: SECRET,
    LOB_API_KEY: 'test_lob_key',
  }, o.env || {});
  const memberId = o.memberId || 'mem_john';
  const members = {
    mem_john: { email: 'john@thedessauergroup.com', empire: true },
    mem_foundation: { email: 'member@example.com', empire: false },
  };
  const deps = {
    env: env,
    context: env.CONTEXT,
    getStore: () => blob,
    requireMembership: async () => ({ memberId: memberId, empire: !!(members[memberId] && members[memberId].empire), active: true, planConnections: [] }),
    getMember: async (id) => ({ auth: { email: (members[id] && members[id].email) || '' }, planConnections: [] }),
    fetch: async (url, init) => {
      calls.push({ url: url, init: init });
      if (o.fetch) return o.fetch(url, init, calls);
      return { ok: true, json: async () => ({ id: 'psc_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) };
    },
  };
  const call = async (handler, body, method, extra) => {
    const more = extra || {};
    const res = await handler(Object.assign({
      httpMethod: method || 'POST',
      headers: { authorization: 'Bearer tok' },
      queryStringParameters: {},
      body: body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body)),
    }, more));
    const type = res.headers && res.headers['Content-Type'] || '';
    return {
      status: res.statusCode,
      body: type.indexOf('text/csv') === 0 ? res.body : (res.body ? JSON.parse(res.body) : null),
      raw: res.body,
    };
  };
  return { blob: blob, deps: deps, calls: calls, call: call, env: env };
}

test('mail is vendor cost times 1.20 and print defaults to 30 percent inside 25 to 35', () => {
  const one = pricing.quoteOrder(['postcard', 'letter', 'door-hanger', 'bandit', 'call'], 2, {});
  const postcard = one.lines.find(row => row.channelId === 'postcard');
  const letter = one.lines.find(row => row.channelId === 'letter');
  const hanger = one.lines.find(row => row.channelId === 'door-hanger');
  assert.equal(pricing.publishedCents(pricing.POSTCARD_4X6_FIRST_CLASS_USD), 91);
  assert.equal(pricing.publishedCents(pricing.LETTER_BW_STANDARD_USD), 83);
  assert.equal(postcard.unitVendorCostCents, 91);
  assert.equal(letter.unitVendorCostCents, 83);
  assert.equal(postcard.unitStudentPriceCents, 109);
  assert.equal(postcard.studentPriceCents, 218);
  assert.equal(letter.unitStudentPriceCents, 100);
  assert.equal(letter.studentPriceCents, 200);
  assert.equal(one.vendorCostCents, (91 + 83) * 2);
  assert.equal(one.chargedCents, 218 + 200);
  assert.equal(one.vendorCostCents + one.markupCents, one.chargedCents);
  assert.equal(hanger.mailed, false);
  assert.equal(hanger.studentPriceCents, 0);
  assert.equal(hanger.unitStudentPriceCents, Math.round(21 * 1.30));
  assert.equal(one.lines.some(row => row.channelId === 'call'), false);
  assert.equal(pricing.printMarkupRate({ MARKETING_PRINT_MARKUP: '0.25' }), 0.25);
  assert.equal(pricing.printMarkupRate({ MARKETING_PRINT_MARKUP: '0.99' }), 0.35);
  assert.equal(pricing.printMarkupRate({ MARKETING_PRINT_MARKUP: '0.10' }), 0.25);
  const clamped = pricing.quoteOrder(['bandit'], 4, { MARKETING_PRINT_MARKUP: '0.99' });
  assert.equal(clamped.lines[0].unitStudentPriceCents, Math.round(395 * 1.35));
  assert.equal(clamped.chargedCents, 0);
  assert.equal(one.testMode, true);
});

test('wallet credits a Stripe session once and refuses a debit that does not fit', async () => {
  const store = storeLib.createMemoryBlobStore();
  const first = await wallet.credit(store, { memberId: 'mem_john', amountCents: 5000, stripeSessionId: 'cs_test_1' });
  const again = await wallet.credit(store, { memberId: 'mem_john', amountCents: 5000, stripeSessionId: 'cs_test_1' });
  assert.equal(first.credited, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.balanceCents, 5000);
  const spent = await wallet.debit(store, { memberId: 'mem_john', amountCents: 418, orderId: 'ord_1' });
  assert.equal(spent.debited, true);
  assert.equal(spent.balanceCents, 4582);
  const short = await wallet.debit(store, { memberId: 'mem_john', amountCents: 9000, orderId: 'ord_2' });
  assert.equal(short.debited, false);
  assert.equal(short.shortfallCents, 9000 - 4582);
  assert.equal((await wallet.readWallet(store, 'mem_john')).balanceCents, 4582);
  const ledger = await wallet.readLedger(store, 'mem_john');
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].type, 'credit');
  assert.equal(ledger[1].type, 'debit');
});

test('a live mail key is refused unless test mail is explicitly turned on', () => {
  assert.throws(() => lob.assertMailKey({}), /Mail is not configured/);
  assert.throws(() => lob.assertMailKey({ LOB_API_KEY: 'live_secret' }), /not a test key/);
  assert.equal(lob.assertMailKey({ LOB_API_KEY: 'test_secret' }).testMode, true);
  assert.equal(lob.assertMailKey({ LOB_API_KEY: 'live_secret', MARKETING_LIVE_MAIL: 'true' }).testMode, false);
  assert.throws(() => stripe.assertTestStripeKey({ MARKETING_STRIPE_SECRET_KEY: 'sk_live_secret' }), /Test checkout is not configured/);
  assert.throws(() => stripe.assertTestStripeKey({ MARKETING_STRIPE_SECRET_KEY: 'rk_live_secret' }), /Test checkout is not configured/);
  assert.throws(() => stripe.assertTestStripeKey({ STRIPE_SECRET_KEY: 'sk_test_other' }), /Test checkout is not configured/);
  assert.equal(stripe.assertTestStripeKey({ MARKETING_STRIPE_SECRET_KEY: 'sk_test_51example' }), 'sk_test_51example');
  assert.equal(stripe.assertTestStripeKey({ MARKETING_STRIPE_SECRET_KEY: 'rk_test_sandbox' }), 'rk_test_sandbox');
  assert.equal(stripe.assertTestStripeKey({ MARKETING_STRIPE_SECRET_KEY: '"sk_test_quoted"\n' }), 'sk_test_quoted');

  const prior = process.env.MARKETING_STRIPE_SECRET_KEY;
  process.env.MARKETING_STRIPE_SECRET_KEY = 'rk_live_should_not_win';
  globalThis.Netlify = { env: { get: (name) => name === 'MARKETING_STRIPE_SECRET_KEY' ? "'sk_test_from_netlify'\n" : '' } };
  try {
    assert.equal(stripe.assertTestStripeKey(process.env), 'sk_test_from_netlify');
  } finally {
    if (prior == null) delete process.env.MARKETING_STRIPE_SECRET_KEY;
    else process.env.MARKETING_STRIPE_SECRET_KEY = prior;
    delete globalThis.Netlify;
  }

  function reasonOf(env) {
    try {
      stripe.assertTestStripeKey(env);
    } catch (err) {
      return err.reason;
    }
    return '';
  }
  assert.equal(reasonOf({}), 'missing');
  assert.equal(reasonOf({ MARKETING_STRIPE_SECRET_KEY: 'sk_live_abc' }), 'live_key_refused');
  assert.equal(reasonOf({ MARKETING_STRIPE_SECRET_KEY: 'pk_test_publishable' }), 'bad_prefix:pk_');
  assert.equal(reasonOf({ MARKETING_STRIPE_SECRET_KEY: 'whsec_webhook' }), 'bad_prefix:whs');
});

test('top-up checkout uses only the test key and the webhook credits the wallet once', async () => {
  const box = rig();
  const walletHandler = walletApi.createHandler(box.deps);
  const started = await box.call(walletHandler, { action: 'topup', amountCents: 2500 });
  assert.equal(started.status, 200);
  assert.equal(started.body.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.match(box.calls[0].init.headers.Authorization, /^Bearer sk_test_marketing$/);
  assert.match(decodeURIComponent(box.calls[0].init.body), /unit_amount\]=2500/);
  assert.match(decodeURIComponent(box.calls[0].init.body), /metadata\[amount_cents\]=2500/);
  assert.equal(box.calls[0].init.body.includes('sk_live'), false);

  const live = rig({ env: { MARKETING_STRIPE_SECRET_KEY: 'sk_live_nope' } });
  const refused = await live.call(walletApi.createHandler(live.deps), { action: 'topup', amountCents: 5000 });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.reason, 'live_key_refused');
  assert.equal(JSON.stringify(refused.body).includes('sk_live_nope'), false);
  assert.equal(live.calls.length, 0);

  const missing = rig({ env: { MARKETING_STRIPE_SECRET_KEY: '' } });
  const empty = await missing.call(walletApi.createHandler(missing.deps), { action: 'topup', amountCents: 2500 });
  assert.equal(empty.body.reason, 'missing');

  const page = fs.readFileSync(path.join(__dirname, '../assets/js/marketing-app.js'), 'utf8');
  const topup = page.slice(page.indexOf('async function startTopUp'), page.indexOf('async function confirmMail'));
  assert.match(topup, /postJson\(state\.token, '\/api\/marketing-wallet'/);
  assert.equal(topup.indexOf("'/api/marketing-wallet'") < topup.indexOf('Test checkout is not configured'), true);
  const shown = app.createState({ quote: { chargedCents: 109, balanceCents: 0, shortfallCents: 109, lines: [] } });
  shown.message = 'Test checkout is not configured.';
  shown.reason = 'missing';
  assert.match(app.renderCost(shown), /<p class="mkt-reason">missing<\/p>/);

  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_9', amount_total: 2500, payment_status: 'paid', metadata: { purpose: 'marketing-wallet', member_id: 'mem_john', amount_cents: '2500' } } },
  });
  const hook = webhookApi.createHandler(box.deps);
  const credited = await box.call(hook, payload, 'POST', { headers: { 'stripe-signature': sign(payload, SECRET) } });
  const replay = await box.call(hook, payload, 'POST', { headers: { 'stripe-signature': sign(payload, SECRET) } });
  assert.equal(credited.status, 200);
  assert.equal(credited.body.credited, true);
  assert.equal(credited.body.balanceCents, 2500);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.balanceCents, 2500);
  const bad = await box.call(hook, payload, 'POST', { headers: { 'stripe-signature': 't=1,v1=dead' } });
  assert.equal(bad.status, 400);
});

test('confirm debits the wallet, sends a test postcard, and returns the credits if mail fails', async () => {
  const box = rig();
  await box.blob.setJSON('brands/mem_john.json', { brands: [BRAND] });
  await wallet.credit(box.blob, { memberId: 'mem_john', amountCents: 10000, stripeSessionId: 'cs_seed' });
  const handler = orderApi.createHandler(box.deps);
  const quote = await box.call(handler, { action: 'quote', channels: ['postcard', 'bandit', 'email'], leads: [LEAD] });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.chargedCents, 109);
  const formatted = await box.call(handler, {
    action: 'quote',
    channels: ['postcard'],
    leads: [
      { address: '412 W Joliet St, Crown Point, IN 46307', owner: 'M. Delgado' },
      { address: '2107 Delaware Pkwy', city: 'Crown Point', state: 'IN', zip: '46307' },
      { address: 'No city here' },
    ],
  });
  assert.equal(formatted.body.selectedLeadCount, 3);
  assert.equal(formatted.body.leadCount, 2);
  assert.equal(formatted.body.lines[0].quantity, 2);
  assert.equal(formatted.body.lines[0].studentPriceCents, 218);
  assert.equal(JSON.stringify(quote.body).toLowerCase().includes('lob'), false);
  assert.equal(quote.body.lines.some(row => row.channelId === 'bandit' && row.mailed === false), true);

  const sent = await box.call(handler, {
    action: 'confirm',
    idempotencyKey: 'cfm_once',
    brandId: 'brand_1',
    channels: ['postcard', 'handwritten'],
    leads: [LEAD],
    pieces: [
      { channel: 'postcard', variantA: 'Hello from the sample buy', approved: true },
      { channel: 'handwritten', variantA: 'Note', approved: true },
    ],
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.chargedCents, 218);
  assert.equal(sent.body.testMode, true);
  assert.equal((await wallet.readWallet(box.blob, 'mem_john')).balanceCents, 10000 - 218);
  assert.equal(box.calls.length, 2);
  assert.equal(box.calls[0].url, 'https://api.lob.com/v1/postcards');
  assert.equal(box.calls[1].url, 'https://api.lob.com/v1/postcards');
  const mailed = JSON.parse(box.calls[0].init.body);
  const note = JSON.parse(box.calls[1].init.body);
  assert.equal(note.size, '4x6');
  assert.equal(mailed.size, '4x6');
  assert.equal(mailed.mail_type, 'usps_first_class');
  assert.match(mailed.front, /#1F3348/);
  assert.match(mailed.front, /TEST — not a real mailing/);
  assert.equal(box.calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('test_lob_key:').toString('base64'));
  assert.equal(box.calls[0].init.body.includes('test_lob_key'), false);
  assert.equal(JSON.stringify(sent.body).toLowerCase().includes('lob'), false);

  const replay = await box.call(handler, {
    action: 'confirm',
    idempotencyKey: 'cfm_once',
    brandId: 'brand_1',
    channels: ['postcard'],
    leads: [LEAD],
    pieces: [{ channel: 'postcard', variantA: 'Hello', approved: true }],
  });
  assert.equal(replay.body.duplicate, true);
  assert.equal((await wallet.readWallet(box.blob, 'mem_john')).balanceCents, 10000 - 218);
  assert.equal(box.calls.length, 2);

  const broken = rig({
    blob: box.blob,
    fetch: async () => ({ ok: false, json: async () => ({ error: 'no' }) }),
  });
  const returned = await broken.call(orderApi.createHandler(broken.deps), {
    action: 'confirm',
    idempotencyKey: 'cfm_fail',
    brandId: 'brand_1',
    channels: ['letter'],
    leads: [LEAD],
    pieces: [{ channel: 'letter', variantA: 'Letter', approved: true }],
  });
  assert.equal(returned.status, 502);
  const letterBody = JSON.parse(broken.calls[0].init.body);
  assert.equal(letterBody.color, false);
  assert.equal(letterBody.mail_type, 'usps_standard');
  assert.equal((await wallet.readWallet(box.blob, 'mem_john')).balanceCents, 10000 - 218);

  const live = rig({ blob: box.blob, env: { LOB_API_KEY: 'live_secret' } });
  const blocked = await live.call(orderApi.createHandler(live.deps), {
    action: 'confirm',
    brandId: 'brand_1',
    channels: ['postcard'],
    leads: [LEAD],
    pieces: [{ channel: 'postcard', variantA: 'Hello', approved: true }],
  });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /not a test key/);
  assert.equal(live.calls.length, 0);
  assert.equal((await wallet.readWallet(box.blob, 'mem_john')).balanceCents, 10000 - 218);
});

test('an approved handwritten-style note continues to cost as a 4x6 postcard', () => {
  const note = pricing.quoteOrder(['handwritten'], 1, {});
  assert.equal(pricing.mailFormat('handwritten'), 'postcard');
  assert.equal(note.lines[0].mailed, true);
  assert.equal(note.lines[0].unitVendorCostCents, pricing.publishedCents(pricing.POSTCARD_4X6_FIRST_CLASS_USD));
  assert.equal(note.lines[0].unitStudentPriceCents, 109);
  assert.equal(note.chargedCents, 109);

  function draft(selected, approved) {
    return app.createState({
      propertyClass: 'residential',
      selected: selected,
      copies: {
        residential: {
          handwritten: { variantA: 'Note', variantB: 'B' },
          postcard: { variantA: 'Card', variantB: 'B' },
          call: { variantA: 'Call', variantB: 'B' },
        },
        commercial: {},
      },
      approved: approved,
    });
  }
  const mailed = app.renderApprove(draft({ handwritten: true }, { 'residential:handwritten': true }));
  assert.match(mailed, /class="mkt-actions"><button type="button" data-action="export">Export copy<\/button><button type="button" data-action="step" data-step="5">Continue to cost<\/button>/);
  assert.match(app.renderApprove(draft({ postcard: true }, { 'residential:postcard': true })), /Continue to cost/);
  const own = app.renderApprove(draft({ call: true }, { 'residential:call': true }));
  assert.match(own, /These pieces are send-it-yourself and there's nothing to mail/);
  assert.equal(own.includes('Continue to cost'), false);
  const waiting = app.renderApprove(draft({ postcard: true }, {}));
  assert.equal(waiting.includes('Continue to cost'), false);
  assert.equal(waiting.includes('nothing to mail'), false);
});

test('the markup report is allowlist-only and lists Lob cost, price, and markup', async () => {
  const box = rig();
  await box.blob.setJSON('brands/mem_john.json', { brands: [BRAND] });
  await wallet.credit(box.blob, { memberId: 'mem_john', amountCents: 5000, stripeSessionId: 'cs_report' });
  const handler = orderApi.createHandler(box.deps);
  await box.call(handler, {
    action: 'confirm',
    brandId: 'brand_1',
    channels: ['postcard', 'letter'],
    leads: [LEAD, LEAD],
    pieces: [
      { channel: 'postcard', variantA: 'Card', approved: true },
      { channel: 'letter', variantA: 'Letter', approved: true },
    ],
  });
  const report = await box.call(handler, null, 'GET', { queryStringParameters: { format: 'csv' } });
  assert.equal(report.status, 200);
  assert.match(report.raw, /lob_cost,price_charged,markup/);
  assert.match(report.raw, /john@thedessauergroup.com/);
  assert.match(report.raw, /3\.48,4\.18,0\.70/);

  const student = rig({ memberId: 'mem_foundation', env: { CONTEXT: 'deploy-preview' }, blob: box.blob });
  const hidden = await student.call(orderApi.createHandler(student.deps), null, 'GET');
  assert.equal(hidden.status, 403);

  const empty = app.renderCost(app.createState({
    propertyClass: 'residential',
    quote: {
      chargedCents: 109,
      balanceCents: 0,
      shortfallCents: 109,
      lines: [
        { channelId: 'postcard', mailed: true, quantity: 1, unitStudentPriceCents: 109, studentPriceCents: 109 },
        { channelId: 'bandit', mailed: false, quantity: 0, unitStudentPriceCents: 514, studentPriceCents: 0 },
      ],
    },
  }));
  const confirm = app.renderConfirm(app.createState({ quote: { chargedCents: 109, balanceCents: 2500, shortfallCents: 0 } }));
  assert.match(empty, /Test mail total/);
  assert.match(empty, /\$1\.09/);
  assert.match(empty, /Not charged in this test/);
  assert.match(empty, /Add \$25/);
  assert.match(empty, /class="mkt-row mkt-next"><button type="button" data-action="step" data-step="6">Continue to confirm/);
  assert.match(fs.readFileSync(path.join(__dirname, '../assets/css/marketing.css'), 'utf8'), /\.mkt-next \{ margin-top: 24px; \}/);
  assert.match(confirm, /Confirm test mail/);
  assert.match(confirm, /Nothing is really printed/);
  assert.equal((empty + confirm).toLowerCase().includes('lob'), false);
  const zero = app.renderCost(app.createState({
    quote: {
      leadCount: 0,
      selectedLeadCount: 2,
      chargedCents: 0,
      balanceCents: 0,
      shortfallCents: 0,
      lines: [{ channelId: 'postcard', mailed: true, quantity: 0, unitStudentPriceCents: 109, studentPriceCents: 0 }],
    },
  }));
  assert.match(zero, /Count is 0 because none of the 2 selected properties have a street, city, state, and ZIP/);
});
