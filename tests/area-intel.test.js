const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBpsRow, pickCounty, parseRssItems, buildNewsQuery, loadAreaIntel } = require('../netlify/functions/_Lib/area-intel');

const BPS = `Survey,FIPS,FIPS,Region,Division,County,,1-unit,,,2-units,,,3-4 units,,,5+ units,,,1-unit rep
Date,State,County,Code,Code,Name,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value
202609,18,141,2,3,St. Joseph County                                        ,100,100,20000000,0,0,0,0,0,0,5,80,10000000,0,0,0,0,0,0,0,0,0
202609,18,039,2,3,Elkhart County                                           ,10,10,1000000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
`;

test('parseBpsRow and pickCounty read St. Joseph County IN', () => {
  const row = pickCounty(BPS, '18', '141');
  assert.ok(row);
  assert.equal(row.name, 'St. Joseph County');
  assert.equal(row.units1, 100);
  assert.equal(row.units5plus, 80);
  assert.equal(row.totalUnits, 180);
});

test('parseRssItems extracts title, link, date, source', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[New apartments planned in South Bend]]></title>
      <link>https://example.com/story</link>
      <pubDate>Mon, 10 Nov 2026 12:00:00 GMT</pubDate>
      <source>South Bend Tribune</source>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'New apartments planned in South Bend');
  assert.equal(items[0].url, 'https://example.com/story');
  assert.equal(items[0].date, '2026-11-10');
  assert.equal(items[0].source, 'South Bend Tribune');
});

test('buildNewsQuery includes the neighborhood and city', () => {
  const q = buildNewsQuery({ type: 'neighborhood', name: 'Harters Heights', city: 'South Bend', state: 'IN' });
  assert.match(q, /Harters Heights/);
  assert.match(q, /South Bend/);
  assert.match(q, /development/);
});

test('loadAreaIntel returns sourced permit + news items and never invents extras', async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/econ/bps/County/co2609y.txt') || u.includes('/econ/bps/County/co')) {
      return { ok: true, status: 200, text: async () => BPS, text: BPS };
    }
    if (u.includes('news.google.com/rss')) {
      const xml = `<rss><channel><item><title>Factory expansion announced</title><link>https://news.example/factory</link><pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
      return { ok: true, status: 200, text: async () => xml };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  // fetchText uses res.text as a string in area-intel via fetchText helper which calls res.text()
  // Our mock must implement .text() as async. For BPS path, findBpsFile uses fetchText which expects text().
  const fetch2 = async (url) => {
    const u = String(url);
    if (u.includes('/econ/bps/County/')) {
      return { ok: true, status: 200, text: async () => BPS };
    }
    if (u.includes('news.google.com/rss')) {
      const xml = `<rss><channel><item><title>Factory expansion announced</title><link>https://news.example/factory</link><pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
      return { ok: true, status: 200, text: async () => xml };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  const intel = await loadAreaIntel({
    type: 'neighborhood',
    name: 'Harters Heights',
    city: 'South Bend',
    state: 'IN',
    county: { name: 'St. Joseph', stateFips: '18', countyFips: '141' },
  }, { fetch: fetch2, env: {}, now: () => new Date('2026-11-10T18:00:00Z') });
  assert.equal(intel.permits.status, 'ok');
  assert.equal(intel.permits.totalUnits, 180);
  assert.ok(intel.permits.items[0].url);
  assert.equal(intel.news.status, 'ok');
  assert.equal(intel.news.items[0].title, 'Factory expansion announced');
  assert.equal(intel.items.length, 2);
  assert.match(intel.note, /must not invent/i);
});
