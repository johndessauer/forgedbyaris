const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../netlify/functions/market-data');
const { createMemoryStore } = require('./helpers/memory-store');

function acsTable(name, { income, value, rent, units, vacant, occupied, owner, u5 }) {
  return [
    ['NAME', 'B19013_001E', 'B25077_001E', 'B25064_001E', 'B25001_001E', 'B25002_003E', 'B25003_001E', 'B25003_002E', 'B25024_006E', 'B25024_007E', 'B25024_008E', 'B25024_009E'],
    [name, String(income), String(value), String(rent), String(units), String(vacant), String(occupied), String(owner), String(u5), '0', '0', '0'],
  ];
}

const ACS_ZIP = acsTable('ZCTA5 46617', { income: 74186, value: 243400, rent: 1479, units: 5696, vacant: 1230, occupied: 4466, owner: 2795, u5: 1532 });
const ACS_BG = acsTable('Block Group 1, Census Tract 8', { income: 125221, value: 318400, rent: 1359, units: 392, vacant: 73, occupied: 319, owner: 220, u5: 40 });
const ACS_PLACE = acsTable('South Bend city, Indiana', { income: 52000, value: 150000, rent: 1100, units: 40000, vacant: 4000, occupied: 36000, owner: 20000, u5: 8000 });

const ZIP_46617 = { places: [{ 'place name': 'South Bend', 'state abbreviation': 'IN', latitude: '41.688263', longitude: '-86.2449229' }] };
const CENSUS_CORE = {
  result: {
    geographies: {
      Counties: [{ BASENAME: 'St. Joseph', STATE: '18', COUNTY: '141', GEOID: '18141' }],
      'Census Tracts': [{ NAME: 'Census Tract 8', GEOID: '18141000800', STATE: '18', COUNTY: '141', TRACT: '000800' }],
      'Incorporated Places': [{ NAME: 'South Bend city', BASENAME: 'South Bend', GEOID: '1871000', STATE: '18', PLACE: '71000' }],
      States: [{ STUSAB: 'IN', BASENAME: 'Indiana', STATE: '18' }],
      '2020 Census Blocks': [{ GEOID: '181410008001024', STATE: '18', COUNTY: '141', TRACT: '000800' }],
    },
  },
};

function jsonRes(data, status = 200) {
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => raw,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
  };
}

function param(u, name) {
  try { return new URL(u).searchParams.get(name) || ''; } catch (e) { return ''; }
}

