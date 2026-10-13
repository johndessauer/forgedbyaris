// Live lead-search results must carry city / state / ZIP so "Comp This
// Property" can send RentCast a full address (fix, Oct 13, 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

function loadPropertySearch() {
  const stubs = {
    [path.join(__dirname, '../netlify/functions/_Lib/verify-member.js')]: { verifyMember: async () => 'mem_1', AuthError: class extends Error {} },
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
  } finally { Module._load = orig; }
}

test('live search results include city, state and ZIP in details', async () => {
  process.env.PROPERTYRADAR_API_KEY = 'test-pr-key';
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ totalResultCount: 1, results: [
    { RadarID: 'R1', Address: '1930 SILVER CREEK CT', City: 'Crown Point', State: 'IN', ZipFive: '46307', Latitude: 41.4, Longitude: -87.3, Beds: 2, Baths: 2, SqFt: 1684 },
  ] }) });
  try {
    const ps = loadPropertySearch();
    const res = await ps.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer t' }, queryStringParameters: { action: 'search', location: 'Crown Point, IN 46307', plays: 'prefore' } });
    const body = JSON.parse(res.body);
    const r = body.results[0];
    assert.equal(r.address, '1930 SILVER CREEK CT');            // card title unchanged
    assert.equal(r.details.city, 'Crown Point');
    assert.equal(r.details.state, 'IN');
    assert.equal(r.details.zip, '46307');
    assert.equal(r.details.sqft, 1684);
  } finally {
    global.fetch = realFetch;
    delete process.env.PROPERTYRADAR_API_KEY;
  }
});
