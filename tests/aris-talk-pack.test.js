const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const talk = require('../assets/js/aris-talk');
const checkoutApi = require('../netlify/functions/_Lib/aris-talk-pack-http');
const webhookApi = require('../netlify/functions/_Lib/aris-talk-pack-webhook-http');

const root = path.join(__dirname, '..');
const SECRET = 'whsec_talk_pack_test';

function sign(body, secret) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
  return 't=' + t + ',v1=' + v1;
}

function rig(opts) {
  const o = opts || {};
  const store = o.store || talk.createMemoryStore(o.seed);
  const calls = [];
  const env = Object.assign({
    TALK_MODE_ENABLED: 'true',
    MARKETING_STRIPE_SECRET_KEY: 'sk_test_talk_pack',
    TALK_PACK_STRIPE_WEBHOOK_SECRET: SECRET,
    ARIS_TALK_CAP_MINUTES: '1',
  }, o.env || {});
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'cs_test_talk', url: 'https://checkout.stripe.com/c/pay/cs_test_talk' }),
    };
  };
  const checkout = checkoutApi.createHandler({
    env: env,
    store: store,
    fetch: fetchImpl,
    origin: 'https://forgedbyaris.com',
    now: () => new Date('2026-11-27T18:00:00Z'),
    enforceMembership: async () => ({ access: { memberId: o.memberId || 'mem_student', active: true } }),
    getMember: async () => ({ id: 'mem_student', auth: { email: 'student@example.com' } }),
  });
  const webhook = webhookApi.createHandler({ env: env, store: store });
  async function call(handler, body, extra) {
    const more = extra || {};
    const raw = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const res = await handler(Object.assign({
      httpMethod: more.method || 'POST',
      headers: Object.assign({ authorization: 'Bearer tok' }, more.headers || {}),
      body: raw,
      queryStringParameters: {},
    }, more));
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, raw: res.body };
  }
  return { store: store, calls: calls, call: call, checkout: checkout, webhook: webhook, env: env };
}

async function fillCap(store) {
  await store.add({
    memberId: 'mem_student',
    monthKey: '2026-11',
    listenSeconds: 60,
    speakSeconds: 0,
    capSeconds: 60,
    requestId: 'fill',
    maxChunkSeconds: 180,
  });
}

test('checkout is offered only at the cap, in test mode, with tax left off', async () => {
  const open = rig();
  const early = await open.call(open.checkout, { action: 'checkout' });
  assert.equal(early.status, 403);
  assert.match(early.body.error, /used your Talk Mode time/);
  assert.equal(open.calls.length, 0);

  await fillCap(open.store);
  const started = await open.call(open.checkout, { action: 'checkout' });
  assert.equal(started.status, 200);
  assert.equal(started.body.testMode, true);
  assert.match(started.body.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(JSON.stringify(started.body).includes('sk_'), false);

  const params = new URLSearchParams(open.calls[0].init.body);
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('automatic_tax[enabled]'), 'false');
  assert.equal(params.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '1997');
  assert.equal(params.get('line_items[0][price_data][product_data][name]'), 'Talk Mode extra minutes (test)');
  assert.equal(params.get('metadata[purpose]'), 'talk-extra-minutes');
  assert.equal(params.get('metadata[member_id]'), 'mem_student');
  assert.equal(params.get('metadata[minutes]'), '60');
  assert.equal(params.get('metadata[month_key]'), '2026-11');
  assert.equal(params.get('metadata[amount_cents]'), '1997');
  assert.equal(params.get('metadata[product]'), 'prod_Vi0PsLX2Yfw3y9');
  assert.equal(params.get('metadata[price]'), 'price_1UgaOnK4zh6RSWCry84qZAnS');
  assert.match(params.get('success_url'), /\{CHECKOUT_SESSION_ID\}/);
  assert.equal(params.get('line_items[0][price_data][tax_behavior]'), null);
  assert.equal(/tax_behavior|tax_code/.test(open.calls[0].init.body), false);
  assert.equal(open.calls[0].init.headers.Authorization.includes('sk_test_talk_pack'), true);

  const staff = rig({
    env: { TALK_MODE_UNLIMITED: 'mem_student', ARIS_TALK_CAP_MINUTES: '1' },
  });
  await fillCap(staff.store);
  const skipped = await staff.call(staff.checkout, { action: 'checkout' });
  assert.equal(skipped.status, 403);
  assert.equal(staff.calls.length, 0);
});

