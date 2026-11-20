// Lead-type criteria, count-only search, and the purchase spend cap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const catalog = require('../assets/js/lead-filters');
const criteria = require('../netlify/functions/_Lib/lead-criteria');
const spend = require('../netlify/functions/_Lib/property-search-spend');

const NOW = new Date(Date.UTC(2026, 10, 19));

function loadPropertySearch() {
  const stubs = {
    [path.join(__dirname, '../netlify/functions/_Lib/verify-member.js')]: { verifyMember: async () => 'mem_1', AuthError: class extends Error {} },
    [path.join(__dirname, '../netlify/functions/_Lib/membership.js')]: {
      enforceMembership: async () => ({ access: { memberId: 'mem_1', active: true, empire: true, comps: true } }),
    },
    [path.join(__dirname, '../netlify/functions/_Lib/supabase-client.js')]: { supabase: {} },
  };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (stubs[resolved]) return stubs[resolved];
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../netlify/functions/property-search')];
    return require('../netlify/functions/property-search');
  } finally {
    Module._load = orig;
  }
}

function names(list) {
  return list.map(item => item.name);
}

test('every catalog lead type and property type has a server definition and the same label', () => {
  assert.equal(catalog.LEAD_TYPES.length, 20);
  catalog.LEAD_TYPES.forEach(type => {
    const def = criteria.LEAD_CRITERIA[type.id];
    assert.ok(def, type.id);
    assert.equal(def.label, type.label);
    assert.equal(!!def.approximate, type.note === 'approx');
    assert.ok(def.criteria(NOW).length > 0);
  });
  catalog.PROPERTY_TYPES.forEach(type => {
    assert.ok(criteria.PROPERTY_TYPE_CRITERIA[type.id], type.id);
  });
  assert.deepEqual(
    catalog.LEAD_TYPES.filter(type => type.note === 'approx').map(type => type.id),
    ['activeinvestor', 'inherited']
  );
});

test('lead criteria match the Deal Surge definitions', () => {
  const compiled = (plays, extra) => criteria.compileSearch(Object.assign({ plays, location: '46307' }, extra || {}), NOW);

  const activity = compiled('foreactivity');
  assert.deepEqual(activity.criteria.find(c => c.name === 'ForeclosureStage').value, [
    'Preforeclosure', 'Preforeclosure-NTS', 'Auction', 'Auction-UNK', 'Sale Pending',
  ]);

  const bank = compiled('foreclosure');
  assert.deepEqual(bank.criteria.find(c => c.name === 'ForeclosureStage').value, ['Bank Owned', 'Bank Owned-Held']);

  const high = compiled('highequity');
  assert.deepEqual(high.criteria.find(c => c.name === 'NumberLoans').value, [[1, null]]);
  assert.deepEqual(high.criteria.find(c => c.name === 'CLTV').value, [[0, 59]]);
  assert.equal(high.criteria.some(c => c.name === 'EquityPercent'), false);

  assert.deepEqual(compiled('lowequity').criteria.find(c => c.name === 'CLTV').value, [[81, null]]);
  assert.deepEqual(compiled('upsidedown').criteria.find(c => c.name === 'CLTV').value, [[101, null]]);
  assert.deepEqual(compiled('freeclear').criteria.find(c => c.name === 'NumberLoans').value, [[0, 0]]);

  const flipped = compiled('flipped');
  assert.deepEqual(flipped.criteria.find(c => c.name === 'PriorTransferMonthsSince').value, [[0, 24]]);
  const flipTypes = flipped.criteria.find(c => c.name === 'LastTransferType').value;
  assert.equal(flipTypes.includes('NonMarket-Family'), false);
  assert.ok(flipTypes.includes('MarketFlip'));

  assert.deepEqual(
    compiled('longterm').criteria.find(c => c.name === 'LastTransferRecDate').value,
    ['from: 1/1/1900 to: 11/19/2001']
  );
  const bored = compiled('bored');
  assert.deepEqual(bored.criteria.find(c => c.name === 'isSameMailingOrExempt').value, [0]);
  assert.deepEqual(bored.criteria.find(c => c.name === 'LastTransferRecDate').value, ['from: 1/1/1900 to: 11/19/2016']);

  const zombie = compiled('zombie');
  assert.deepEqual(zombie.criteria.find(c => c.name === 'ForeclosureStage').value, ['Preforeclosure', 'Preforeclosure-NTS']);
  assert.deepEqual(zombie.criteria.find(c => c.name === 'isSiteVacant').value, [1]);

  const investor = compiled('activeinvestor');
  assert.equal(investor.approximate[0], 'Active Investor Owned');
  assert.deepEqual(investor.criteria.find(c => c.name === 'NumberPropertiesOwned').value, [[2, null]]);
  assert.deepEqual(investor.criteria.find(c => c.name === 'LastTransferRecDate').value, ['from: 11/19/2023 to: 11/19/2026']);

  const inherited = compiled('inherited');
  assert.deepEqual(inherited.criteria.find(c => c.name === 'inDistress').value, ['isDeceasedProperty', 'inProbateProperty']);
  assert.equal(inherited.leadTypes[0].approximate, true);

  const equity = compiled('absentee', { emin: '40' });
  assert.deepEqual(equity.criteria.find(c => c.name === 'isSameMailingOrExempt').value, [0]);
  assert.deepEqual(equity.criteria.find(c => c.name === 'EquityPercent').value, [[40, null]]);
  assert.match(equity.link, /plays=absentee/);
  assert.match(equity.link, /emin=40/);
  assert.match(equity.link, /location=46307/);
  assert.equal(JSON.stringify(equity).includes('PropertyRadar'), false);
});

