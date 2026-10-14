const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../netlify/functions/rentcast-comps');
const { createMemoryStore } = require('./helpers/memory-store');
const { loadFixture } = require('../netlify/functions/_Lib/rentcast-client');

const NOW = new Date('2026-10-12T15:00:00.000Z');
const ADDRESS = '733 N Main St, Crown Point, IN 46307';

const EMPIRE = { auth: { email: 'member@example.com' }, planConnections: [{ planId: 'pln_founding-member-a1p70rff', status: 'ACTIVE', payment: { priceId: 'prc_founding-member-997-due-today-97-mo-starts-in-30-days-hn1l0qov' } }] };
const FOUNDATION_ONLY = { auth: { email: 'f@example.com' }, planConnections: [{ planId: 'pln_foundation--s11cv0hs9', status: 'ACTIVE' }] };
const FORGE_ZERO = { auth: { email: 'staff@example.com' }, planConnections: [{ planId: 'pln_forge-zero-psnx0aea', status: 'ACTIVE' }] };
const ADMIN = { auth: { email: 'john@thedessauergroup.com' }, planConnections: EMPIRE.planConnections };

function setup(opts) {
  const o = opts || {};
  const store = o.store || createMemoryStore();
  const mockCalls = [];
  const ghlCalls = [];
  const env = { RENTCAST_MOCK: '1', COMPS_PLAN: 'developer', GHL_API_KEY: 'test-ghl', GHL_LOCATION_ID: 'loc1', COMPS_ALERT_EMAILS: 'john@example.com,simon@example.com', ...(o.env || {}) };
  if (o.env) Object.keys(o.env).forEach(k => { if (o.env[k] === undefined) delete env[k]; });
  const member = o.member || EMPIRE;
  const handler = createHandler({
    env,
    store,
    now: () => NOW,
    verifyMember: async () => { if (o.unauth) { const e = new Error('Missing or malformed Authorization header'); e.statusCode = 401; throw e; } return o.memberId || 'mem_test'; },
    getMember: async () => member,
    mockResponse: (fixtureId, params) => { mockCalls.push({ fixtureId, params }); return o.mockResponse ? o.mockResponse(fixtureId, params) : null; },
    fetch: async (url, init) => {
      if (String(url).includes('leadconnectorhq')) {
        ghlCalls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
        const isUpsert = String(url).endsWith('/contacts/upsert');
        return { ok: true, status: 200, json: async () => (isUpsert ? { contact: { id: 'c_' + JSON.parse(init.body).email } } : {}) };
      }
      if (String(url).includes('api.anthropic.com')) {
        if (!o.anthropic) throw new Error('unexpected Anthropic call');
        return o.anthropic(url, init);
      }
      if (o.fetch) return o.fetch(url, init);
      throw new Error('unexpected network call to ' + url);
    },
  });
  const call = (method, payload) => handler(method === 'GET'
    ? { httpMethod: 'GET', headers: { authorization: 'Bearer t' }, queryStringParameters: payload }
    : { httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(payload) })
    .then(r => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') }));
  return { store, mockCalls, ghlCalls, handler, call, env };
}

test('mock mode returns a full report from fixtures, through the budget pipeline', async () => {
  const t = setup();
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 200);
  assert.equal(r.body.demo, true);
  assert.ok(r.body.reportId);
  assert.equal(r.body.report.arv, 261000);
  assert.equal(r.body.report.confidence, 'High');
  assert.equal(r.body.report.compCount, 5);
  assert.deepEqual(r.body.avm, { price: 262000, low: 238000, high: 289000 });
  assert.equal(r.body.subject.sqft, 1650);
  assert.equal(r.body.property.owner.names[0], 'T. Alvarez');
  assert.deepEqual(r.body.cached, { subject: false, sold: false, value: false });
  assert.equal(t.mockCalls.length, 3);
  assert.equal(t.store.budget.get('2026-10').calls, 3);
  assert.equal(t.store.calls.filter(c => !c.cache_hit).length, 3);
  // The subject is never comped against itself.
  assert.ok(!r.body.comps.some(c => c.address === ADDRESS));
});

