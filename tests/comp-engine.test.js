// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const E = require('../assets/js/comp-engine');
const { loadFixture } = require('../netlify/functions/_Lib/rentcast-client');

const ASOF = new Date('2026-10-12T00:00:00.000Z');
const subjectRec = loadFixture('properties:subject')[0];
const soldRecs = loadFixture('properties:sold');
const avm = loadFixture('avm/value');

function fixtureState(extra) {
  const subject = E.subjectFromRecord(subjectRec);
  const recorded = soldRecs.map(r => E.fromPropertyRecord(r, subject));
  const listings = avm.comparables.map(E.fromAvmComparable);
  return { subject, comps: E.mergeComps(recorded, listings), asOf: ASOF, pulled: { radius: 2, soldWithinDays: 365, listings: true }, ...(extra || {}) };
}

test('median and mean', () => {
  assert.equal(E.median([3, 1, 2]), 2);
  assert.equal(E.median([4, 1, 3, 2]), 2.5);
  assert.equal(E.mean([1, 2, 3, 6]), 3);
  assert.equal(E.median([]), null);
});

test('haversine: 1 degree of latitude is ~69 miles', () => {
  assert.ok(Math.abs(E.haversineMiles(41, -87, 42, -87) - 69.09) < 0.1);
});

test('mappers read the documented RentCast field names', () => {
  const s = E.subjectFromRecord(subjectRec);
  assert.equal(s.sqft, 1650); assert.equal(s.beds, 3); assert.equal(s.baths, 2);
  assert.equal(s.propertyType, 'Single Family');
  const c = E.fromPropertyRecord(soldRecs[0], s);
  assert.equal(c.source, 'recorded'); assert.equal(c.price, 259000);
  assert.ok(c.distance > 0.1 && c.distance < 0.14, `distance ${c.distance}`);
  const l = E.fromAvmComparable(avm.comparables[1]);
  assert.equal(l.source, 'listing'); assert.equal(l.status, 'Active'); assert.equal(l.correlation, 0.989);
});

test('overrides win over the looked-up subject attributes', () => {
  const s = E.subjectFromRecord(subjectRec, { sqft: 1800, beds: 4 });
  assert.equal(s.sqft, 1800); assert.equal(s.beds, 4); assert.equal(s.baths, 2);
});

test('mergeComps drops a listing that duplicates a recorded sale, keeps its correlation', () => {
  const st = fixtureState();
  const dupes = st.comps.filter(c => c.id === '615-N-East-St,-Crown-Point,-IN-46307');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].source, 'recorded');
  assert.equal(dupes[0].correlation, 0.9912);
});

test('default selection: 5 recorded sales inside 1 mi / 90 days, every exclusion explained', () => {
  const r = E.buildReport(fixtureState());
  const why = id => r.rows.find(x => x.id.startsWith(id)).reasons;
  assert.equal(r.eligibleCount, 5);
  assert.equal(r.compCount, 5);
  assert.deepEqual(why('905-Wildwood'), ['sale-date']);
  assert.deepEqual(why('1540-Pettibone'), ['radius']);
  assert.deepEqual(why('310-S-Main'), ['non-arms-length']);
  assert.deepEqual(why('77-W-Joliet'), ['ppsf-outlier']);
  assert.ok(why('1200-Delaware').includes('property-type'));
  assert.ok(why('520-N-Indiana').includes('beds'));
  assert.ok(why('520-N-Indiana').includes('sqft'));
  assert.ok(why('118-W-Clark').includes('listing'));   // listings excluded by default
  r.rows.filter(x => x.included).forEach(x => assert.equal(x.source, 'recorded'));
});

test('ARV matches a hand calculation at $40/sqft (median of 5)', () => {
  // Subject 1,650 sqft. Adjusted = price + (1650 − compSqft) × 40:
  //   801 N Main  259,000 + 2,000  = 261,000
  //   615 N East  268,500 − 2,800  = 265,700
  //   420 W Wells 248,000 + 2,800  = 250,800
  //   1012 Court  279,900 − 6,400  = 273,500
  //   233 E North 262,000 − 1,600  = 260,400
  // Median = 261,000. Range 250,800–273,500.
  const r = E.buildReport(fixtureState());
  assert.equal(r.method, 'median');
  assert.equal(r.arv, 261000);
  assert.equal(r.arvLow, 250800);
  assert.equal(r.arvHigh, 273500);
  assert.equal(r.pricePerSqft, 158.18);
  assert.equal(r.confidence, 'High');
});

test('adjustment rate is clamped to $30–$50 per sqft', () => {
  assert.equal(E.clampAdjRate(10), 30);
  assert.equal(E.clampAdjRate(75), 50);
  assert.equal(E.clampAdjRate(45), 45);
  assert.equal(E.clampAdjRate(undefined), 40);
  const s = { sqft: 2000, beds: 3, baths: 2 };
  const c = { id: 'x', price: 300000, sqft: 1900, beds: 3, baths: 2 };
  assert.equal(E.adjustComp(c, s, { adjRate: 99 }).adjustedPrice, 305000);  // 100 × 50
  assert.equal(E.adjustComp(c, s, { adjRate: 1 }).adjustedPrice, 303000);   // 100 × 30
});

test('optional line items: per-bed, per-bath and per-comp extras', () => {
  const s = { sqft: 1500, beds: 3, baths: 2 };
  const c = { id: 'c1', price: 200000, sqft: 1500, beds: 2, baths: 1 };
  const a = E.adjustComp(c, s, { perBed: 8000, perBath: 5000, extras: { c1: { garage: 4000, pool: 0, condition: -6000 } } });
  assert.deepEqual(a.lines, { size: 0, bed: 8000, bath: 5000, extras: -2000 });
  assert.equal(a.adjustedPrice, 211000);
});

