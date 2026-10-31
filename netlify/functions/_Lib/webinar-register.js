// FORGE weekly live webinar registration. Not FWN.
//
// POST /api/webinar-register  { firstName, lastName, email, phone, smsConsent, src, ref }
// Upserts the contact into FORGE GHL (GHL_LOCATION_ID, the FORGE location only)
// with registration tags, then returns the Zoom join URL for the browser to
// redirect to. Nothing is sent to the registrant from here; any confirmation
// or reminder sequence lives in a GHL workflow keyed off the tags.
//
// Env vars:
//   GHL_API_KEY, GHL_LOCATION_ID   already set for memberstack-webhook.js
//   WEBINAR_ZOOM_URL               Zoom registration/join link (placeholder until set)
//   WEBINAR_NEXT_DATE              YYYY-MM-DD of the next live session (default 2026-11-17)
//
// Tags: forge-webinar-reg, webinar-<date>, src-<src>, plus sms-consent when
// the box is checked. fwn-virtual / fwn-raleigh are rejected so FWN stays on /fwn/.

const https = require('https');
const { json, preflight } = require('./http');

const DEFAULT_DATE = '2026-11-17';
const FWN_LEAD_SOURCES = new Set(['fwn-virtual', 'fwn-raleigh']);
const SMS_CONSENT_TEXT =
  'I agree to receive text messages from FORGE about this webinar and related offers. ' +
  'Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.';

function sanitize(v) {
  if (v == null) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

function cleanName(v) {
  return String(v || '').replace(/[<>]/g, '').trim().slice(0, 80);
}

function normalizePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '';
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));
}

function webinarDate(env) {
  const d = String(env.WEBINAR_NEXT_DATE || DEFAULT_DATE).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : DEFAULT_DATE;
}

function validate(body, env) {
  const errors = [];
  const firstName = cleanName(body.firstName);
  const lastName = cleanName(body.lastName);
  const email = String(body.email || '').trim().toLowerCase();
  const phone = normalizePhone(body.phone);
  const smsConsent = body.smsConsent === true || body.smsConsent === 'true';
  const src = sanitize(body.src);
  const ref = sanitize(body.ref);

  if (!firstName) errors.push('firstName required');
  if (!isEmail(email)) errors.push('valid email required');
  if (!phone) errors.push('valid US phone required');
  if (!src) errors.push('src required');
  if (FWN_LEAD_SOURCES.has(src)) errors.push('FWN sources register on /fwn/');

  const date = webinarDate(env);
  const tags = ['forge-webinar-reg', `webinar-${date}`];
  if (src) tags.push(`src-${src}`);
  if (ref) tags.push(`ref-${ref}`);
  if (smsConsent) tags.push('sms-consent');

  return {
    ok: errors.length === 0,
    errors,
    contact: { firstName, lastName, email, phone, smsConsent, src, ref, tags, date },
  };
}

function buildPayload(contact, locationId) {
  return {
    locationId,
    firstName: contact.firstName,
    lastName: contact.lastName || undefined,
    email: contact.email,
    phone: contact.phone,
    source: `forge-webinar:${contact.src}`,
    tags: contact.tags,
    // DND stays untouched unless consent was given; GHL keeps opt-out state.
  };
}

function ghlUpsert(payload, env, request = https.request) {
  const apiKey = env.GHL_API_KEY;
  if (!apiKey || !payload.locationId) {
    return Promise.resolve({ skipped: true, reason: 'missing GHL env vars' });
  }
  const body = JSON.stringify(payload);
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: 'services.leadconnectorhq.com',
        path: '/contacts/upsert',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      }
    );
    req.on('error', (err) => resolve({ error: err.message }));
    req.write(body);
    req.end();
  });
}

async function registerHandler(event, options = {}) {
  const env = options.env || process.env;
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'invalid JSON' }); }
  if (body.website) return json(200, { ok: true, redirect: '/webinar/thank-you' }); // honeypot

  const v = validate(body, env);
  if (!v.ok) return json(400, { error: v.errors.join('; ') });

  const result = await ghlUpsert(buildPayload(v.contact, env.GHL_LOCATION_ID), env, options.request);
  const ghlOk = result.statusCode >= 200 && result.statusCode < 300;
  if (!ghlOk) console.error('webinar-register GHL upsert failed', result.statusCode || result.error || result.reason);

  const zoom = String(env.WEBINAR_ZOOM_URL || '').trim();
  // If the Zoom link is not configured yet, the registrant lands on a holding page.
  const redirect = /^https:\/\//.test(zoom) ? zoom : `/webinar/registered?date=${v.contact.date}`;
  return json(200, { ok: true, ghl: ghlOk, date: v.contact.date, redirect });
}

module.exports = {
  SMS_CONSENT_TEXT,
  sanitize,
  normalizePhone,
  validate,
  buildPayload,
  ghlUpsert,
  registerHandler,
};
