const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fwn = require('../netlify/functions/_Lib/fwn');

const SECRET = 'whsec_test_secret';
const TS = 1760000000;
const ENV = { STRIPE_WEBHOOK_SECRET: SECRET, GHL_API_KEY: 'k', GHL_LOCATION_ID: '3dQD2B6ZsBjZVIrWF8WR' };

function signed(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(TS + '.' + raw).digest('hex');
  return { httpMethod: 'POST', headers: { 'stripe-signature': 't=' + TS + ',v1=' + sig }, body: raw };
}

function fakeGhl(calls, contact) {
  return async (key, method, path, body) => {
    calls.push({ method, path, body });
    if (path.startsWith('/contacts/search/duplicate')) return { statusCode: 200, body: { contact } };
    return { statusCode: 200, body: {} };
  };
}

const invoice = { id: 'in_1', subscription: 'sub_1', customer_email: 'Member@Example.com' };

test('invoice.payment_failed adds payment-failed tag', async () => {
  const calls = [];
  const res = await fwn.webhookHandler(signed({ type: 'invoice.payment_failed', data: { object: invoice } }),
    { env: ENV, nowSec: TS, ghlRequest: fakeGhl(calls, { id: 'c1' }) });
  assert.equal(JSON.parse(res.body).dunning, 'tagged');
  assert.ok(calls[0].path.includes('email=member%40example.com'));
  assert.deepEqual(calls[1], { method: 'POST', path: '/contacts/c1/tags', body: { tags: ['payment-failed'] } });
});

test('invoice.paid and payment_succeeded remove the tag', async () => {
  for (const type of ['invoice.paid', 'invoice.payment_succeeded']) {
    const calls = [];
    const res = await fwn.webhookHandler(signed({ type, data: { object: invoice } }),
      { env: ENV, nowSec: TS, ghlRequest: fakeGhl(calls, { id: 'c1' }) });
    assert.equal(JSON.parse(res.body).dunning, 'untagged');
    assert.equal(calls[1].method, 'DELETE');
  }
});

test('non-subscription invoice, unknown contact, and bad signature are ignored', async () => {
  const calls = [];
  let res = await fwn.webhookHandler(signed({ type: 'invoice.payment_failed', data: { object: { customer_email: 'a@b.co' } } }),
    { env: ENV, nowSec: TS, ghlRequest: fakeGhl(calls, { id: 'c1' }) });
  assert.equal(JSON.parse(res.body).reason, 'not_subscription');
  res = await fwn.webhookHandler(signed({ type: 'invoice.payment_failed', data: { object: invoice } }),
    { env: ENV, nowSec: TS, ghlRequest: fakeGhl(calls, null) });
  assert.equal(JSON.parse(res.body).reason, 'no_contact');
  assert.equal(calls.filter((c) => c.path.endsWith('/tags')).length, 0);
  const bad = signed({ type: 'invoice.payment_failed', data: { object: invoice } });
  bad.body = bad.body.replace('in_1', 'in_2');
  res = await fwn.webhookHandler(bad, { env: ENV, nowSec: TS, ghlRequest: fakeGhl(calls, { id: 'c1' }) });
  assert.equal(res.statusCode, 400);
});