test('a second identical request is a cache hit at $0 — also for address variants', async () => {
  const t = setup();
  await t.call('POST', { action: 'comp', address: ADDRESS });
  const r2 = await t.call('POST', { action: 'comp', address: ADDRESS });
  const r3 = await t.call('POST', { action: 'comp', address: '733 NORTH MAIN STREET, CROWN POINT, IN 46307' });
  assert.deepEqual(r2.body.cached, { subject: true, sold: true, value: true });
  assert.deepEqual(r3.body.cached, { subject: true, sold: true, value: true });
  assert.equal(t.mockCalls.length, 3);                       // no new upstream calls
  assert.equal(t.store.budget.get('2026-10').calls, 3);     // budget untouched
  const hits = t.store.calls.filter(c => c.cache_hit);
  assert.equal(hits.length, 6);
  assert.ok(hits.every(h => h.cost_usd === 0));
});

test('refresh bypasses the cache for one section only (1 lookup)', async () => {
  const t = setup();
  await t.call('POST', { action: 'comp', address: ADDRESS });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS, refresh: 'value' });
  assert.deepEqual(r.body.cached, { subject: true, sold: true, value: false });
  assert.equal(t.mockCalls.length, 4);
});

test('cap $0.01 returns 402 budget_cap and makes no RentCast call (plan with a base fee)', async () => {
  const t = setup({ env: { COMPS_PLAN: 'foundation', COMPS_MONTHLY_CAP_USD: '0.01' } });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 402);
  assert.equal(r.body.error, 'budget_cap');
  assert.equal(t.mockCalls.length, 0);
});

test('cap $0.01 on the developer plan blocks once the 50 free calls are used', async () => {
  const store = createMemoryStore();
  store.budget.set('2026-10', { month: '2026-10', calls: 50, spend_usd: 0, cap_usd: 0.01, alert_80_sent: false, alert_100_sent: false, alert_1000_sent: false });
  const t = setup({ store, env: { COMPS_MONTHLY_CAP_USD: '0.01' } });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 402);
  assert.equal(t.mockCalls.length, 0);
});

test('cached reports still work when the cap is reached', async () => {
  const store = createMemoryStore();
  await setup({ store }).call('POST', { action: 'comp', address: ADDRESS });       // fills the cache
  const capped = setup({ store, env: { COMPS_PLAN: 'foundation', COMPS_MONTHLY_CAP_USD: '0.01' } });
  const r = await capped.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 200);
  assert.equal(r.body.report.arv, 261000);
  assert.equal(capped.mockCalls.length, 0);
});

test('budget check failure fails closed: 503 and no RentCast call', async () => {
  const store = createMemoryStore({ failReserve: true });
  const t = setup({ store });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'budget_check_failed');
  assert.equal(t.mockCalls.length, 0);
});

test('unauthenticated → 401; non-Empire → 403; FORGE Zero → 403', async () => {
  assert.equal((await setup({ unauth: true }).call('POST', { action: 'comp', address: ADDRESS })).status, 401);
  const f = await setup({ member: FOUNDATION_ONLY }).call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(f.status, 403); assert.equal(f.body.error, 'not_empire');
  const z = await setup({ member: FORGE_ZERO }).call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(z.status, 403);
});

test('admins pass the tier gate even on FORGE Zero (admin-only testing period)', async () => {
  const adminOnZero = { auth: { email: 'john@thedessauergroup.com' }, planConnections: [{ planId: 'pln_forge-zero-psnx0aea', status: 'ACTIVE' }] };
  assert.equal((await setup({ member: adminOnZero }).call('POST', { action: 'comp', address: ADDRESS })).status, 200);
});

test('Beta $97 members get comps (John, Oct 12)', async () => {
  const beta = { auth: { email: 'b@example.com' }, planConnections: [{ planId: 'pln_-97-direct--jx9b09ut', status: 'ACTIVE', payment: { priceId: 'prc_-97-direct-ka9b0lq3' } }] };
  assert.equal((await setup({ member: beta }).call('POST', { action: 'comp', address: ADDRESS })).status, 200);
});

test('cancelled or past-due Empire plans do not get lookups', async () => {
  const cancelled = { auth: { email: 'x@example.com' }, planConnections: [{ planId: 'pln_foundation-empire-eh1bv0h3e', status: 'CANCELED' }] };
  assert.equal((await setup({ member: cancelled }).call('POST', { action: 'comp', address: ADDRESS })).status, 403);
});