test('pre-foreclosure uses the previous broad list, and tighter foreclosure filters stay opt-in', () => {
  const alone = criteria.compileSearch({ plays: 'prefore', location: '46307' }, NOW);
  assert.deepEqual(alone.criteria, [
    { name: 'ZipFive', value: [46307] },
    { name: 'inForeclosure', value: [1] },
  ]);
  assert.equal(alone.criteria.some(c => c.name === 'ForeclosureStage'), false);
  assert.equal(alone.criteria.some(c => c.name === 'PropertyType'), false);
  assert.equal(alone.criteria.some(c => c.name === 'EquityPercent'), false);
  assert.equal(alone.criteria.some(c => c.name === 'isSameMailingOrExempt'), false);

  const withVacant = criteria.compileSearch({ plays: 'prefore,vacant', location: '46307' }, NOW);
  assert.deepEqual(names(withVacant.criteria), ['ZipFive', 'inForeclosure', 'isSiteVacant']);

  const withEquity = criteria.compileSearch({ plays: 'prefore', location: '46307', emin: '40' }, NOW);
  assert.deepEqual(names(withEquity.criteria), ['ZipFive', 'inForeclosure', 'EquityPercent']);

  const withBank = criteria.compileSearch({ plays: 'prefore,foreclosure', location: '46307' }, NOW);
  assert.equal(withBank.criteria.some(c => c.name === 'inForeclosure'), false);
  assert.deepEqual(withBank.criteria.find(c => c.name === 'ForeclosureStage').value, ['Bank Owned', 'Bank Owned-Held']);

  const zombie = criteria.compileSearch({ plays: 'zombie', location: '46307' }, NOW);
  assert.equal(zombie.criteria.some(c => c.name === 'inForeclosure'), false);
  assert.deepEqual(zombie.criteria.find(c => c.name === 'ForeclosureStage').value, ['Preforeclosure', 'Preforeclosure-NTS']);
});

test('property type include ORs the selected buckets and exclude sends the complement', () => {
  const included = criteria.compileSearch({ plays: 'vacant', ptypes: 'sfr,townhome', location: '89501' }, NOW);
  const type = included.criteria.find(c => c.name === 'PropertyType');
  const advanced = type.value.find(part => part.name === 'AdvancedPropertyType').value;
  assert.deepEqual(advanced, ['163', '148', '109', '102']);
  assert.equal(type.value.some(part => part.name === 'PType'), false);

  const excluded = criteria.compileSearch({ plays: 'vacant', ptypes: 'land', pmode: 'exclude' }, NOW);
  const excludedType = excluded.criteria.find(c => c.name === 'PropertyType');
  const pTypes = excludedType.value.find(part => part.name === 'PType').value;
  assert.equal(pTypes.includes('LND'), false);
  assert.ok(pTypes.includes('CND'));
  assert.ok(pTypes.includes('MFR'));
  assert.match(excluded.link, /pmode=exclude/);
});

