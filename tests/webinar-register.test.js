const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const reg = require('../netlify/functions/_Lib/webinar-register');

const ENV = { GHL_API_KEY: 'k', GHL_LOCATION_ID: '3dQD2B6ZsBjZVIrWF8WR', WEBINAR_JOIN_URL: 'https://meet.google.com/abc-defg-hij' };
const good = { firstName: 'Joe', lastName: 'Investor', email: 'Joe@Example.com', phone: '(555) 555-1234', smsConsent: true, src: '023k', ref: 'eddie' };

// Fake https.request. Duplicate lookup (GET) returns lookupBody; upsert (POST) returns upsertStatus.
function fakeRequest(capture, { lookupBody = { contact: null }, lookupStatus = 200, upsertStatus = 200 } = {}) {
  capture.calls = [];
  return (opts, cb) => {
    const req = new EventEmitter();
    let sent = null;
    req.write = (b) => { sent = JSON.parse(b); };
    req.end = () => {
      capture.calls.push({ method: opts.method, path: opts.path, body: sent });
      if (opts.method === 'POST') { capture.opts = opts; capture.body = sent; }
      const res = new EventEmitter();
      const isGet = opts.method === 'GET';
      res.statusCode = isGet ? lookupStatus : upsertStatus;
      cb(res);
      res.emit('data', JSON.stringify(isGet ? lookupBody : {}));
      res.emit('end');
    };
    return req;
  };
}

test('validate builds tags with dated webinar tag', () => {
  const v = reg.validate(good, {});
  assert.equal(v.ok, true);
  assert.equal(v.contact.phone, '+15555551234');
  assert.equal(v.contact.email, 'joe@example.com');
  assert.deepEqual(v.contact.tags, ['forge-webinar-reg', 'webinar-2026-11-17', 'src-023k', 'ref-eddie', 'sms-consent']);
});

test('WEBINAR_NEXT_DATE overrides the dated tag', () => {
  const v = reg.validate(good, { WEBINAR_NEXT_DATE: '2026-11-24' });
  assert.ok(v.contact.tags.includes('webinar-2026-11-24'));
});

test('no sms-consent tag without consent', () => {
  const v = reg.validate({ ...good, smsConsent: false }, {});
  assert.ok(!v.contact.tags.includes('sms-consent'));
});

test('rejects FWN sources, missing src, bad phone', () => {
  assert.equal(reg.validate({ ...good, src: 'fwn-virtual' }, {}).ok, false);
  assert.equal(reg.validate({ ...good, src: '' }, {}).ok, false);
  assert.equal(reg.validate({ ...good, phone: '123' }, {}).ok, false);
});

test('handler upserts to FORGE location and redirects to the live session link', async () => {
  const cap = {};
  const res = await reg.registerHandler({ httpMethod: 'POST', body: JSON.stringify(good) }, { env: ENV, request: fakeRequest(cap) });
  const j = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(j.redirect, 'https://meet.google.com/abc-defg-hij');
  assert.equal(cap.opts.path, '/contacts/upsert');
  assert.equal(cap.body.locationId, '3dQD2B6ZsBjZVIrWF8WR');
  assert.ok(cap.body.tags.includes('forge-webinar-reg'));
});

test('handler falls back to holding page when the live session link is unset', async () => {
  const cap = {};
  const res = await reg.registerHandler({ httpMethod: 'POST', body: JSON.stringify(good) }, { env: { ...ENV, WEBINAR_JOIN_URL: '' }, request: fakeRequest(cap) });
  assert.equal(JSON.parse(res.body).redirect, '/webinar/registered?date=2026-11-17');
});

test('handler rejects other methods and bad input', async () => {
  assert.equal((await reg.registerHandler({ httpMethod: 'PUT' }, { env: ENV })).statusCode, 405);
  assert.equal((await reg.registerHandler({ httpMethod: 'POST', body: '{}' }, { env: ENV })).statusCode, 400);
});

test('sessionInfo defaults to Tuesday, November 17, 2026 at 7:00 PM CT', () => {
  assert.deepEqual(reg.sessionInfo({}), {
    date: '2026-11-17', time: '7:00 PM CT', weekday: 'Tuesday',
    label: 'Tuesday, November 17, 2026 at 7:00 PM CT',
  });
});

