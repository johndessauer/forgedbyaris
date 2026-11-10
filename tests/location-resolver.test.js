const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseQuery, nameVariants, hitInArea, haversineMiles, resolveLocation, stateAbbr,
} = require('../netlify/functions/_Lib/location-resolver');

test('parseQuery: bare ZIP, city/state, state name, neighborhood + zip', () => {
  assert.deepEqual(parseQuery('46617').type, 'zip');
  assert.equal(parseQuery('46617').zip, '46617');
  const city = parseQuery('South Bend, IN');
  assert.equal(city.type, 'city');
  assert.equal(city.city, 'South Bend');
  assert.equal(city.state, 'IN');
  const cityLong = parseQuery('South Bend, Indiana');
  assert.equal(cityLong.type, 'city');
  assert.equal(cityLong.state, 'IN');
  assert.equal(parseQuery('Florida').type, 'state');
  assert.equal(parseQuery('Florida').state, 'FL');
  const hood = parseQuery('Harter Heights, South Bend, IN 46617');
  assert.equal(hood.type, 'neighborhood');
  assert.equal(hood.name, 'Harter Heights');
  assert.equal(hood.city, 'South Bend');
  assert.equal(hood.state, 'IN');
  assert.equal(hood.zip, '46617');
  const hoodZip = parseQuery('Harter Heights 46617');
  assert.equal(hoodZip.type, 'neighborhood');
  assert.equal(hoodZip.name, 'Harter Heights');
  assert.equal(hoodZip.zip, '46617');
  assert.equal(parseQuery('Indianapolis, IN').type, 'city');
});

test('nameVariants covers Harter / Harters Heights', () => {
  const v = nameVariants('Harter Heights');
  assert.ok(v.includes('Harter Heights'));
  assert.ok(v.includes('Harters Heights'));
  const v2 = nameVariants('Harters Heights');
  assert.ok(v2.includes('Harter Heights'));
});

test('hitInArea rejects a Canton, OH hit when the query is constrained to 46617', () => {
  const canton = {
    lat: '40.800336',
    lon: '-81.4178933',
    address: { postcode: '44710', city: 'Canton', state: 'Ohio' },
  };
  const southBendZip = { zip: '46617', city: 'South Bend', state: 'IN', lat: 41.688263, lng: -86.2449229, maxMiles: 12 };
  assert.equal(hitInArea(canton, southBendZip), false);

  const local = {
    lat: '41.6910867',
    lon: '-86.2442381',
    address: { postcode: '46617', city: 'South Bend', state: 'Indiana' },
  };
  const ok = hitInArea(local, southBendZip);
  assert.ok(ok);
  assert.equal(ok.via, 'postcode');
});

test('haversine: Canton is far from South Bend 46617', () => {
  const miles = haversineMiles(41.688263, -86.2449229, 40.800336, -81.4178933);
  assert.ok(miles > 200);
});

test('stateAbbr accepts full names', () => {
  assert.equal(stateAbbr('Indiana'), 'IN');
  assert.equal(stateAbbr('in'), 'IN');
});

function jsonRes(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  };
}

function mockFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, payload] of routes) {
      if (u.includes(needle)) {
        const body = typeof payload === 'function' ? payload(u) : payload;
        return jsonRes(body);
      }
    }
    return jsonRes({ error: 'unmocked ' + u }, 404);
  };
}

const ZIP_46617 = {
  'place name': 'South Bend',
  'state abbreviation': 'IN',
  latitude: '41.688263',
  longitude: '-86.2449229',
};

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

test('resolveLocation: Harter Heights 46617 prefers Harters Heights inside the zip and rejects Canton', async () => {
  const fetchImpl = mockFetch([
    ['api.zippopotam.us/us/46617', { places: [ZIP_46617] }],
    ['nominatim.openstreetmap.org/search', (u) => {
      const q = decodeURIComponent((u.split('q=')[1] || '').split('&')[0]).replace(/\+/g, ' ');
      if (/harters height/i.test(q) && /south bend|46617/i.test(q)) {
        return [{
          name: 'Harters Heights',
          display_name: 'Harters Heights, South Bend, Saint Joseph County, Indiana, 46617, United States',
          lat: '41.6910867',
          lon: '-86.2442381',
          type: 'neighbourhood',
          addresstype: 'neighbourhood',
          address: { postcode: '46617', city: 'South Bend', state: 'Indiana' },
        }];
      }
      if (/harter height/i.test(q) && !/south bend/i.test(q)) {
        // Unconstrained spelling would hit Canton, OH — resolver must not accept it.
        return [{
          name: 'Harter Heights',
          display_name: 'Harter Heights, Canton, Stark County, Ohio, 44710, United States',
          lat: '40.800336',
          lon: '-81.4178933',
          type: 'hamlet',
          addresstype: 'hamlet',
          address: { postcode: '44710', city: 'Canton', state: 'Ohio' },
        }];
      }
      return [];
    }],
    ['geocoding.geo.census.gov', CENSUS_CORE],
  ]);

  const r = await resolveLocation('Harter Heights 46617', { fetch: fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.geography.type, 'neighborhood');
  assert.match(r.geography.label, /Harters Heights|Harter Heights/);
  assert.equal(r.geography.zip, '46617');
  assert.equal(r.geography.state, 'IN');
  assert.ok(r.geography.lat > 41.6 && r.geography.lat < 41.8);
  assert.equal(r.acsTargets.primary.kind, 'blockGroup');
  assert.equal(r.acsTargets.primary.geoid, '181410008001');
  assert.equal(r.acsTargets.comparison.zip, '46617');
  // Must not have resolved to Ohio.
  assert.ok(r.geography.lng < -86);
});

test('resolveLocation: South Bend, IN resolves as a city/place, not a county-geocoder miss', async () => {
  const fetchImpl = mockFetch([
    ['nominatim.openstreetmap.org/search', [{
      name: 'South Bend',
      display_name: 'South Bend, St. Joseph County, Indiana, United States',
      lat: '41.6764',
      lon: '-86.2520',
      type: 'city',
      addresstype: 'city',
      class: 'place',
      address: { city: 'South Bend', state: 'Indiana' },
    }]],
    ['geocoding.geo.census.gov', CENSUS_CORE],
  ]);
  const r = await resolveLocation('South Bend, IN', { fetch: fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.geography.type, 'city');
  assert.equal(r.geography.city, 'South Bend');
  assert.equal(r.acsTargets.primary.kind, 'place');
  assert.equal(r.acsTargets.primary.placeFips, '71000');
  assert.equal(r.acsTargets.primary.stateFips, '18');
});

test('resolveLocation: unknown neighborhood with a ZIP falls back to the ZIP', async () => {
  const fetchImpl = mockFetch([
    ['api.zippopotam.us/us/46617', { places: [ZIP_46617] }],
    ['nominatim.openstreetmap.org/search', []],
    ['geocoding.geo.census.gov', CENSUS_CORE],
  ]);
  const r = await resolveLocation('Totally Fake Hills 46617', { fetch: fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.geography.resolvedAs, 'zip-fallback');
  assert.equal(r.acsTargets.primary.kind, 'zcta');
  assert.match(r.geography.note, /Could not uniquely locate/i);
});