function makeFetch() {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('api.zippopotam.us/us/46617')) return jsonRes(ZIP_46617);
    if (u.includes('nominatim.openstreetmap.org/search')) {
      const q = decodeURIComponent((u.split('q=')[1] || '').split('&')[0]).replace(/\+/g, ' ');
      if (/harters height/i.test(q)) {
        return jsonRes([{
          name: 'Harters Heights', lat: '41.6910867', lon: '-86.2442381',
          type: 'neighbourhood', addresstype: 'neighbourhood',
          address: { postcode: '46617', city: 'South Bend', state: 'Indiana' },
        }]);
      }
      if (/south bend/i.test(q) && !/harter/i.test(q)) {
        return jsonRes([{
          name: 'South Bend', lat: '41.6764', lon: '-86.2520',
          type: 'city', addresstype: 'city', class: 'place',
          address: { city: 'South Bend', state: 'Indiana' },
        }]);
      }
      return jsonRes([]);
    }
    if (u.includes('geocoding.geo.census.gov')) return jsonRes(CENSUS_CORE);
    if (u.includes('api.census.gov/data/2024/acs/acs5') || u.includes('api.census.gov/data/')) {
      const forP = param(u, 'for');
      if (forP.startsWith('block group:')) return jsonRes(ACS_BG);
      if (forP.startsWith('place:')) return jsonRes(ACS_PLACE);
      if (forP.startsWith('zip code tabulation area:')) return jsonRes(ACS_ZIP);
      if (forP.startsWith('county:') || forP.startsWith('tract:')) return jsonRes(ACS_ZIP);
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    }
    if (u.includes('api.stlouisfed.org')) {
      return jsonRes({ observations: [{ value: '6.25', date: '2026-11-05' }] });
    }
    if (u.includes('/econ/bps/County/')) {
      return jsonRes('not-json', 200).then ? null : {
        ok: true, status: 200,
        text: async () => `Survey,FIPS\nDate,State,County,Code,Code,Name,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value
202609,18,141,2,3,St. Joseph County                                        ,50,50,10000000,0,0,0,0,0,0,2,20,4000000,0,0,0,0,0,0,0,0,0`,
      };
    }
    if (u.includes('news.google.com/rss')) {
      const xml = `<rss><channel><item><title>Riverfront project breaks ground</title><link>https://news.example/riverfront</link><pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
      return { ok: true, status: 200, text: async () => xml };
    }
    if (u.includes('api.rentcast.io')) {
      throw new Error('RentCast should not be called in this test unless mock is set');
    }
    return { ok: false, status: 404, text: async () => '' };
  };
}

function post(handler, query, headers) {
  return handler({
    httpMethod: 'POST',
    headers: headers || {},
    body: JSON.stringify({ query }),
  });
}

const env = { CENSUS_API_KEY: 'census-key', FRED_API_KEY: 'fred-key' };
const foundationMember = { planConnections: [{ planId: 'pln_foundation--s11cv0hs9', status: 'ACTIVE' }] };
const empireMember = { planConnections: [{ planId: 'pln_foundation-empire-eh1bv0h3e', status: 'ACTIVE' }] };

function withMember(member, extra) {
  return createHandler(Object.assign({
    env,
    fetch: makeFetch(),
    now: () => new Date('2026-11-10T18:00:00Z'),
    verifyMember: async () => 'mem_test',
    getMember: async () => member,
  }, extra || {}));
}

test('market-data: unsigned request is rejected before census is called', async () => {
  const handler = createHandler({ env, fetch: makeFetch(), now: () => new Date('2026-11-10T18:00:00Z'), verifyMember: async () => { throw Object.assign(new Error('no auth'), { statusCode: 401 }); } });
  const res = await post(handler, '46617');
  assert.equal(res.statusCode, 401);
});

test('market-data: a lapsed plan is rejected', async () => {
  const handler = withMember({ planConnections: [{ planId: 'pln_foundation--s11cv0hs9', status: 'CANCELED' }] });
  const res = await post(handler, '46617');
  assert.equal(res.statusCode, 403);
});

test('market-data: ZIP 46617 returns ACS 2024 zip figures and a geo label', async () => {
  const handler = withMember(foundationMember);
  const res = await post(handler, '46617');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.dataSource, 'census');
  assert.equal(body.acsVintage, 2024);
  assert.equal(body.geography.type, 'zip');
  assert.match(body.geoLabel, /South Bend, IN \(46617\)/);
  assert.equal(body.medianHomeValue, 243400);
  assert.equal(body.medianIncome, 74186);
  assert.equal(body.mortgageRate, 6.25);
  assert.ok(body.areaIntel);
  assert.equal(body.comps.status, 'skipped');
});

test('market-data: South Bend, IN resolves to city/place ACS, not a county-geocoder error', async () => {
  const handler = withMember(foundationMember);
  const res = await post(handler, 'South Bend, IN');
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.geography.type, 'city');
  assert.equal(body.acsGeography, 'place');
  assert.equal(body.medianHomeValue, 150000);
  assert.equal(body.geoLabel, 'South Bend, IN');
});

test('market-data: Harter Heights 46617 returns neighborhood BG stats vs ZIP comparison and sourced intel', async () => {
  const handler = withMember(foundationMember);
  const res = await post(handler, 'Harter Heights 46617');
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.geography.type, 'neighborhood');
  assert.equal(body.acsGeography, 'blockGroup');
  assert.equal(body.medianHomeValue, 318400, 'neighborhood primary value');
  assert.equal(body.medianIncome, 125221);
  assert.ok(body.zipComparison);
  assert.equal(body.zipComparison.medianHomeValue, 243400);
  assert.ok(body.medianHomeValue > body.zipComparison.medianHomeValue);
  assert.match(body.geography.note || '', /block group/i);
  assert.equal(body.areaIntel.news.status, 'ok');
  assert.equal(body.areaIntel.news.items[0].title, 'Riverfront project breaks ground');
  assert.ok(body.areaIntel.news.items[0].url);
  assert.ok(body.areaIntel.permits);
  // Foundation plan: census is included, comps are not.
  assert.equal(body.comps.status, 'skipped');
});

test('market-data: signed-in Empire member gets mock radius comps on the neighborhood', async () => {
  const store = createMemoryStore();
  const handler = withMember(empireMember, {
    env: { ...env, RENTCAST_MOCK: '1' },
    store,
    mockResponse: (id) => ({
      ok: true,
      status: 200,
      data: id.includes('rental')
        ? [{ formattedAddress: '9 Oak St', price: 1400, zipCode: '46617' }]
        : [{ formattedAddress: '721 Corby Blvd', zipCode: '46617', propertyType: 'Single Family', lastSalePrice: 400000, lastSaleDate: '2026-01-13', squareFootage: 1400, bedrooms: 3 }],
    }),
  });
  const res = await post(handler, 'Harter Heights, South Bend, IN 46617', { Authorization: 'Bearer tok' });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.geography.type, 'neighborhood');
  assert.equal(body.comps.status, 'demo');
  assert.equal(body.comps.sold.medianSalePrice, 400000);
  assert.equal(body.comps.rentals.medianRent, 1400);
});

test('market-data: missing query is 400', async () => {
  const handler = createHandler({ env, fetch: makeFetch() });
  const res = await post(handler, '  ');
  assert.equal(res.statusCode, 400);
});