test('sessionInfo computes the weekday from WEBINAR_NEXT_DATE and uses WEBINAR_NEXT_TIME', () => {
  assert.equal(reg.sessionInfo({ WEBINAR_NEXT_DATE: '2026-11-18', WEBINAR_NEXT_TIME: '6:30 PM CT' }).label,
    'Wednesday, November 18, 2026 at 6:30 PM CT');
  assert.equal(reg.sessionInfo({ WEBINAR_NEXT_DATE: '2026-11-19' }).label,
    'Thursday, November 19, 2026 at 7:00 PM CT');
});

test('invalid WEBINAR_NEXT_DATE falls back to the default', () => {
  assert.equal(reg.sessionInfo({ WEBINAR_NEXT_DATE: '2026-02-30' }).date, '2026-11-17');
  assert.equal(reg.sessionInfo({ WEBINAR_NEXT_DATE: 'next week' }).date, '2026-11-17');
});

test('GET returns the session info for the pages', async () => {
  const res = await reg.registerHandler({ httpMethod: 'GET' }, { env: { WEBINAR_NEXT_DATE: '2026-11-18', WEBINAR_NEXT_TIME: '7:00 PM CT' } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).label, 'Wednesday, November 18, 2026 at 7:00 PM CT');
});

test('pages do not hard-code a recurring weekday', () => {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['register.html', 'registered.html', 'replay.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'webinar', f), 'utf8');
    assert.doesNotMatch(html, /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/, f);
  }
});

test('existing FORGE member (paying-member tag) goes to holding page without tagging', async () => {
  const cap = {};
  const req = fakeRequest(cap, { lookupBody: { contact: { id: 'c1', tags: ['member', 'paying-member', 'FORGE 997'] } } });
  const res = await reg.registerHandler({ httpMethod: 'POST', body: JSON.stringify(good) }, { env: ENV, request: req });
  const j = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(j.member, true);
  assert.equal(j.redirect, '/webinar/registered?date=2026-11-17');
  assert.equal(cap.calls.length, 1);
  assert.equal(cap.calls[0].method, 'GET');
  assert.match(cap.calls[0].path, /^\/contacts\/search\/duplicate\?locationId=3dQD2B6ZsBjZVIrWF8WR&email=joe%40example\.com$/);
  assert.ok(!cap.calls.some((c) => c.method === 'POST'));
});

test('member tag match is case-insensitive and covers member / paying-member only', () => {
  assert.equal(reg.hasMemberTag(['Paying-Member']), true);
  assert.equal(reg.hasMemberTag(['member']), true);
  assert.equal(reg.hasMemberTag(['waitlist', 'forge-webinar-reg']), false);
  assert.equal(reg.hasMemberTag(undefined), false);
});

test('non-member contact is tagged and sent to the live session link', async () => {
  const cap = {};
  const req = fakeRequest(cap, { lookupBody: { contact: { id: 'c2', tags: ['waitlist'] } } });
  const j = JSON.parse((await reg.registerHandler({ httpMethod: 'POST', body: JSON.stringify(good) }, { env: ENV, request: req })).body);
  assert.equal(j.redirect, 'https://meet.google.com/abc-defg-hij');
  assert.deepEqual(cap.calls.map((c) => c.method), ['GET', 'POST']);
});

test('member lookup failure fails open and still registers', async () => {
  const cap = {};
  const req = fakeRequest(cap, { lookupStatus: 500 });
  const j = JSON.parse((await reg.registerHandler({ httpMethod: 'POST', body: JSON.stringify(good) }, { env: ENV, request: req })).body);
  assert.equal(j.redirect, 'https://meet.google.com/abc-defg-hij');
  assert.ok(cap.body.tags.includes('forge-webinar-reg'));
});

test('only Google Meet: no other video-platform references remain', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  for (const f of ['netlify/functions/_Lib/webinar-register.js', 'netlify/functions/webinar-register.js', 'netlify/functions/webinar-join.js',
    'webinar/register.html', 'webinar/registered.html', 'webinar/replay.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /z[o]om/i, f);
  }
});

