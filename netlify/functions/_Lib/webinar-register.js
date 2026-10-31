// FORGE weekly live webinar registration. Not FWN.
//
// POST /api/webinar-register  { firstName, lastName, email, phone, smsConsent, src, ref }
// Upserts the contact into FORGE GHL (GHL_LOCATION_ID, the FORGE location only)
// with registration tags, then returns the live session link (Google Meet)
// for the browser to redirect to. Nothing is sent to the registrant from here; any confirmation
// or reminder sequence lives in a GHL workflow keyed off the tags.
//
// Env vars:
//   GHL_API_KEY, GHL_LOCATION_ID   already set for memberstack-webhook.js
//   WEBINAR_JOIN_URL               live session link (Google Meet); holding page until set
//   WEBINAR_NEXT_DATE              YYYY-MM-DD of the next live session (default 2026-11-17)
//   WEBINAR_NEXT_TIME              display time of the next session (default "7:00 PM CT")
//
// Sessions can fall on any weekday at any time, so nothing here names a
// recurring day. GET /api/webinar-register returns { date, time, weekday, label }
// and the pages render the label, e.g. "Tuesday, November 17, 2026 at 7:00 PM CT".
//
// Tags: forge-webinar-reg, webinar-<date>, src-<src>, plus sms-consent when
// the box is checked. fwn-virtual / fwn-raleigh are rejected so FWN stays on /fwn/.

const https = require('https');
const { json, preflight } = require('./http');

const DEFAULT_DATE = '2026-11-17';
const DEFAULT_TIME = '7:00 PM CT';

// Existing FORGE members are not re-tagged as webinar registrants. The
// memberstack-webhook.js upsert gives every paying member both 'member' and
// 'paying-member'; either one counts. GHL stores tags lowercase.
const MEMBER_TAGS = ['paying-member', 'member'];
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return DEFAULT_DATE;
  const t = new Date(d + 'T12:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === d ? d : DEFAULT_DATE;
}

function webinarTime(env) {
  const t = String(env.WEBINAR_NEXT_TIME || '').replace(/[<>]/g, '').trim().slice(0, 40);
  return t || DEFAULT_TIME;
}

// Weekday and long date are computed from the YYYY-MM-DD in UTC, so the
// calendar day never shifts with the server's timezone.
function sessionInfo(env) {
  const date = webinarDate(env);
  const time = webinarTime(env);
  const d = new Date(date + 'T12:00:00Z');
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const longDate = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return { date, time, weekday, label: `${weekday}, ${longDate} at ${time}` };
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

function ghlRequest({ method, path, payload }, env, request = https.request) {
  const apiKey = env.GHL_API_KEY;
  if (!apiKey || !env.GHL_LOCATION_ID) {
    return Promise.resolve({ skipped: true, reason: 'missing GHL env vars' });
  }
  const body = payload ? JSON.stringify(payload) : null;
  const headers = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve) => {
    const req = request({ hostname: 'services.leadconnectorhq.com', path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', (err) => resolve({ error: err.message }));
    if (body) req.write(body);
    req.end();
  });
}

function ghlUpsert(payload, env, request) {
  return ghlRequest({ method: 'POST', path: '/contacts/upsert', payload }, env, request);
}

function hasMemberTag(tags) {
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => MEMBER_TAGS.includes(String(t).trim().toLowerCase()));
}

// Looks up the existing contact by email in the FORGE location. Fails open:
// if the lookup errors, the registrant is treated as a non-member.
async function isExistingMember(email, env, request) {
  const q = `locationId=${encodeURIComponent(env.GHL_LOCATION_ID || '')}&email=${encodeURIComponent(email)}`;
  const res = await ghlRequest({ method: 'GET', path: `/contacts/search/duplicate?${q}` }, env, request);
  if (!(res.statusCode >= 200 && res.statusCode < 300)) return false;
  try {
    const parsed = JSON.parse(res.data || '{}');
    return hasMemberTag(parsed.contact && parsed.contact.tags);
  } catch (e) {
    return false;
  }
}

