const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const reg = require('../netlify/functions/_Lib/webinar-register');

const ENV = { GHL_API_KEY: 'k', GHL_LOCATION_ID: '3dQD2B6ZsBjZVIrWF8WR', WEBINAR_ZOOM_URL: 'https://zoom.us/j/123' };
const good = { firstName: 'Joe', lastName: 'Investor', email: 'Joe@Example.com', phone: '(555) 555-1234', smsConsent: true, src: '023k', ref: 'eddie' };

function fakeRequest(status, capture) {
  return (opts, cb) => {
    const req = new EventEmitter();
    req.write = (b) => { capture.opts = opts; capture.body = JSON.parse(b); };
    req.end = () => { const res = new EventEmitter(); res.statusCode = status; cb(res); res.emit('data', '{}'); res.emit('end'); };
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

test('handler upserts to FORGE location and redirects to Zoom', async () => {
  const cap = {};
  const res = await reg.registerHandler({ httpMethod: 'POST', body: JSON.stringify(good) }, { env: ENV, request: fakeRequest(200, cap) });
  const j = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(j.redirect, 'https://zoom.us/j/123');
  assert.equal(cap.opts.path, '/contacts/upsert');
  assert.equal(cap.body.locationId, '3dQD2B6ZsBjZVIrWF8WR');
  assert.ok(cap.body.tags.includes('forge-webinar-reg'));
});

test('handler falls back to holding page when Zoom URL is unset', async () => {
  const cap = {};
  const res = await reg.registerHandler({ httpMethod: 'POST', body: JSON.stringify(good) }, { env: { ...ENV, WEBINAR_ZOOM_URL: '' }, request: fakeRequest(200, cap) });
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