// ---- /webinar/join attendance link ----
const MEET = 'https://meet.google.com/ptf-kebj-kjr';
const JENV = { ...ENV, WEBINAR_JOIN_URL: MEET, WEBINAR_NEXT_DATE: '2026-11-17' };
const join = (q, opts) => reg.joinHandler({ httpMethod: 'GET', queryStringParameters: q }, opts);

test('join with contact id tags webinar-joined-<s> and 302s to the join URL', async () => {
  const cap = {};
  const res = await join({ e: 'AbC123xyz0987', s: '2026-11-18' }, { env: JENV, request: fakeRequest(cap) });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, MEET);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['X-Forge-Join-Tagged'], '1');
  assert.deepEqual(cap.calls.map((c) => c.method), ['POST']);
  assert.equal(cap.calls[0].path, '/contacts/AbC123xyz0987/tags');
  assert.deepEqual(cap.calls[0].body, { tags: ['webinar-joined-2026-11-18'] });
});

test('join defaults the tag date to WEBINAR_NEXT_DATE when s is missing or invalid', async () => {
  for (const s of [undefined, 'tuesday', '2026-02-30']) {
    const cap = {};
    await join({ e: 'AbC123xyz0987', s }, { env: JENV, request: fakeRequest(cap) });
    assert.deepEqual(cap.body, { tags: ['webinar-joined-2026-11-17'] });
  }
});

test('join with email looks the contact up first, then tags it', async () => {
  const cap = {};
  const req = fakeRequest(cap, { lookupBody: { contact: { id: 'Contact0001XYZ', tags: [] } } });
  const res = await join({ e: 'Joe@Example.com' }, { env: JENV, request: req });
  assert.equal(res.headers.Location, MEET);
  assert.deepEqual(cap.calls.map((c) => c.method), ['GET', 'POST']);
  assert.match(cap.calls[0].path, /email=joe%40example\.com/);
  assert.equal(cap.calls[1].path, '/contacts/Contact0001XYZ/tags');
});

test('join still redirects when the identifier is missing or junk (no GHL calls)', async () => {
  for (const e of [undefined, '', 'not an id!', '<script>']) {
    const cap = {};
    const res = await join({ e }, { env: JENV, request: fakeRequest(cap) });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, MEET);
    assert.equal(res.headers['X-Forge-Join-Tagged'], '0');
    assert.equal(cap.calls.length, 0);
  }
});

test('join still redirects when the email lookup finds nobody or fails', async () => {
  for (const o of [{ lookupBody: { contact: null } }, { lookupStatus: 500 }]) {
    const cap = {};
    const res = await join({ e: 'joe@example.com' }, { env: JENV, request: fakeRequest(cap, o) });
    assert.equal(res.headers.Location, MEET);
    assert.ok(!cap.calls.some((c) => c.method === 'POST'));
  }
});

test('join still redirects when tagging fails or the request throws', async () => {
  const cap = {};
  let res = await join({ e: 'AbC123xyz0987' }, { env: JENV, request: fakeRequest(cap, { upsertStatus: 422 }) });
  assert.equal(res.headers.Location, MEET);
  assert.equal(res.headers['X-Forge-Join-Tagged'], '0');
  res = await join({ e: 'AbC123xyz0987' }, { env: JENV, request: () => { throw new Error('boom'); } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, MEET);
});

test('join falls back to the holding page when WEBINAR_JOIN_URL is unset', async () => {
  const res = await join({ e: 'AbC123xyz0987' }, { env: { ...JENV, WEBINAR_JOIN_URL: '' }, request: fakeRequest({}) });
  assert.equal(res.headers.Location, '/webinar/registered?date=2026-11-17');
});

test('join still redirects when GHL env vars are missing', async () => {
  const res = await join({ e: 'AbC123xyz0987' }, { env: { WEBINAR_JOIN_URL: MEET } });
  assert.equal(res.headers.Location, MEET);
});

test('netlify.toml routes /webinar/join to the function', () => {
  const toml = require('fs').readFileSync(require('path').join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.match(toml, /from = "\/webinar\/join"\s+to = "\/\.netlify\/functions\/webinar-join"\s+status = 200\s+force = true/);
});