async function registerHandler(event, options = {}) {
  const env = options.env || process.env;
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod === 'GET') return json(200, sessionInfo(env));
  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'invalid JSON' }); }
  if (body.website) return json(200, { ok: true, redirect: '/webinar/thank-you' }); // honeypot

  const v = validate(body, env);
  if (!v.ok) return json(400, { error: v.errors.join('; ') });

  const holding = `/webinar/registered?date=${v.contact.date}`;
  if (await isExistingMember(v.contact.email, env, options.request)) {
    // Already a FORGE member: no webinar tags, straight to the holding page.
    return json(200, { ok: true, member: true, ghl: false, date: v.contact.date, session: sessionInfo(env).label, redirect: holding });
  }

  const result = await ghlUpsert(buildPayload(v.contact, env.GHL_LOCATION_ID), env, options.request);
  const ghlOk = result.statusCode >= 200 && result.statusCode < 300;
  if (!ghlOk) console.error('webinar-register GHL upsert failed', result.statusCode || result.error || result.reason);

  const joinUrl = String(env.WEBINAR_JOIN_URL || '').trim();
  // If the live session link is not configured yet, the registrant lands on the holding page.
  const redirect = /^https:\/\//.test(joinUrl) ? joinUrl : holding;
  return json(200, { ok: true, ghl: ghlOk, date: v.contact.date, session: sessionInfo(env).label, redirect });
}

// ---------------------------------------------------------------------------
// GET /webinar/join?e=<GHL contact id or email>&s=<YYYY-MM-DD>
//
// Attendance tracking link for reminder emails/texts. Tags the FORGE GHL
// contact webinar-joined-<s> (default WEBINAR_NEXT_DATE), then 302s to
// WEBINAR_JOIN_URL (Google Meet). The redirect ALWAYS happens: a missing or
// unknown identifier, or a GHL error, only skips the tag.
//
// Prefer the contact id so emails stay out of URLs. In GHL reminder links use:
//   https://forgedbyaris.com/webinar/join?e={{contact.id}}&s=2026-11-17
// ---------------------------------------------------------------------------

const CONTACT_ID_RE = /^[A-Za-z0-9]{10,40}$/;

function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false;
  const t = new Date(d + 'T12:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === d;
}

async function resolveContactId(identifier, env, request) {
  const id = String(identifier || '').trim();
  if (!id) return '';
  if (CONTACT_ID_RE.test(id)) return id;
  if (!isEmail(id)) return '';
  const q = `locationId=${encodeURIComponent(env.GHL_LOCATION_ID || '')}&email=${encodeURIComponent(id.toLowerCase())}`;
  const res = await ghlRequest({ method: 'GET', path: `/contacts/search/duplicate?${q}` }, env, request);
  if (!(res.statusCode >= 200 && res.statusCode < 300)) return '';
  try {
    const c = JSON.parse(res.data || '{}').contact;
    return c && c.id ? String(c.id) : '';
  } catch (e) {
    return '';
  }
}

function joinRedirect(env, date) {
  const url = String(env.WEBINAR_JOIN_URL || '').trim();
  const location = /^https:\/\//.test(url) ? url : `/webinar/registered?date=${date}`;
  return { statusCode: 302, headers: { Location: location, 'Cache-Control': 'no-store' }, body: '' };
}

async function joinHandler(event, options = {}) {
  const env = options.env || process.env;
  const q = event.queryStringParameters || {};
  const date = validDate(q.s) ? q.s : webinarDate(env);
  const tag = `webinar-joined-${date}`;
  let tagged = false;
  try {
    const contactId = await resolveContactId(q.e, env, options.request);
    if (contactId) {
      const res = await ghlRequest(
        { method: 'POST', path: `/contacts/${encodeURIComponent(contactId)}/tags`, payload: { tags: [tag] } },
        env,
        options.request
      );
      tagged = res.statusCode >= 200 && res.statusCode < 300;
      if (!tagged) console.error('webinar-join tag failed', res.statusCode || res.error || res.reason);
    }
  } catch (err) {
    console.error('webinar-join error', err && err.message);
  }
  const out = joinRedirect(env, date);
  out.headers['X-Forge-Join-Tagged'] = tagged ? '1' : '0';
  return out;
}

module.exports = {
  joinHandler,
  resolveContactId,

  SMS_CONSENT_TEXT,
  sanitize,
  normalizePhone,
  validate,
  sessionInfo,
  DEFAULT_DATE,
  DEFAULT_TIME,
  buildPayload,
  ghlUpsert,
  ghlRequest,
  hasMemberTag,
  isExistingMember,
  MEMBER_TAGS,
  registerHandler,
};