test('a live key is refused unless TALK_PACK_LIVE_CHECKOUT is true', async () => {
  const refused = rig({
    env: { MARKETING_STRIPE_SECRET_KEY: 'sk_live_not_for_this_pack' },
  });
  await fillCap(refused.store);
  const blocked = await refused.call(refused.checkout, { action: 'checkout' });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.reason, 'live_key_refused');
  assert.equal(JSON.stringify(blocked.body).includes('sk_live'), false);
  assert.equal(refused.calls.length, 0);

  const allowed = rig({
    env: {
      MARKETING_STRIPE_SECRET_KEY: 'sk_live_not_for_this_pack',
      TALK_PACK_LIVE_CHECKOUT: 'true',
    },
  });
  await fillCap(allowed.store);
  const started = await allowed.call(allowed.checkout, { action: 'checkout' });
  assert.equal(started.status, 200);
  assert.equal(started.body.testMode, false);
  const params = new URLSearchParams(allowed.calls[0].init.body);
  assert.equal(params.get('line_items[0][price_data][product_data][name]'), 'Talk Mode extra minutes');
});

test('the webhook credits this month once and ignores anything else', async () => {
  const { store, call, webhook } = rig();
  const event = {
    id: 'evt_talk',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: 'cs_test_talk',
        payment_status: 'paid',
        amount_total: 1997,
        client_reference_id: 'mem_student',
        metadata: {
          purpose: 'talk-extra-minutes',
          member_id: 'mem_student',
          minutes: '60',
          month_key: '2026-11',
          amount_cents: '1997',
        },
      },
    },
  };
  const raw = JSON.stringify(event);
  const paid = await call(webhook, raw, { headers: { 'stripe-signature': sign(raw, SECRET) } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.credited, true);
  assert.equal(paid.body.packSeconds, 3600);
  const row = await store.read('mem_student', '2026-11');
  assert.equal(row.packSeconds, 3600);

  const again = await call(webhook, raw, { headers: { 'stripe-signature': sign(raw, SECRET) } });
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.credited, false);
  assert.equal((await store.read('mem_student', '2026-11')).packSeconds, 3600);

  const other = JSON.stringify(Object.assign({}, event, {
    data: { object: Object.assign({}, event.data.object, { metadata: { purpose: 'skip-trace-credits' } }) },
  }));
  const ignored = await call(webhook, other, { headers: { 'stripe-signature': sign(other, SECRET) } });
  assert.equal(ignored.body.ignored, true);

  const wrongAmount = JSON.stringify(Object.assign({}, event, {
    data: { object: Object.assign({}, event.data.object, { id: 'cs_test_other', amount_total: 1000 }) },
  }));
  const rejected = await call(webhook, wrongAmount, { headers: { 'stripe-signature': sign(wrongAmount, SECRET) } });
  assert.equal(rejected.status, 400);
  assert.equal((await store.read('mem_student', '2026-11')).packSeconds, 3600);

  const live = JSON.stringify(Object.assign({}, event, { livemode: true, data: { object: Object.assign({}, event.data.object, { id: 'cs_live_no' }) } }));
  const held = await call(webhook, live, { headers: { 'stripe-signature': sign(live, SECRET) } });
  assert.equal(held.body.ignored, true);
  assert.equal((await store.read('mem_student', '2026-11')).packSeconds, 3600);

  const badSig = await call(webhook, raw, { headers: { 'stripe-signature': sign(raw, 'wrong') } });
  assert.equal(badSig.status, 400);
});

test('pack routes, SQL, and the functions stay free of createRequire and student-facing vendor names', () => {
  const sql = fs.readFileSync(path.join(root, 'sql/migrations/add-aris-talk-packs.sql'), 'utf8');
  assert.match(sql, /credit_aris_talk_pack/);
  assert.match(sql, /pack_seconds/);
  assert.match(sql, /3600/);
  assert.match(sql, /1997/);
  assert.match(sql, /aris_talk_pack_credits/);
  assert.match(sql, /add-aris-talk-usage\.sql first/);

  const files = [
    'netlify/functions/aris-talk-pack.js',
    'netlify/functions/aris-talk-pack-webhook.js',
    'netlify/functions/_Lib/aris-talk-pack-http.js',
    'netlify/functions/_Lib/aris-talk-pack-webhook-http.js',
    'netlify/functions/_Lib/aris-talk-pack-stripe.js',
    'assets/js/aris-talk-session.js',
  ];
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(source), false, file);
  });

  const copy = JSON.stringify(talk.COPY);
  assert.equal(/stripe|memberstack|supabase|elevenlabs|scribe/i.test(copy), false);
  const doc = fs.readFileSync(path.join(root, 'docs/ARIS-TALK-MODE.md'), 'utf8');
  assert.match(doc, /TALK_PACK_LIVE_CHECKOUT/);
  assert.match(doc, /TALK_MOGUL_MEMBER_IDS/);
  assert.match(doc, /realwiseacademy\.com is not in this repository/);
  assert.match(doc, /4242 4242 4242 4242/);
});
