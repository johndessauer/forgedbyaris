const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const shared = require('../assets/js/skip-trace-shared');
const present = require('../netlify/functions/_Lib/skip-trace-present');
const storeLib = require('../netlify/functions/_Lib/skip-trace-store');
const lookupApi = require('../netlify/functions/_Lib/skip-trace-http');
const creditsApi = require('../netlify/functions/_Lib/skip-trace-credits-http');
const webhookApi = require('../netlify/functions/_Lib/skip-trace-webhook-http');
const contacts = require('../netlify/functions/_Lib/contact-fields');
const { createMemoryStore } = storeLib;

const SECRET = 'whsec_skip_trace_test';
const PERSON = {
  first_name: 'Jane',
  last_name: 'Doe',
  full_name: 'Jane Doe',
  deceased: false,
  property_owner: true,
  litigator: false,
  mailing_address: { street: 'PO Box 111', city: 'Austin', state: 'TX', zip: '78702' },
  phones: [
    { number: '5125550100', type: 'Mobile', dnc: false, tcpa: false, carrier: 'Example Wireless', rank: 1 },
    { number: '5125550200', type: 'Landline', dnc: true, tcpa: true, carrier: 'Example Tel', rank: 2 },
  ],
  emails: [{ email: 'jane.doe@example.com', rank: 1 }],
};

function sign(body, secret) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
  return 't=' + t + ',v1=' + v1;
}

function hitPayload(address) {
  return {
    address: address,
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    find_owner: true,
    hit: true,
    persons_count: 1,
    credits_deducted: 5,
    persons: [PERSON],
    meta: { request_id: 'req_test', timestamp: '2026-11-25T12:00:00Z', api_version: '2026-03-21' },
  };
}

function rig(opts) {
  const o = opts || {};
  const store = o.store || createMemoryStore();
  const calls = [];
  const env = Object.assign({
    TRACERFY_API_KEY: 'sandbox_test_token',
    TRACERFY_BASE_URL: 'https://mock.tracerfy.com',
    MARKETING_STRIPE_SECRET_KEY: 'sk_test_skip',
    SKIP_TRACE_STRIPE_WEBHOOK_SECRET: SECRET,
    SKIP_TRACE_MEMBER_DAILY_CAP: '25',
    SKIP_TRACE_MONTHLY_VENDOR_CAP: '2000',
  }, o.env || {});
  const empire = o.empire !== false;
  const enforceMembership = async (event, gate) => {
    if (!empire || (gate && gate.need === 'empire' && o.foundation)) {
      return { response: { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Empire membership required' }) } };
    }
    return { access: { memberId: o.memberId || 'mem_empire', empire: true, active: true } };
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: init });
    if (o.fetch) return o.fetch(url, init, calls);
    if (String(url).indexOf('api.stripe.com') !== -1) {
      return { ok: true, status: 200, json: async () => ({ id: 'cs_test_skip', url: 'https://checkout.stripe.com/c/pay/cs_test_skip' }) };
    }
    const body = JSON.parse(init.body || '{}');
    if (body.address === 'NO_CREDITS') {
      return { ok: false, status: 402, json: async () => ({ error: 'Insufficient credits. Instant trace requires 5 credits per lookup. You have 0 credits.' }) };
    }
    if (body.address === '999 Nowhere Blvd') {
      return { ok: true, status: 200, json: async () => ({ hit: false, persons: [], credits_deducted: 0, meta: { request_id: 'req_miss' } }) };
    }
    return { ok: true, status: 200, json: async () => hitPayload(body.address) };
  };
  const lookup = lookupApi.createHandler({
    env: env,
    store: store,
    fetch: fetchImpl,
    enforceMembership: enforceMembership,
    now: () => new Date('2026-11-25T15:00:00Z'),
    saveContact: async (memberId, fields) => Object.assign({ id: 'con_1', memberstack_id: memberId }, fields),
  });
  const credits = creditsApi.createHandler({
    env: env,
    store: store,
    fetch: fetchImpl,
    enforceMembership: enforceMembership,
    origin: 'https://forgedbyaris.com',
  });
  const webhook = webhookApi.createHandler({ env: env, store: store });
  async function call(handler, body, extra) {
    const more = extra || {};
    const res = await handler(Object.assign({
      httpMethod: more.method || 'POST',
      headers: Object.assign({ authorization: 'Bearer tok' }, more.headers || {}),
      body: body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body)),
      queryStringParameters: {},
    }, more));
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, raw: res.body };
  }
  return { store: store, calls: calls, call: call, lookup: lookup, credits: credits, webhook: webhook, env: env };
}