test('80% alert fires once and tags John and Simon in GHL without sending tags in the upsert', async () => {
  // Cap $1, every call $0.20: the 4th live call reaches $0.80.
  const store = createMemoryStore();
  store.budget.set('2026-10', { month: '2026-10', calls: 50, spend_usd: 0, cap_usd: 1, alert_80_sent: false, alert_100_sent: false, alert_1000_sent: false });
  const t = setup({ store, env: { COMPS_MONTHLY_CAP_USD: '1' } });
  await t.call('POST', { action: 'comp', address: ADDRESS });                               // 3 calls → $0.60
  assert.equal(t.ghlCalls.length, 0);
  await t.call('POST', { action: 'comp', address: '801 N Main St, Crown Point, IN 46307' }); // calls 4,5 allowed ($1.00), 6th refused
  const tagAdds = t.ghlCalls.filter(c => c.method === 'POST' && c.url.endsWith('/tags'));
  const tags = tagAdds.map(c => c.body.tags[0]);
  assert.equal(tags.filter(x => x === 'forge-comps-budget-80').length, 2);   // one per alert contact
  assert.equal(tags.filter(x => x === 'forge-comps-budget-100').length, 2);
  t.ghlCalls.filter(c => c.url.endsWith('/contacts/upsert')).forEach(c => assert.equal(c.body.tags, undefined));
  // A later request in the same month does not re-send.
  const before = t.ghlCalls.length;
  await t.call('POST', { action: 'comp', address: '615 N East St, Crown Point, IN 46307' });
  assert.equal(t.ghlCalls.length, before);
  assert.equal(store.budget.get('2026-10').alert_80_sent, true);
});

test('demo mode (no key): fixtures served directly, cache and budget untouched', async () => {
  const t = setup({ env: { RENTCAST_MOCK: undefined, RENTCAST_API_KEY: undefined } });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 200);
  assert.equal(r.body.demo, true);
  assert.equal(r.body.report.arv, 261000);
  assert.equal(t.store.budget.size, 0);
  assert.equal(t.store.calls.length, 0);
  assert.equal(t.store.cache.size, 0);
});

test('partial results: one section failing returns the rest plus a section error, and the reservation is released', async () => {
  const t = setup({ mockResponse: id => (id === 'avm/value' ? { ok: false, status: 500, error: 'HTTP 500' } : null) });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 200);
  assert.equal(r.body.avm, null);
  assert.equal(r.body.sectionErrors.value.status, 500);
  assert.equal(r.body.report.arv, 261000);                       // recorded sales still produce an ARV
  assert.equal(t.store.budget.get('2026-10').calls, 2);          // failed call not billed
  assert.ok(t.store.calls.some(c => c.http_status === 500));     // but still logged
});

test('address not found → 404', async () => {
  const t = setup({ mockResponse: () => ({ ok: false, status: 404, error: 'not found' }) });
  const r = await t.call('POST', { action: 'comp', address: '1 Nowhere Rd, Nowhere, IN 46000' });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'address_not_found');
});

test('rate limited everywhere → 429', async () => {
  const t = setup({ mockResponse: () => ({ ok: false, status: 429, error: 'rate limited' }) });
  assert.equal((await t.call('POST', { action: 'comp', address: ADDRESS })).status, 429);
});

test('rent and market load lazily (1 call each) and are cached', async () => {
  const t = setup();
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  const rent = await t.call('POST', { action: 'rent', reportId: c.body.reportId });
  assert.equal(rent.body.rent.rent, 1850);
  const market = await t.call('POST', { action: 'market', reportId: c.body.reportId });
  assert.equal(market.body.market.zipCode, '46307');
  assert.equal(t.mockCalls.length, 5);
  const mParams = t.mockCalls.find(m => m.fixtureId === 'markets').params;
  assert.deepEqual(mParams, { zipCode: '46307', dataType: 'All', historyRange: 12 });
  const again = await t.call('POST', { action: 'rent', reportId: c.body.reportId });
  assert.equal(again.body.cached, true);
  assert.equal(t.mockCalls.length, 5);
});