test('mean is used when 3 or fewer comps are included', () => {
  assert.deepEqual(E.computeArv([100, 200, 600], 10), { arv: 300, low: 100, high: 600, method: 'mean', pricePerSqft: 30, count: 3 });
  assert.equal(E.computeArv([100, 200, 300, 1000], null).arv, 250);   // median of 4
  assert.equal(E.computeArv([], 1).arv, null);
});

test('include/exclude toggles recalculate ARV with no other input', () => {
  const st = fixtureState();
  const base = E.buildReport(st);
  const excluded = E.buildReport({ ...st, manual: { '1012-N-Court-St,-Crown-Point,-IN-46307': false } });
  // Remaining 4: 250,800 260,400 261,000 265,700 → median 260,700
  assert.equal(excluded.compCount, 4);
  assert.equal(excluded.arv, 260700);
  assert.notEqual(excluded.arv, base.arv);
  // Manually including a non-eligible comp is allowed and counts.
  const plus = E.buildReport({ ...st, manual: { '905-Wildwood-Ct,-Crown-Point,-IN-46307': true } });
  assert.equal(plus.compCount, 6);
});

test('rebuilding is fast enough for live toggling (< 100 ms)', () => {
  const st = fixtureState();
  const t = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) E.buildReport({ ...st, manual: { x: i % 2 === 0 } });
  const perRunMs = Number(process.hrtime.bigint() - t) / 1e6 / 20;
  assert.ok(perRunMs < 100, `${perRunMs} ms`);
});

test('fewer than 3 comps: ladder offered, nothing expanded automatically, confidence Low', () => {
  const st = fixtureState({ filters: { radius: 0.4 } });
  const r = E.buildReport(st);
  assert.ok(r.eligibleCount < 3, `eligible ${r.eligibleCount}`);
  assert.equal(r.needsExpansion, true);
  assert.equal(r.confidence, 'Low');
  assert.equal(r.filters.radius, 0.4);            // not widened behind the member's back
  assert.deepEqual(r.relaxedRules, []);
  assert.equal(r.ladder.length, 6);
  assert.ok(r.ladder.every(s => s.applied === false));
});

test('ladder steps are free inside the pulled envelope and cost a lookup outside it', () => {
  const wide = E.ladderSteps([], { radius: 2, soldWithinDays: 365, listings: true });
  assert.ok(wide.every(s => s.costsLookup === false));
  const narrow = E.ladderSteps([], { radius: 1, soldWithinDays: 90, listings: false });
  const cost = Object.fromEntries(narrow.map(s => [s.id, s.costsLookup]));
  assert.deepEqual(cost, { loosen: false, radius15: true, radius2: true, days180: true, days365: true, listings: true });
  assert.equal(E.requiresNewPull({ radius: 3 }, { radius: 2, soldWithinDays: 365, listings: true }), true);
  assert.equal(E.requiresNewPull({ radius: 1.5, soldWithinDays: 180 }, { radius: 2, soldWithinDays: 365, listings: true }), false);
});

test('each expansion step lowers confidence and is reported', () => {
  const st = fixtureState();
  const days = E.buildReport({ ...st, ladder: ['days180'] });
  assert.equal(days.filters.soldWithinDays, 180);
  assert.ok(days.rows.find(x => x.id.startsWith('905-Wildwood')).eligible);
  assert.equal(days.confidence, 'Medium');
  assert.deepEqual(days.relaxedRules, ['Sold within 180 days']);
  const two = E.buildReport({ ...st, ladder: ['days180', 'radius15'] });
  assert.equal(two.confidence, 'Low');
  const listings = E.buildReport({ ...st, ladder: ['listings'] });
  assert.ok(listings.rows.find(x => x.id.startsWith('118-W-Clark')).eligible);
});

test('confidence thresholds: ±10% High, ±20% Medium, beyond Low', () => {
  const mk = prices => prices.map((p, i) => ({ id: 'c' + i, adjustedPrice: p, source: 'recorded' }));
  assert.equal(E.confidence(mk([100, 105, 95]), 0).level, 'High');
  assert.equal(E.confidence(mk([100, 115, 85]), 0).level, 'Medium');
  assert.equal(E.confidence(mk([100, 130, 70]), 0).level, 'Low');
  assert.equal(E.confidence(mk([100, 105, 95]), 1).level, 'Medium');
  assert.equal(E.confidence(mk([100, 105]), 0).level, 'Low');
  const withListing = mk([100, 105, 95]); withListing[2].source = 'listing';
  assert.equal(E.confidence(withListing, 0).level, 'Medium');
});

test('similarity: identical nearby comp scores near 1; correlation is blended in', () => {
  const s = { sqft: 1650, beds: 3, baths: 2, yearBuilt: 1978 };
  const near = { distance: 0.01, sqft: 1650, beds: 3, baths: 2, yearBuilt: 1978, ageDays: 1, correlation: null };
  assert.ok(E.similarity(s, near, {}) > 0.97);
  const withCorr = { ...near, correlation: 0.5 };
  assert.ok(E.similarity(s, withCorr, {}) < E.similarity(s, near, {}));
});

test('fixtures load with dates shifted forward so demo sales stay recent', () => {
  const later = loadFixture('properties:sold', new Date('2027-01-12T00:00:00.000Z'));
  assert.equal(later[0].lastSaleDate, '2026-12-11T00:00:00.000Z'); // +92 days from 2026-09-10
  assert.equal(path.basename(__filename), 'comp-engine.test.js');
});