test('locations accept a ZIP, City ST, and a spelled-out state', () => {
  assert.deepEqual(criteria.buildLocationCriteria('46307'), [{ name: 'ZipFive', value: [46307] }]);
  assert.deepEqual(criteria.buildLocationCriteria('Reno NV'), [
    { name: 'City', value: ['Reno'] },
    { name: 'DefaultState', value: ['NV'] },
  ]);
  assert.deepEqual(criteria.buildLocationCriteria('Reno, Nevada'), [
    { name: 'City', value: ['Reno'] },
    { name: 'DefaultState', value: ['NV'] },
  ]);
  assert.deepEqual(criteria.buildLocationCriteria('Crown Point, IN'), [
    { name: 'City', value: ['Crown Point'] },
    { name: 'DefaultState', value: ['IN'] },
  ]);
});

test('matching any of several lead types is rejected before a search is built', () => {
  const any = criteria.compileSearch({ plays: 'absentee,freeclear', match: 'any', location: '46307' }, NOW);
  assert.equal(any.status, 400);
  assert.match(any.error, /every type/);
  assert.equal(any.criteria, undefined);
  const one = criteria.compileSearch({ plays: 'freeclear,longterm', location: 'Reno, NV' }, NOW);
  assert.equal(one.error, undefined);
  assert.deepEqual(names(one.criteria), ['City', 'DefaultState', 'NumberLoans', 'LastTransferRecDate']);
});

test('the round-trip link restores the filters the count endpoint returns', () => {
  const link = catalog.buildPropertySearchLink({
    location: 'Reno, NV',
    plays: ['freeclear', 'longterm'],
    propertyTypes: ['sfr'],
    propertyMode: 'include',
    equityMin: '40',
  });
  const parsed = catalog.parsePropertySearchLink(link.split('?')[1]);
  assert.equal(parsed.location, 'Reno, NV');
  assert.deepEqual(parsed.plays, ['freeclear', 'longterm']);
  assert.deepEqual(parsed.propertyTypes, ['sfr']);
  assert.equal(parsed.equityMin, '40');
  assert.equal(parsed.match, 'all');
});

function privateStore() {
  const data = new Map();
  return {
    async get(key, opts) {
      if (!data.has(key)) return null;
      return opts && opts.type === 'json' ? data.get(key) : JSON.stringify(data.get(key));
    },
    async setJSON(key, value) { data.set(key, value); },
  };
}