test('sold comps are pulled once, wide (2 mi / 365 days); expansion inside that is refused as not needed', async () => {
  const t = setup();
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  const sold = t.mockCalls.find(m => m.fixtureId === 'properties:sold').params;
  assert.deepEqual(sold, { address: ADDRESS, radius: 2, saleDateRange: 365, limit: 500 });
  assert.deepEqual(c.body.pulled, { radius: 2, soldWithinDays: 365, listings: true });
  const notNeeded = await t.call('POST', { action: 'expand', reportId: c.body.reportId, radius: 1.5, soldWithinDays: 180 });
  assert.equal(notNeeded.status, 400);
  const wider = await t.call('POST', { action: 'expand', reportId: c.body.reportId, radius: 3 });
  assert.equal(wider.status, 200);
  assert.equal(t.mockCalls.length, 4);
  assert.equal(t.mockCalls[3].params.radius, 3);
});

test('update recomputes ARV server-side from cache with no RentCast call', async () => {
  const t = setup();
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  const u = await t.call('POST', { action: 'update', reportId: c.body.reportId, selection: { manual: { '1012-N-Court-St,-Crown-Point,-IN-46307': false }, adjustments: { adjRate: 200 } } });
  assert.equal(u.status, 200);
  // adjRate clamps to 50: 261,000/265,700/250,800/260,400 at $50 → see engine tests for the method
  assert.equal(u.body.report.adjRate, 50);
  assert.equal(u.body.report.compCount, 4);
  assert.equal(t.mockCalls.length, 3);
  assert.equal(t.store.reports.get(c.body.reportId).comp_count, 4);
});

test('share link renders read-only with no RentCast call and no owner data; revoke works', async () => {
  const t = setup();
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  const s = await t.call('POST', { action: 'share', reportId: c.body.reportId });
  assert.ok(s.body.token && s.body.token.length >= 20);
  const callsBefore = t.mockCalls.length;
  // Public route: no auth needed.
  const pub = await setup({ store: t.store, unauth: true }).call('GET', { action: 'report', token: s.body.token });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.shared, true);
  assert.equal(pub.body.report.report.arv, 261000);
  const text = JSON.stringify(pub.body);
  assert.ok(!text.includes('Alvarez'), 'owner name must not appear in a shared report');
  assert.ok(!text.includes('taxAssessments'), 'tax data must not appear in a shared report');
  assert.equal(t.mockCalls.length, callsBefore);
  await t.call('POST', { action: 'revoke', reportId: c.body.reportId });
  assert.equal((await t.call('GET', { action: 'report', token: s.body.token })).status, 404);
});

test("members cannot read or change another member's report", async () => {
  const store = createMemoryStore();
  const a = setup({ store, memberId: 'mem_a' });
  const c = await a.call('POST', { action: 'comp', address: ADDRESS });
  const b = setup({ store, memberId: 'mem_b' });
  assert.equal((await b.call('POST', { action: 'share', reportId: c.body.reportId })).status, 404);
  assert.equal((await b.call('POST', { action: 'rent', reportId: c.body.reportId })).status, 404);
});

