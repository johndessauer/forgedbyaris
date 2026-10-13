// netlify/functions/_Lib/comps-alerts.js
//
// Budget alerts for the comping engine (brief §5.2.3, John's choice Oct 12,
// 2026: "both" email and a GHL alert). Delivered through GoHighLevel:
//
//   1. For each address in COMPS_ALERT_EMAILS, upsert the GHL contact by
//      email WITHOUT a tags field (sending tags in an upsert can overwrite
//      a contact's existing tags — the tag-wipe bug).
//   2. Remove, then add, ONE alert tag via the tag endpoints, so the
//      "tag added" workflow trigger fires again each month:
//        forge-comps-budget-80   — spend reached 80% of the monthly cap
//        forge-comps-budget-100  — spend reached the cap / a call was refused
//        forge-comps-1000-calls  — over 1,000 calls this month
//      Only this alert tag is ever removed. No other tag is touched.
//   3. A GHL workflow John builds (trigger: tag added) emails John and Simon
//      and creates an internal notification.
//
// Each alert fires at most once per month: the once-only flag lives on the
// rentcast_budget row and is flipped atomically in reserve_rentcast_call().
// Alert failures are logged and never block a comp lookup.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const ALERT_TAGS = Object.freeze({
  pct80: 'forge-comps-budget-80',
  pct100: 'forge-comps-budget-100',
  calls1000: 'forge-comps-1000-calls',
});

function alertEmails(env) {
  return String(env.COMPS_ALERT_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

async function ghl(fetchImpl, env, method, path, body) {
  const res = await fetchImpl(`${GHL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Version: GHL_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, ok: res.ok, data };
}

// kind: 'pct80' | 'pct100' | 'calls1000'
async function sendAlert(kind, { env, fetchImpl, log = console }) {
  const tag = ALERT_TAGS[kind];
  const emails = alertEmails(env);
  if (!tag) return { sent: 0, skipped: 'unknown alert kind' };
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) {
    log.error(`Comps alert ${tag}: GHL env vars missing — alert not delivered`);
    return { sent: 0, skipped: 'missing GHL env vars' };
  }
  if (!emails.length) {
    log.error(`Comps alert ${tag}: COMPS_ALERT_EMAILS is empty — alert not delivered`);
    return { sent: 0, skipped: 'no alert emails' };
  }

  let sent = 0;
  for (const email of emails) {
    try {
      // NO tags in this body — see note at the top of the file.
      const up = await ghl(fetchImpl, env, 'POST', '/contacts/upsert', { email, locationId: env.GHL_LOCATION_ID });
      const contactId = up.data && (up.data.contact && up.data.contact.id || up.data.id);
      if (!up.ok || !contactId) { log.error(`Comps alert ${tag}: upsert failed for alert contact`, up.status); continue; }
      await ghl(fetchImpl, env, 'DELETE', `/contacts/${contactId}/tags`, { tags: [tag] });
      const add = await ghl(fetchImpl, env, 'POST', `/contacts/${contactId}/tags`, { tags: [tag] });
      if (add.ok) sent += 1; else log.error(`Comps alert ${tag}: add tag failed`, add.status);
    } catch (err) {
      log.error(`Comps alert ${tag}: request error`, err && err.message);
    }
  }
  return { sent };
}

module.exports = { ALERT_TAGS, alertEmails, sendAlert };
