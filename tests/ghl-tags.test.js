const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ghl = require('../netlify/functions/_Lib/ghl-contact');
const waitlist = require('../netlify/functions/waitlist-subscribe');

const REFERRAL_FIELD = '4UsHzTuolKkrrtBov1hM';

function callsFor(responses) {
  const calls = [];
  const request = async ({ method, path: reqPath, payload }) => {
    calls.push({ method, path: reqPath, payload });
    const next = responses.shift();
    return next || { statusCode: 200, data: '{}' };
  };
  return { calls, request };
}

test('paying-member sync upserts without tags, then adds plan and rep tags', async () => {
  const { calls, request } = callsFor([
    { statusCode: 200, data: JSON.stringify({ contact: { id: 'c1', tags: ['rs-5050', 'fortiva-7525'] } }) },
    { statusCode: 200, data: '{}' },
  ]);
  const outcome = await ghl.syncPayingMember({
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Investor',
    locationId: '3dQD2B6ZsBjZVIrWF8WR',
    planName: 'pln_-97-direct--jx9b09ut',
    extraTags: ['rpm-newport-2026', 'rep-ian'],
    salesRep: 'chris',
    referralSource: 'fortiva',
    referralFieldId: REFERRAL_FIELD,
    salesRepFieldId: 'sales-rep-field',
    planTagOverrides: { 'pln_-97-direct--jx9b09ut': 'Beta Member' },
  }, request);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.contactId, 'c1');
  assert.equal(calls[0].path, '/contacts/upsert');
  assert.equal(calls[0].payload.tags, undefined);
  assert.equal(calls[0].payload.locationId, '3dQD2B6ZsBjZVIrWF8WR');
  assert.deepEqual(calls[0].payload.customFields, [
    { id: REFERRAL_FIELD, field_value: 'fortiva' },
    { id: 'sales-rep-field', field_value: 'chris' },
  ]);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].path, '/contacts/c1/tags');
  assert.deepEqual(calls[1].payload.tags, [
    'member', 'paying-member', 'pln_-97-direct--jx9b09ut', 'Beta Member',
    'rpm-newport-2026', 'rep-ian', 'rep-chris',
  ]);
});

test('sales rep is still tagged when the GHL Sales Rep field id is not configured', async () => {
  const { calls, request } = callsFor([
    { statusCode: 200, data: { contact: { id: 'c2' } } },
    { statusCode: 200, data: {} },
  ]);
  const outcome = await ghl.syncPayingMember({
    email: 'ada@example.com',
    locationId: '3dQD2B6ZsBjZVIrWF8WR',
    salesRep: 'john',
    referralSource: 'fortiva',
    referralFieldId: REFERRAL_FIELD,
  }, request);
  assert.equal(outcome.ok, true);
  assert.equal(calls[0].payload.customFields.length, 1);
  assert.equal(calls[0].payload.customFields[0].id, REFERRAL_FIELD);
  assert.deepEqual(calls[1].payload, { tags: ['member', 'paying-member', 'rep-john'] });
});

test('a failed add-tags call is not reported as success and does not retry the upsert', async () => {
  const { calls, request } = callsFor([
    { statusCode: 200, data: '{"contact":{"id":"c3"}}' },
    { statusCode: 500, data: 'no' },
  ]);
  const outcome = await ghl.syncPayingMember({
    email: 'ada@example.com',
    locationId: 'loc',
    planName: 'pln_x',
  }, request);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.tags.statusCode, 500);
  assert.equal(calls.filter((c) => c.path === '/contacts/upsert').length, 1);
  assert.equal(calls[1].path, '/contacts/c3/tags');
});

test('an upsert failure does not call add-tags', async () => {
  const { calls, request } = callsFor([{ statusCode: 422, data: '{}' }]);
  const outcome = await ghl.upsertThenAddTags(request, { email: 'a@b.co', locationId: 'loc', tags: ['wipe-me'] }, ['waitlist']);
  assert.equal(outcome.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.tags, undefined);
});

test('waitlist adds its tag after upsert and stays fail-open', async () => {
  const prevKey = process.env.GHL_API_KEY;
  const prevLoc = process.env.GHL_LOCATION_ID;
  process.env.GHL_API_KEY = 'k';
  process.env.GHL_LOCATION_ID = '3dQD2B6ZsBjZVIrWF8WR';
  try {
    const calls = [];
    const request = async ({ method, path: reqPath, payload }) => {
      calls.push({ method, path: reqPath, payload });
      if (reqPath === '/contacts/upsert') return { statusCode: 200, data: JSON.stringify({ contact: { id: 'w1' } }) };
      return { statusCode: 500, data: 'tag failed' };
    };
    const res = await waitlist.handle({ httpMethod: 'POST', body: 'email=a%40b.co' }, { request });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).success, true);
    assert.equal(calls[0].payload.tags, undefined);
    assert.equal(calls[0].payload.email, 'a@b.co');
    assert.equal(calls[1].path, '/contacts/w1/tags');
    assert.deepEqual(calls[1].payload, { tags: ['waitlist'] });

    const missing = await waitlist.handle({ httpMethod: 'POST', body: 'email=a%40b.co' }, { request });
    process.env.GHL_API_KEY = '';
    const noEnv = await waitlist.handle({ httpMethod: 'POST', body: 'email=a%40b.co' });
    assert.equal(noEnv.statusCode, 500);
    assert.equal(missing.statusCode, 200);
  } finally {
    if (prevKey === undefined) delete process.env.GHL_API_KEY;
    else process.env.GHL_API_KEY = prevKey;
    if (prevLoc === undefined) delete process.env.GHL_LOCATION_ID;
    else process.env.GHL_LOCATION_ID = prevLoc;
  }
});

test('memberstack webhook still returns 200 around the tag write and does not upsert tags', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/memberstack-webhook.js'), 'utf8');
  assert.match(src, /syncPayingMember\(/);
  assert.match(src, /sales-rep/);
  assert.match(src, /return json\(200, \{ received: true, synced: true, ghlResult \}\)/);
  assert.doesNotMatch(src, /tags,\s*\n/);
  const stripe = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/_Lib/fwn.js'), 'utf8');
  assert.match(stripe, /result\.action === 'ghl_failed' \? 500 : 200/);
  const dunning = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/_Lib/dunning.js'), 'utf8');
  assert.match(dunning, /add \? 'POST' : 'DELETE'/);
});