test('address key ignores punctuation and keeps owner names separate from entities', () => {
  const parsed = shared.parseAddress({ address: '123 Main St, Austin, TX 78701' });
  assert.equal(parsed.street, '123 Main St');
  assert.equal(parsed.state, 'TX');
  assert.equal(shared.addressKey(parsed), shared.addressKey({ street: '123 main st.', city: 'AUSTIN', state: 'tx', zip: '78701-1234' }));
  assert.equal(shared.looksLikeEntity('Lender REO'), true);
  assert.equal(shared.looksLikeEntity('Estate of R. Hayes'), true);
  assert.equal(shared.looksLikeEntity('Summit Homes LLC'), true);
  assert.equal(shared.looksLikeEntity('J. and R. Cole'), false);
  assert.match(shared.entityNote('Summit Homes LLC'), /may be limited/);
  assert.equal(shared.entityNote('Jane Doe'), '');
});

test('member payload drops upstream metadata and the vendor name', () => {
  const raw = hitPayload('123 Main St');
  raw.persons[0].phones[0].carrier = 'Tracerfy Mobile';
  const view = present.presentLookup(raw, { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701' }, 'Jane Doe');
  assert.equal(view.hit, true);
  assert.equal(view.persons[0].phones[0].dnc, false);
  assert.equal(view.persons[0].phones[1].dnc, true);
  assert.equal(view.persons[0].phones[1].tcpa, true);
  assert.equal(view.persons[0].litigator, false);
  assert.equal(view.persons[0].phones[0].carrier, '');
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'meta'), false);
  assert.equal(/tracerfy/i.test(JSON.stringify(view)), false);
  assert.match(view.complianceNote, /Data is not consent/);
  assert.match(view.scripts.call, /Jane/);
});

test('quote does not spend, a hit debits 20 cents, and the same address is free after that', async () => {
  const { store, lookup, call, calls } = rig();
  await store.credit({ memberId: 'mem_empire', amountCents: 1000, stripeSessionId: 'cs_seed' });
  const quote = await call(lookup, {
    action: 'quote',
    address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    ownerFirstName: 'Jane',
    ownerLastName: 'Doe',
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.quote, true);
  assert.equal(quote.body.costCents, 20);
  assert.equal(quote.body.balanceCents, 1000);
  assert.equal(calls.length, 0);

  const hit = await call(lookup, {
    action: 'lookup',
    confirm: true,
    address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    ownerFirstName: 'Jane',
    ownerLastName: 'Doe',
  });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.hit, true);
  assert.equal(hit.body.chargedCents, 20);
  assert.equal(hit.body.balanceCents, 980);
  assert.equal(hit.body.cached, false);
  assert.equal(hit.body.persons[0].phones[1].dnc, true);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.find_owner, true);
  assert.equal(sent.first_name, 'Jane');
  assert.equal(sent.last_name, 'Doe');
  assert.match(calls[0].url, /\/v1\/api\/trace\/lookup\/$/);
  assert.equal(/tracerfy/i.test(hit.raw), false);

  const again = await call(lookup, {
    action: 'lookup',
    confirm: true,
    address: '123 Main St.',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
  });
  assert.equal(again.body.cached, true);
  assert.equal(again.body.chargedCents, 0);
  assert.equal(again.body.balanceCents, 980);
  assert.equal(calls.length, 1);
});

test('a miss and an upstream 402 release the hold', async () => {
  const { store, lookup, call } = rig();
  await store.credit({ memberId: 'mem_empire', amountCents: 100, stripeSessionId: 'cs_seed' });
  const miss = await call(lookup, { action: 'lookup', confirm: true, address: '999 Nowhere Blvd', city: 'Austin', state: 'TX', zip: '78701' });
  assert.equal(miss.status, 200);
  assert.equal(miss.body.hit, false);
  assert.equal(miss.body.chargedCents, 0);
  assert.equal(miss.body.balanceCents, 100);
  assert.equal(miss.body.persons.length, 0);

  const denied = await call(lookup, { action: 'lookup', confirm: true, address: 'NO_CREDITS', city: 'Austin', state: 'TX', zip: '78701' });
  assert.equal(denied.status, 402);
  assert.match(denied.body.error, /temporarily unavailable/);
  assert.equal(/tracerfy|instant trace/i.test(denied.raw), false);
  const wallet = await store.getWallet('mem_empire');
  assert.equal(wallet.balanceCents, 100);
  assert.equal(wallet.heldCents, 0);
});

