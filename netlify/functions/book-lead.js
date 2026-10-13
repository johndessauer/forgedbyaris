// netlify/functions/book-lead.js
// Apartment Confidential book-page lead capture -> GHL (API v2, Private Integration Token).
// Env: GHL_API_KEY (PIT with contacts.write), GHL_LOCATION_ID. Same as waitlist-subscribe.js.
//
// Tags are NOT sent on the upsert: a `tags` array on /contacts/upsert can replace an existing
// contact's tags (the known memberstack-webhook.js tag-wipe risk). Upsert first, then add tags
// with POST /contacts/{id}/tags, which only appends.
const https = require('https');

const REFERRAL_SOURCE_FIELD_ID = '4UsHzTuolKkrrtBov1hM'; // same field as memberstack-webhook.js
const TAGS = ['book-apartment-confidential', 'src-book-page'];
const OK = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"success":true}' };

function ghl(path, body, apiKey) {
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'services.leadconnectorhq.com', path, method: 'POST', timeout: 8000,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', Version: '2021-07-28', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, json: j, raw: d.slice(0, 300) }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: 0, json: null, raw: String(err) }));
    req.write(payload); req.end();
  });
}

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const API_KEY = process.env.GHL_API_KEY, LOCATION_ID = process.env.GHL_LOCATION_ID;
  if (!API_KEY || !LOCATION_ID) { console.error('Missing GHL env vars'); return { statusCode: 500, body: '{"error":"config"}' }; }
  if ((event.body || '').length > 5000) return { statusCode: 413, body: '{"error":"too large"}' };

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: '{"error":"bad body"}' }; }
  if (b.company_website) return OK; // honeypot: pretend success

  const firstName = clean(b.firstName, 80);
  const email = clean(b.email, 200).toLowerCase();
  const phone = clean(b.phone, 40);
  if (!firstName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.replace(/\D/g, '').length < 10) {
    return { statusCode: 400, body: '{"error":"invalid fields"}' };
  }
  const ref = clean(b.ref, 100);
  const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
    .map(k => b[k] ? `${k}=${clean(b[k], 100)}` : '').filter(Boolean).join('&');

  const contact = { firstName, email, phone, locationId: LOCATION_ID, source: 'Apartment Confidential book page' + (utm ? ` (${utm})` : '') };
  if (ref) contact.customFields = [{ id: REFERRAL_SOURCE_FIELD_ID, field_value: ref }];

  const up = await ghl('/contacts/upsert', contact, API_KEY);
  const id = up.json && up.json.contact && up.json.contact.id;
  if (up.status < 200 || up.status >= 300 || !id) { console.error('GHL upsert failed', up.status, up.raw); return OK; } // fail open like waitlist-subscribe

  const t = await ghl(`/contacts/${encodeURIComponent(id)}/tags`, { tags: TAGS }, API_KEY);
  if (t.status < 200 || t.status >= 300) console.error('GHL add-tags failed', t.status, t.raw);
  return OK;
};
