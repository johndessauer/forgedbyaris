const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../netlify/functions/_Lib/comps-core');
const { createMemoryStore } = require('./helpers/memory-store');

test('address variants normalize to the same string and the same cache key', () => {
  const variants = [
    '123 Main St., Crown Point, IN 46307',
    '123 MAIN STREET, CROWN POINT, IN 46307-1234',
    '  123  main   st , crown point,  in 46307 ',
    '123 Main St, Crown Point, IN 46307, USA',
  ];
  const norm = variants.map(C.normalizeAddress);
  norm.forEach(n => assert.equal(n, '123 MAIN ST, CROWN POINT, IN 46307'));
  const keys = norm.map(n => C.cacheKey('properties', n, { address: 'x', radius: 2 }));
  assert.equal(new Set(keys).size, 1);
});

test('suffixes, directions and unit punctuation are standardized', () => {
  assert.equal(C.normalizeAddress('9 North Oak Avenue Apt. #4, Gary, IN 46402'), '9 N OAK AVE APT UNIT 4, GARY, IN 46402');
  assert.equal(C.normalizeAddress('55 Elm Boulevard, Hobart, IN 46342'), '55 ELM BLVD, HOBART, IN 46342');
  assert.equal(C.normalizeAddress('7 Pine Lane'), '7 PINE LN');
  assert.equal(C.normalizeAddress('8 Birch Court'), '8 BIRCH CT');
  assert.equal(C.normalizeAddress('2 Cedar Road'), '2 CEDAR RD');
  assert.equal(C.normalizeAddress('3 Ash Drive'), '3 ASH DR');
});

test('cache key changes with endpoint and params, not with param order', () => {
  const a = C.cacheKey('properties', 'X', { radius: 2, saleDateRange: 365 });
  const b = C.cacheKey('properties', 'X', { saleDateRange: 365, radius: 2 });
  assert.equal(a, b);
  assert.notEqual(a, C.cacheKey('avm/value', 'X', { radius: 2, saleDateRange: 365 }));
  assert.notEqual(a, C.cacheKey('properties', 'X', { radius: 3, saleDateRange: 365 }));
  assert.equal(C.cacheKey('p', 'X', { latitude: 41.4278001 }), C.cacheKey('p', 'X', { latitude: 41.4278004 }));
});

test('zip is read from the end of the address', () => {
  assert.equal(C.zipFromAddress('733 N Main St, Crown Point, IN 46307'), '46307');
  assert.equal(C.zipFromAddress('10500 Some Rd, Gary, IN 46402-1111'), '46402');
  assert.equal(C.zipFromAddress('no zip here'), null);
});

test('plan overage math, base fee included', () => {
  assert.equal(C.nextCallCost('developer', 49), 0);
  assert.equal(C.nextCallCost('developer', 50), 0.20);
  assert.equal(C.monthSpend('developer', 50), 0);
  assert.equal(C.monthSpend('developer', 60), 2);
  assert.equal(C.monthSpend('foundation', 1000), 74);
  assert.equal(C.monthSpend('foundation', 1100), 80);
  assert.equal(C.monthSpend('growth', 5000), 199);
  assert.equal(C.monthSpend('scale', 25100), 450.5);
  assert.equal(C.planPricing('nonsense').overage, 0.20);   // unknown plan → developer
});

test('threshold helper: 80% and 100% of cap, 1,000 calls', () => {
  assert.deepEqual(C.thresholdsCrossed({ spend: 79.99, cap: 100, calls: 10 }), { pct80: false, pct100: false, calls1000: false });
  assert.deepEqual(C.thresholdsCrossed({ spend: 80, cap: 100, calls: 999 }), { pct80: true, pct100: false, calls1000: false });
  assert.deepEqual(C.thresholdsCrossed({ spend: 100, cap: 100, calls: 1000 }), { pct80: true, pct100: true, calls1000: true });
});

test('budget: developer plan — 50 free calls, then $0.20 each, refused at the cap', async () => {
  const s = createMemoryStore();
  const args = { month: '2026-10', cap: 1, baseFee: 0, included: 50, overage: 0.20 };
  for (let i = 0; i < 50; i++) assert.equal((await s.reserveCall(args)).cost, 0);
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await s.reserveCall(args));
  assert.deepEqual(results.map(r => r.allowed), [true, true, true, true, true, false]);
  assert.equal(s.budget.get('2026-10').spend_usd, 1);
  assert.equal(s.budget.get('2026-10').calls, 55);
});

test('budget: 80% alert fires exactly once, 100% alert once', async () => {
  const s = createMemoryStore();
  const args = { month: '2026-10', cap: 1, baseFee: 0, included: 0, overage: 0.20 };
  const r = [];
  for (let i = 0; i < 7; i++) r.push(await s.reserveCall(args));
  assert.deepEqual(r.map(x => x.alert80), [false, false, false, true, false, false, false]);   // $0.80 on call 4
  assert.deepEqual(r.map(x => x.alert100), [false, false, false, false, true, false, false]);  // $1.00 on call 5
  assert.deepEqual(r.map(x => x.allowed), [true, true, true, true, true, false, false]);
});

test('budget: foundation base fee counts toward the all-in cap', async () => {
  const s = createMemoryStore();
  const r = await s.reserveCall({ month: '2026-11', cap: 50, baseFee: 74, included: 1000, overage: 0.06 });
  assert.equal(r.allowed, false);   // $74 base fee alone is over a $50 cap
  assert.equal(r.alert100, true);
});

test('budget: 1,000-call flag fires once', async () => {
  const s = createMemoryStore();
  const args = { month: '2026-12', cap: 1000, baseFee: 74, included: 1000, overage: 0.06 };
  let fired = 0;
  for (let i = 0; i < 1005; i++) if ((await s.reserveCall(args)).alert1000) fired++;
  assert.equal(fired, 1);
});