test('confirm is required, credits and caps fail cleanly, and foundation cannot look up', async () => {
  const poor = rig();
  const blocked = await poor.call(poor.lookup, { action: 'lookup', confirm: true, address: '10 Oak', city: 'Austin', state: 'TX', zip: '78701' });
  assert.equal(blocked.status, 402);
  assert.match(blocked.body.error, /credits/i);

  const capped = rig({ env: { SKIP_TRACE_MEMBER_DAILY_CAP: '1' } });
  await capped.store.credit({ memberId: 'mem_empire', amountCents: 500, stripeSessionId: 'cs_cap' });
  const first = await capped.call(capped.lookup, { action: 'lookup', confirm: true, address: '10 Oak', city: 'Austin', state: 'TX', zip: '78701' });
  assert.equal(first.status, 200);
  const second = await capped.call(capped.lookup, { action: 'lookup', confirm: true, address: '11 Oak', city: 'Austin', state: 'TX', zip: '78701' });
  assert.equal(second.status, 429);
  assert.match(second.body.error, /today/);
  const wallet = await capped.store.getWallet('mem_empire');
  assert.equal(wallet.balanceCents, 480);

  const foundation = rig({ foundation: true });
  await foundation.store.credit({ memberId: 'mem_empire', amountCents: 500, stripeSessionId: 'cs_f' });
  const no = await foundation.call(foundation.lookup, { action: 'lookup', confirm: true, address: '10 Oak', city: 'Austin', state: 'TX' });
  assert.equal(no.status, 403);
  assert.match(no.body.error, /Empire/);
});

test('checkout packs are separate from marketing and the webhook credits a session once', async () => {
  const { credits, webhook, call, calls, store } = rig();
  const session = await call(credits, { action: 'checkout', pack: '25' });
  assert.equal(session.status, 200);
  assert.match(session.body.url, /^https:\/\/checkout\.stripe\.com/);
  const params = new URLSearchParams(calls[0].init.body);
  assert.equal(params.get('metadata[purpose]'), 'skip-trace-credits');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '2500');
  assert.equal(params.get('metadata[amount_cents]'), '2500');
  assert.match(params.get('line_items[0][price_data][product_data][name]'), /skip-trace credits/);

  const event = {
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_paid_1',
      payment_status: 'paid',
      amount_total: 1000,
      client_reference_id: 'mem_empire',
      metadata: { purpose: 'skip-trace-credits', member_id: 'mem_empire', amount_cents: '1000', pack_id: '10' },
    } },
  };
  const raw = JSON.stringify(event);
  const paid = await call(webhook, raw, { headers: { 'stripe-signature': sign(raw, SECRET) } });
  assert.equal(paid.body.credited, true);
  assert.equal(paid.body.balanceCents, 1000);
  const again = await call(webhook, raw, { headers: { 'stripe-signature': sign(raw, SECRET) } });
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.balanceCents, 1000);

  const marketing = Object.assign({}, event, { data: { object: Object.assign({}, event.data.object, { id: 'cs_mkt', metadata: { purpose: 'marketing-wallet', member_id: 'mem_empire', amount_cents: '2500' } }) } });
  const rawMarketing = JSON.stringify(marketing);
  const ignored = await call(webhook, rawMarketing, { headers: { 'stripe-signature': sign(rawMarketing, SECRET) } });
  assert.equal(ignored.body.ignored, true);
  const wallet = await store.getWallet('mem_empire');
  assert.equal(wallet.balanceCents, 1000);
});

test('save contact keeps phones, flags, and outreach status', async () => {
  const extras = contacts.normalizeExtras({
    phones: [{ number: '5125550100', type: 'Mobile', dnc: false, tcpa: false, litigator: false }],
    emails: [{ email: 'jane.doe@example.com' }],
    flags: { litigator: false, dnc: false, tcpa: false, deceased: false, entityLimited: false },
    outreach_status: 'new',
    address: 'PO Box 111, Austin, TX 78702',
  });
  assert.equal(extras.error, undefined);
  assert.equal(extras.fields.phones[0].number, '5125550100');
  assert.equal(contacts.normalizeExtras({ outreach_status: 'nope' }).error.length > 0, true);

  const { lookup, call } = rig();
  const saved = await call(lookup, {
    action: 'save_contact',
    person: present.presentLookup(hitPayload('123 Main St'), { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701' }, 'Jane Doe').persons[0],
    property: { address: '123 Main St', city: 'Austin', state: 'TX', zip: '78701' },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.contact.type, undefined);
  assert.equal(saved.body.contact.outreach_status, 'new');
  assert.equal(saved.body.contact.phones[1].dnc, true);
  assert.equal(saved.body.contact.phone, '5125550100');
});

test('member-facing files do not name the lookup vendor', () => {
  const files = [
    'assets/js/skip-trace-shared.js',
    'assets/js/skip-trace-ui.js',
    'assets/js/property-command.js',
    'property-search.html',
    'deal-analyzer.html',
    'profile.html',
    'aris-coach.html',
    'crm.html',
    'market-oracle.html',
  ];
  files.forEach(function (file) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(/tracerfy/i.test(text), false, file);
  });
});