test('per-member monthly limit is off by default and enforced when set', async () => {
  const off = setup();
  for (const a of ['1 A St, Crown Point, IN 46307', '2 B St, Crown Point, IN 46307']) assert.equal((await off.call('POST', { action: 'comp', address: a })).status, 200);
  // Limit 4: the first comp uses 3 lookups; the second gets exactly 1 more
  // (partial result), never 3 — parallel sections cannot overshoot.
  const store = createMemoryStore();
  const on = setup({ store, env: { COMPS_MEMBER_MONTHLY_LIMIT: '4' } });
  assert.equal((await on.call('POST', { action: 'comp', address: '1 A St, Crown Point, IN 46307' })).status, 200);
  const partial = await on.call('POST', { action: 'comp', address: '2 B St, Crown Point, IN 46307' });
  assert.equal(partial.status, 200);
  assert.equal(Object.values(partial.body.sectionErrors).filter(e => e.error === 'member_limit').length, 2);
  assert.equal(store.calls.filter(c => !c.cache_hit && c.http_status === 200).length, 4);
  const blocked = await on.call('POST', { action: 'comp', address: '3 C St, Crown Point, IN 46307' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'member_limit');
  // Cached lookups still work at the limit.
  assert.equal((await on.call('POST', { action: 'comp', address: '1 A St, Crown Point, IN 46307' })).status, 200);
});

test('usage view is admin-only and reports cache hit rate and spend', async () => {
  const store = createMemoryStore();
  const m = setup({ store });
  await m.call('POST', { action: 'comp', address: ADDRESS });
  await m.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal((await m.call('GET', { action: 'usage' })).status, 403);
  const u = await setup({ store, member: ADMIN }).call('GET', { action: 'usage' });
  assert.equal(u.status, 200);
  assert.equal(u.body.liveCalls, 3);
  assert.equal(u.body.cacheHits, 3);
  assert.equal(u.body.cacheHitRate, 50);
  assert.equal(u.body.budget.remainingLookups, 47 + 500);   // 47 free left + $100 / $0.20
});

test('live mode: sends X-Api-Key, retries once on 429, never puts the key in a response', async () => {
  const seen = [];
  let valueAttempts = 0;
  const t = setup({
    env: { RENTCAST_MOCK: undefined, RENTCAST_API_KEY: 'fake-rentcast-key-for-tests' },
    fetch: async (url, init) => {
      seen.push({ url: String(url), key: init.headers['X-Api-Key'] });
      const u = new URL(url);
      let body;
      if (u.pathname.endsWith('/avm/value')) {
        valueAttempts += 1;
        if (valueAttempts === 1) return { ok: false, status: 429, text: async () => '{"message":"slow down"}' };
        body = loadFixture('avm/value');
      } else if (u.searchParams.get('radius')) body = loadFixture('properties:sold');
      else body = loadFixture('properties:subject');
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.status, 200);
  assert.equal(r.body.demo, false);
  assert.equal(valueAttempts, 2);
  assert.ok(seen.every(s => s.key === 'fake-rentcast-key-for-tests'));
  assert.ok(seen.every(s => s.url.startsWith('https://api.rentcast.io/v1/')));
  assert.ok(!JSON.stringify(r.body).includes('fake-rentcast-key-for-tests'));
  assert.ok(!JSON.stringify(t.store.calls).includes('fake-rentcast-key-for-tests'));
  assert.equal(t.store.budget.get('2026-10').calls, 3);   // retry used the same reservation
});

test('save-crm is stubbed for Phase 4', async () => {
  assert.equal((await setup().call('POST', { action: 'save-crm' })).status, 501);
});


// ── Phase 3: ARIS best use ─────────────────────────────────────────────
const GOOD_ARIS = JSON.stringify({ ranked: [
  { strategy: 'Rental', score: 81, reasons: ['Rent-to-value near 0.7%', 'ARV within 1% of the FORGE Cast value'] },
  { strategy: 'Flip', score: 64, reasons: ['Thin spread to ARV without a purchase price', 'Steady 12-month price trend'] },
  { strategy: 'Wholesale', score: 55, reasons: ['Needs a deep discount to leave room for a buyer'] },
  { strategy: 'Hold', score: 50, reasons: ['Appreciation modest'] },
  { strategy: 'STR', score: 30, reasons: ['No STR demand data provided'] },
], caveats: ['No repair estimate or purchase price was provided.'] });

function arisReply(text, calls) {
  return async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) }; };
}

test('best use: strict JSON ranked, cached on the report, second request makes no ARIS call', async () => {
  const calls = [];
  const t = setup({ env: { ANTHROPIC_API_KEY: 'test-anthropic' }, anthropic: arisReply(GOOD_ARIS, calls) });
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  const r1 = await t.call('POST', { action: 'best-use', reportId: c.body.reportId, equity: 112000 });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.cached, false);
  assert.deepEqual(r1.body.result.ranked.map(x => x.strategy), ['Rental', 'Flip', 'Wholesale', 'Hold', 'STR']);
  assert.equal(r1.body.result.caveats.length, 1);
  const r2 = await t.call('POST', { action: 'best-use', reportId: c.body.reportId, equity: 112000 });
  assert.equal(r2.body.cached, true);
  assert.equal(calls.length, 1);
  assert.equal(t.mockCalls.length, 3);          // no RentCast lookup for best use
  assert.ok(t.store.reports.get(c.body.reportId).best_use.hash);
});

