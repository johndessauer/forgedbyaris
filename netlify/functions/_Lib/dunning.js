// FORGE failed-payment (dunning) tagging.
//
// Stripe invoice events for subscriptions (created by Memberstack checkout
// on the FORGE Stripe account) toggle the GHL tag `payment-failed` on the
// matching FORGE contact (matched by email):
//   invoice.payment_failed                 -> add `payment-failed`
//   invoice.paid / invoice.payment_succeeded -> remove `payment-failed`
// The GHL workflow "FORGE Past-Due Dunning" starts on the tag being added
// and exits when it is removed. Its emails link to /billing, which opens the
// Memberstack-managed Stripe customer portal for the signed-in member.
//
// Env: GHL_API_KEY and GHL_LOCATION_ID (already used by
// memberstack-webhook.js). This never creates a contact, charges, or
// changes anything in Stripe or Memberstack.

const https = require('https');

const TAG = 'payment-failed';
const FAIL_EVENTS = new Set(['invoice.payment_failed']);
const PAID_EVENTS = new Set(['invoice.paid', 'invoice.payment_succeeded']);
const BILLING_URL = 'https://forgedbyaris.com/billing';

function isDunningEvent(stripeEvent) {
  const type = stripeEvent && stripeEvent.type;
  return FAIL_EVENTS.has(type) || PAID_EVENTS.has(type);
}

function invoiceSubscriptionId(invoice) {
  if (!invoice) return '';
  const sub = invoice.subscription
    || (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription);
  if (!sub) return '';
  return typeof sub === 'string' ? sub : String(sub.id || '');
}

function ghlRequest(apiKey, method, path, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'services.leadconnectorhq.com',
      path: path,
      method: method,
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Version: '2021-07-28',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (err) { parsed = {}; }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });
    req.on('error', (err) => resolve({ statusCode: 0, error: err.message }));
    req.on('timeout', () => req.destroy(new Error('GHL timed out')));
    if (body) req.write(body);
    req.end();
  });
}

async function findContactId(request, apiKey, locationId, email) {
  const res = await request(apiKey, 'GET', '/contacts/search/duplicate?locationId='
    + encodeURIComponent(locationId) + '&email=' + encodeURIComponent(email));
  const contact = res && res.body && res.body.contact;
  return contact && contact.id ? contact.id : '';
}

async function handleDunningEvent(stripeEvent, env, deps) {
  const options = deps || {};
  const request = options.ghlRequest || ghlRequest;
  const type = stripeEvent.type;
  const invoice = (stripeEvent.data && stripeEvent.data.object) || {};
  if (!invoiceSubscriptionId(invoice)) return { action: 'ignored', reason: 'not_subscription' };
  const email = String(invoice.customer_email || '').trim().toLowerCase();
  if (!email) return { action: 'ignored', reason: 'no_email' };
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return { action: 'skipped', reason: 'no_ghl_env' };

  const contactId = await findContactId(request, env.GHL_API_KEY, env.GHL_LOCATION_ID, email);
  if (!contactId) return { action: 'skipped', reason: 'no_contact' };

  const add = FAIL_EVENTS.has(type);
  const res = await request(env.GHL_API_KEY, add ? 'POST' : 'DELETE',
    '/contacts/' + encodeURIComponent(contactId) + '/tags', { tags: [TAG] });
  const ok = res && res.statusCode >= 200 && res.statusCode < 300;
  if (!ok) console.error('GHL tag update failed', res && res.statusCode);
  return { action: ok ? (add ? 'tagged' : 'untagged') : 'ghl_failed', contactId: contactId };
}

module.exports = { TAG, BILLING_URL, isDunningEvent, invoiceSubscriptionId, handleDunningEvent, ghlRequest };