test('spend caps default, block at zero room, and count purchased records', async () => {
  assert.deepEqual(spend.capsFromEnv({}), { daily: 100, monthly: 5000 });
  assert.equal(spend.capsFromEnv({ PROPERTY_SEARCH_MEMBER_DAILY_CAP: '0' }).daily, 0);
  assert.equal(spend.capsFromEnv({ PROPERTY_SEARCH_MONTHLY_CAP: 'nope' }).monthly, 5000);

  const store = privateStore();
  const caps = { daily: 30, monthly: 40 };
  const first = await spend.inspect(store, 'mem_a', NOW, caps);
  assert.equal(first.room, 30);
  assert.equal(first.blocked, null);
  await spend.record(store, 'mem_a', 25, NOW);
  const second = await spend.inspect(store, 'mem_a', NOW, caps);
  assert.equal(second.room, 5);
  await spend.record(store, 'mem_a', 5, NOW);
  const blocked = await spend.inspect(store, 'mem_a', NOW, caps);
  assert.equal(blocked.room, 0);
  assert.equal(blocked.blocked.scope, 'daily');
  assert.match(blocked.blocked.message, /today's Property Search limit of 30/);

  const other = await spend.inspect(store, 'mem_b', NOW, caps);
  assert.equal(other.room, 10);
  await spend.record(store, 'mem_b', 10, NOW);
  const month = await spend.inspect(store, 'mem_c', NOW, caps);
  assert.equal(month.blocked.scope, 'monthly');
  assert.match(month.blocked.message, /monthly limit of 40/);
});

test('count is Purchase=0 and a capped member cannot purchase another page', async () => {
  const ps = loadPropertySearch();
  const realFetch = global.fetch;
  const seen = [];
  process.env.PROPERTYRADAR_API_KEY = 'test-pr-key';
  const previousDaily = process.env.PROPERTY_SEARCH_MEMBER_DAILY_CAP;
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), body: opts && opts.body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ totalResultCount: 18, results: [] }),
    };
  };
  try {
    const count = await ps.handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer t' },
      queryStringParameters: { action: 'count', location: 'Reno NV', plays: 'freeclear,longterm', emin: '40' },
    });
    const body = JSON.parse(count.body);
    assert.equal(count.statusCode, 200);
    assert.equal(body.demo, false);
    assert.equal(body.count, 18);
    assert.deepEqual(body.leadTypes.map(type => type.id), ['freeclear', 'longterm']);
    assert.match(body.link, /^\/property-search\.html\?/);
    assert.match(body.link, /plays=freeclear%2Clongterm/);
    assert.match(body.link, /location=Reno\+NV|location=Reno%20NV/);
    assert.equal(JSON.stringify(body).toLowerCase().includes('propertyradar'), false);
    assert.equal(JSON.stringify(body).toLowerCase().includes('realeflow'), false);
    const preview = new URL(seen[0].url);
    assert.equal(preview.searchParams.get('Purchase'), '0');
    assert.equal(preview.searchParams.has('Fields'), false);
    const previewBody = JSON.parse(seen[0].body);
    assert.equal(previewBody.Criteria.some(c => c.name === 'NumberLoans'), true);
    assert.equal(previewBody.Criteria.some(c => c.name === 'EquityPercent'), true);

    process.env.PROPERTY_SEARCH_MEMBER_DAILY_CAP = '0';
    const blocked = await ps.handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer t' },
      queryStringParameters: { action: 'search', location: '46307', plays: 'prefore' },
    });
    const denied = JSON.parse(blocked.body);
    assert.equal(blocked.statusCode, 429);
    assert.match(denied.error, /today's Property Search limit/);
    assert.equal(seen.length, 1);
  } finally {
    global.fetch = realFetch;
    delete process.env.PROPERTYRADAR_API_KEY;
    if (previousDaily == null) delete process.env.PROPERTY_SEARCH_MEMBER_DAILY_CAP;
    else process.env.PROPERTY_SEARCH_MEMBER_DAILY_CAP = previousDaily;
  }
});

test('the coach prompt and the chat tool stay inside FORGE', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../netlify/edge-functions/aris-stream.js'), 'utf8');
  const coach = fs.readFileSync(path.join(__dirname, '../aris-coach.html'), 'utf8');
  assert.match(prompt, /search_leads/);
  assert.match(prompt, /Never mention data vendors by name/);
  assert.match(prompt, /PropertyRadar, Realeflow/);
  assert.match(coach, /name: 'search_leads'/);
  assert.match(coach, /set\('action', 'count'\)/);
  assert.match(coach, /pendingLeadLink/);
  const page = fs.readFileSync(path.join(__dirname, '../property-search.html'), 'utf8');
  const filters = fs.readFileSync(path.join(__dirname, '../assets/js/lead-filters.js'), 'utf8');
  assert.match(page, /lead-filters\.js/);
  assert.match(page, /applyUrlFilters/);
  assert.match(page, /Exclude/);
  assert.match(page, /Property Type/);
  assert.match(filters, /Delinquent Tax Activity/);
  assert.match(filters, /Potentially Inherited/);
  assert.match(prompt, /Pre-Foreclosures \(currently in foreclosure: notice filed, auction scheduled, or bank-owned and not yet resold\)/);
  assert.equal(prompt.includes('not yet auction or bank-owned'), false);
  assert.match(coach, /prefore = currently in foreclosure \(notice, auction, or bank-owned and not yet resold\)/);
  assert.equal(coach.includes('prefore = notice filed, not auction or bank-owned'), false);
});