test('best use sends only the computed summary — no owner, address or member data', async () => {
  const calls = [];
  const t = setup({ env: { ANTHROPIC_API_KEY: 'test-anthropic' }, anthropic: arisReply(GOOD_ARIS, calls) });
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  await t.call('POST', { action: 'rent', reportId: c.body.reportId });
  await t.call('POST', { action: 'market', reportId: c.body.reportId });
  await t.call('POST', { action: 'best-use', reportId: c.body.reportId, equity: 112000 });
  const sent = JSON.stringify(calls[0]);
  ['Alvarez', '733 N Main', 'mem_test', 'member@example.com', 'mailingAddress', 'taxAssessments'].forEach(x => assert.ok(!sent.includes(x), 'leaked ' + x));
  const summary = JSON.parse(calls[0].messages[0].content.split('\n').slice(1).join('\n'));
  assert.equal(summary.arv, 261000);
  assert.equal(summary.monthlyRent, 1850);
  assert.equal(summary.estimatedEquity, 112000);
  assert.equal(summary.zipMedianDaysOnMarket, 32);
  assert.ok(summary.zipPriceTrend12moPct > 0);
  assert.equal(calls[0].model, 'claude-sonnet-4-6');
});

test('best use re-asks when the summary changes (rent loaded later)', async () => {
  const calls = [];
  const t = setup({ env: { ANTHROPIC_API_KEY: 'k' }, anthropic: arisReply(GOOD_ARIS, calls) });
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  await t.call('POST', { action: 'best-use', reportId: c.body.reportId });
  await t.call('POST', { action: 'rent', reportId: c.body.reportId });
  const again = await t.call('POST', { action: 'best-use', reportId: c.body.reportId });
  assert.equal(again.body.cached, false);
  assert.equal(calls.length, 2);
});

test('best use tolerates code fences, rejects junk, and needs an API key', async () => {
  const fenced = setup({ env: { ANTHROPIC_API_KEY: 'k' }, anthropic: arisReply('Here you go:\n```json\n' + GOOD_ARIS + '\n```', []) });
  const c1 = await fenced.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal((await fenced.call('POST', { action: 'best-use', reportId: c1.body.reportId })).status, 200);
  const junk = setup({ env: { ANTHROPIC_API_KEY: 'k' }, anthropic: arisReply('I think a rental is best!', []) });
  const c2 = await junk.call('POST', { action: 'comp', address: ADDRESS });
  const r = await junk.call('POST', { action: 'best-use', reportId: c2.body.reportId });
  assert.equal(r.status, 502); assert.equal(r.body.error, 'best_use_unavailable');
  const nokey = setup();
  const c3 = await nokey.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal((await nokey.call('POST', { action: 'best-use', reportId: c3.body.reportId })).status, 503);
});

test('best use in demo mode uses a sanitized client summary', async () => {
  const calls = [];
  const t = setup({ env: { RENTCAST_MOCK: undefined, RENTCAST_API_KEY: undefined, ANTHROPIC_API_KEY: 'k' }, anthropic: arisReply(GOOD_ARIS, calls) });
  const r = await t.call('POST', { action: 'best-use', summary: { arv: 261000, sqft: 1650, propertyType: 'Single Family', ownerName: 'T. Alvarez', evil: '<script>' } });
  assert.equal(r.status, 200);
  const sent = calls[0].messages[0].content;
  assert.ok(!sent.includes('Alvarez') && !sent.includes('script'));
});

test('parseResult: drops unknown strategies and duplicates, clamps scores, caps reasons', () => {
  const { parseResult } = require('../netlify/functions/_Lib/comps-best-use');
  const out = parseResult(JSON.stringify({ ranked: [
    { strategy: 'flip', score: 140, reasons: ['a', 'b', 'c', 'd'] },
    { strategy: 'Flip', score: 10, reasons: ['dup'] },
    { strategy: 'Timeshare', score: 90, reasons: ['x'] },
    { strategy: 'Hold', score: -5, reasons: [] },
    { strategy: 'Rental', score: 70, reasons: ['r'] },
  ], caveats: 'not an array' }));
  assert.deepEqual(out.ranked.map(r => [r.strategy, r.score, r.reasons.length]), [['Flip', 100, 3], ['Rental', 70, 1]]);
  assert.deepEqual(out.caveats, []);
  assert.equal(parseResult('no json here'), null);
});

