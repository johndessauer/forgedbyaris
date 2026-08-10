// netlify/functions/memberstack-webhook.js
//
// Receives Memberstack webhook events and syncs actual PAYING members into
// GoHighLevel — separate from waitlist-subscribe.js, which only handles
// pre-launch waitlist signups.
//
// Deliberately triggers on 'member.plan.added' (fires when a plan is
// actually attached to a member), not 'member.created' (fires at account
// creation, which can happen before checkout completes depending on the
// signup flow). This is what keeps GHL populated with real paying members
// rather than everyone who merely started signing up.
//
// SETUP REQUIRED (do this after deploying):
//   1. In Memberstack: Dev Tools > Webhooks > Add endpoint.
//      URL: https://forgedbyaris.com/api/memberstack-webhook
//      Events: select only "member.plan.added" (Message Filtering step) —
//      leaving other events unfiltered would send everything here, which
//      this function ignores anyway, but filtering at the source is
//      cleaner and reduces noise in the logs.
//   2. Copy the Signing Secret shown (starts with "whsec_") and add it to
//      Netlify as MEMBERSTACK_WEBHOOK_SECRET.
//   3. This function also reuses MEMBERSTACK_SECRET_KEY (already
//      configured elsewhere in this project) and the existing
//      GHL_API_KEY / GHL_LOCATION_ID (already set up for the waitlist
//      integration) — no new GHL-side setup needed.
//
// Signature verification is a known friction point with Memberstack's
// webhook system (header casing and payload-shape mismatches are commonly
// reported). This uses the officially documented @memberstack/admin
// verifyWebhookSignature method with the full raw request body — if
// verification fails on a real webhook, check the logged raw headers and
// body first before assuming the endpoint itself is wrong.

const memberstackAdmin = require('@memberstack/admin');
const https = require('https');
const { json, preflight } = require('./_Lib/http');

const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

function upsertGhlContact({ email, firstName, lastName, planName }) {
  const API_KEY = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;

  if (!API_KEY || !LOCATION_ID) {
    console.error('Missing GoHighLevel environment variables');
    return Promise.resolve({ skipped: true, reason: 'missing GHL env vars' });
  }

  const tags = ['member', 'paying-member'];
  if (planName) tags.push(planName);

  const payload = JSON.stringify({
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    locationId: LOCATION_ID,
    tags,
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'services.leadconnectorhq.com',
      path: '/contacts/upsert',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('GoHighLevel response:', res.statusCode, data);
        resolve({ statusCode: res.statusCode, data });
      });
    });

    req.on('error', (err) => {
      console.error('GoHighLevel request error:', err);
      resolve({ error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const secret = process.env.MEMBERSTACK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Missing MEMBERSTACK_WEBHOOK_SECRET');
    return json(500, { error: 'Server configuration error' });
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body || '{}');
  } catch (err) {
    console.error('Could not parse webhook body as JSON:', err);
    return json(400, { error: 'Invalid JSON body' });
  }

  // Verify this request genuinely came from Memberstack, not a spoofed
  // POST to a guessed URL. Logs the raw headers on failure specifically
  // so a real mismatch (casing, wrong secret, etc.) is diagnosable from
  // the Netlify function log rather than a guess.
  let isValid = false;
  try {
    isValid = memberstack.verifyWebhookSignature({
      payload: parsedBody,
      headers: event.headers,
      secret,
    });
  } catch (err) {
    console.error('Webhook signature verification threw an error:', err);
    console.error('Raw headers received:', JSON.stringify(event.headers));
  }

  if (!isValid) {
    console.error('Webhook signature verification failed.');
    console.error('Raw headers received:', JSON.stringify(event.headers));
    console.error('Raw body received:', event.body);
    return json(401, { error: 'Invalid signature' });
  }

  const { event: eventType, payload } = parsedBody;
  console.log('Verified Memberstack webhook event:', eventType);

  // Only sync on an actual plan being attached to a member — this is what
  // distinguishes a real paying member from someone who merely started
  // the signup form. Every other event type is acknowledged and ignored.
  if (eventType !== 'member.plan.added') {
    return json(200, { received: true, ignored: true, eventType });
  }

  const email = payload?.auth?.email;
  if (!email) {
    console.error('member.plan.added payload missing auth.email:', JSON.stringify(payload));
    return json(200, { received: true, skipped: true, reason: 'no email in payload' });
  }

  const customFields = payload?.customFields || {};
  const firstName = customFields['first-name'] || customFields.firstName || undefined;
  const lastName = customFields['last-name'] || customFields.lastName || undefined;
  // Plan name isn't confirmed to live at a specific path in this payload
  // shape yet — logging the full payload on first real delivery will show
  // exactly where it is, so this can be tightened once we see a real one.
  const planName = payload?.planName || payload?.plan?.name || undefined;

  const ghlResult = await upsertGhlContact({ email, firstName, lastName, planName });

  return json(200, { received: true, synced: true, ghlResult });
};