test('shared reports never include owner data, even after rent/market/best use', async () => {
  const t = setup({ env: { ANTHROPIC_API_KEY: 'k' }, anthropic: arisReply(GOOD_ARIS, []) });
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  await t.call('POST', { action: 'rent', reportId: c.body.reportId });
  await t.call('POST', { action: 'best-use', reportId: c.body.reportId });
  const s = await t.call('POST', { action: 'share', reportId: c.body.reportId });
  const pub = await setup({ store: t.store, unauth: true }).call('GET', { action: 'report', token: s.body.token });
  const text = JSON.stringify(pub.body);
  ['Alvarez', 'mailingAddress', 'taxAssessments', 'propertyTaxes', 'ownerOccupied'].forEach(x => assert.ok(!text.includes(x), x));
});

// ── FORGE Cast fix (Oct 13): fact sources, honest no-record, 1-lookup retry ──
test('fact sources: lead numbers are labeled, and the public record is kept for comparison', async () => {
  const t = setup();
  const r = await t.call('POST', { action: 'comp', address: ADDRESS, overrides: { beds: 5, baths: 5, sqft: 6000 } });
  const s = r.body.subject;
  assert.equal(s.sqft, 6000);
  assert.deepEqual(s.factSources, { beds: 'lead', baths: 'lead', sqft: 'lead', yearBuilt: 'record', propertyType: 'record' });
  assert.deepEqual(s.recordFacts, { beds: 3, baths: 2, sqft: 1650, yearBuilt: 1978 });
  const plain = await setup().call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(plain.body.subject.factSources.sqft, 'record');
});

test('no public record: FORGE Cast spelling is suggested, and retry-record costs exactly 1 lookup', async () => {
  const subjectFix = loadFixture('properties:subject');
  let subjectCalls = 0;
  const t = setup({ mockResponse: (id, params) => {
    if (id === 'properties:subject') {
      subjectCalls += 1;
      return params.address === '733 N Main St, Crown Point, IN 46307' ? { ok: true, status: 200, data: subjectFix } : { ok: false, status: 404, error: 'not found' };
    }
    return null;
  } });
  const r = await t.call('POST', { action: 'comp', address: '733 North Main Street, Crown Pt, IN 46307' });
  assert.equal(r.status, 200);
  assert.equal(r.body.noPublicRecord, true);
  assert.equal(r.body.suggestedAddress, '733 N Main St, Crown Point, IN 46307');
  assert.equal(r.body.subject.factSources.sqft, 'forgecast');
  const before = t.mockCalls.length;
  const retry = await t.call('POST', { action: 'retry-record', reportId: r.body.reportId, address: r.body.suggestedAddress });
  assert.equal(retry.status, 200);
  assert.equal(t.mockCalls.length - before, 1);                 // only the record search
  assert.equal(retry.body.property.owner.names[0], 'T. Alvarez');
  assert.equal(retry.body.subject.factSources.sqft, 'record');
  assert.equal(retry.body.report.arv, 261000);
  assert.ok(t.store.reports.get(r.body.reportId).sources.subject);
});

test('no suggestion when FORGE Cast found the same address; retry 404 is explained', async () => {
  const t = setup({ mockResponse: id => (id === 'properties:subject' ? { ok: false, status: 404, error: 'not found' } : null) });
  const r = await t.call('POST', { action: 'comp', address: ADDRESS });
  assert.equal(r.body.noPublicRecord, true);
  assert.equal(r.body.suggestedAddress, null);
  const retry = await t.call('POST', { action: 'retry-record', reportId: r.body.reportId, address: '733 N Main St, Crown Point, IN 46307' });
  assert.equal(retry.status, 404);
  assert.equal(retry.body.error, 'no_record');
});

test('best use calls the valuation "FORGE Cast" and never names the vendor', async () => {
  const calls = [];
  const t = setup({ env: { ANTHROPIC_API_KEY: 'k' }, anthropic: arisReply(GOOD_ARIS, calls) });
  const c = await t.call('POST', { action: 'comp', address: ADDRESS });
  await t.call('POST', { action: 'best-use', reportId: c.body.reportId });
  const sent = JSON.stringify(calls[0]);
  assert.ok(sent.includes('forgeCastValue') && sent.includes('FORGE Cast value'));
  assert.ok(!/rentcast/i.test(sent.replace(/never name any other data provider/g, '')), 'vendor name sent to ARIS');
});
