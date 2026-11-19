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
const { notifyFwnPlanAdded } = require('./_Lib/fwn');
const { eventTagsForMember } = require('./_Lib/webinar');
const { sanitize } = require('../../assets/js/ref-capture');
const { syncPayingMember } = require('./_Lib/ghl-contact');

const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

// Friendly tag names for GHL, mirroring the site-wide PLAN_NAME_OVERRIDES
// map used across the dashboard pages (e.g. aris-coach.html) so this tag
// matches what members are called on the site itself, not a raw plan ID.
const PLAN_TAG_OVERRIDES = {
  'pln_-97-direct--jx9b09ut': 'Beta Member',
  'pln_forge-launch-fwn--md00xzj': 'FORGE Launch',
  'pln_forge-accelerator-fwn--dz20xmt': 'FORGE Accelerator',
  'pln_forge-fwn-997-9x30xu2': 'FORGE 997',
  'pln_forge-fwn-1-797-es40xk6': 'FORGE 1,797',
  'pln_forge-webinar-997-lw00b81': 'FORGE Webinar 997',
  'pln_forge-webinar-1-797-uf10b07': 'FORGE Webinar 1,797',
  'pln_forge-webinar-2-997-empire-rich-groves-k90037e': 'FORGE Webinar 2,997 Rich Groves',
  'pln_forge-webinar-997-foundation-ry00fq6': 'FORGE Webinar 997 Foundation',
};

// GHL contact custom field "Referral Source" (key contact.referral_source).
// The "FORGE - Fortiva Referral Tagging" workflow tags fortiva-7525 off this.
const GHL_REFERRAL_SOURCE_FIELD_ID = '4UsHzTuolKkrrtBov1hM';

function ghlRequest(apiKey, method, path, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  return new Promise((resolve) => {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Version: '2021-07-28',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request({
      hostname: 'services.leadconnectorhq.com',
      path: path,
      method: method,
      headers: headers,
    }, (res) => {
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
    if (body) req.write(body);
    req.end();
  });
}

function presentGhl(outcome) {
  if (!outcome || !outcome.ok) {
    const failed = (outcome && (outcome.tags || outcome.upsert)) || { error: 'ghl failed' };
    return Object.assign({}, failed, {
      tagsApplied: false,
      contactId: outcome && outcome.contactId || undefined,
    });
  }
  return Object.assign({}, outcome.upsert, { tagsApplied: true, contactId: outcome.contactId });
}

// Upsert does not include tags. Tags are added with POST /contacts/{id}/tags
// so an Empire upgrade cannot erase rs-5050, fortiva-7525, or earlier plan tags.
function upsertGhlContact({ email, firstName, lastName, planName, referralSource, salesRep, extraTags }) {
  const API_KEY = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;

  if (!API_KEY || !LOCATION_ID) {
    console.error('Missing GoHighLevel environment variables');
    return Promise.resolve({ skipped: true, reason: 'missing GHL env vars' });
  }

  return syncPayingMember({
    email: email,
    firstName: firstName,
    lastName: lastName,
    locationId: LOCATION_ID,
    planName: planName,
    extraTags: extraTags,
    salesRep: salesRep,
    referralSource: referralSource,
    referralFieldId: GHL_REFERRAL_SOURCE_FIELD_ID,
    salesRepFieldId: process.env.GHL_SALES_REP_FIELD_ID,
    planTagOverrides: PLAN_TAG_OVERRIDES,
  }, (req) => ghlRequest(API_KEY, req.method, req.path, req.payload)).then(presentGhl);
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
  // POST to a guessed URL. Per Memberstack's own troubleshooting docs for
  // this exact error: "the Memberstack method expects the header keys to
  // be in all caps despite the headers being sent in lowercase" — this
  // was confirmed against a real failed test delivery, not a guess.
  const svixHeaders = {
    'SVIX-ID': event.headers['svix-id'] || event.headers['Svix-Id'],
    'SVIX-TIMESTAMP': event.headers['svix-timestamp'] || event.headers['Svix-Timestamp'],
    'SVIX-SIGNATURE': event.headers['svix-signature'] || event.headers['Svix-Signature'],
  };

  let isValid = false;
  try {
    isValid = memberstack.verifyWebhookSignature({
      payload: parsedBody,
      headers: svixHeaders,
      secret,
    });
  } catch (err) {
    console.error('Webhook signature verification threw an error:', err);
    console.error('Raw headers received:', JSON.stringify(event.headers));
    console.error('Constructed svix headers:', JSON.stringify(svixHeaders));
  }

  if (!isValid) {
    console.error('Webhook signature verification failed.');
    console.error('Raw headers received:', JSON.stringify(event.headers));
    console.error('Constructed svix headers:', JSON.stringify(svixHeaders));
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

  // Confirmed real payload shape for member.plan.added (verified against
  // an actual test delivery, not just Memberstack's generic docs example
  // — the docs example shown for member.created/member.updated uses a
  // different, flatter shape than this event actually sends):
  //   payload.member.email, payload.member.id, payload.member.metaData,
  //   payload.member.stripeCustomerId, payload.planConnection.planId,
  //   payload.planConnection.status
  const email = payload?.member?.email;
  if (!email) {
    console.error('member.plan.added payload missing member.email:', JSON.stringify(payload));
    return json(200, { received: true, skipped: true, reason: 'no email in payload' });
  }

  // Signup pages save first-name / last-name / referral-source as Memberstack
  // CUSTOM FIELDS, not metaData. The webhook payload isn't guaranteed to carry
  // customFields, so fetch the full member record. Never let this lookup fail
  // the webhook: fall back to whatever the payload itself has.
  const metaData = payload?.member?.metaData || {};
  let customFields = payload?.member?.customFields || {};
  let memberJson = payload?.member?.json || {};
  const memberId = payload?.member?.id;
  if (memberId) {
    try {
      const { data: fullMember } = await memberstack.members.retrieve({ id: memberId });
      customFields = { ...customFields, ...(fullMember?.customFields || {}) };
      memberJson = { ...(fullMember?.json || {}), ...memberJson };
    } catch (err) {
      console.error('Memberstack member lookup failed (continuing with payload data):', err?.message || err);
    }
  }
  const firstName = customFields['first-name'] || metaData['first-name'] || metaData.firstName || undefined;
  const lastName = customFields['last-name'] || metaData['last-name'] || metaData.lastName || undefined;
  const referralSource = (customFields['referral-source'] || metaData['referral-source'] || '').trim().toLowerCase() || undefined;
  const salesRep = sanitize(
    customFields['sales-rep']
    || metaData['sales-rep']
    || (memberJson && memberJson.fwn && memberJson.fwn.sales_rep)
    || (memberJson && memberJson.webinar && memberJson.webinar.sales_rep)
    || (memberJson && memberJson.sales_rep)
    || ''
  );
  const planName = payload?.planConnection?.planId || undefined;

  let extraTags = [];
  try {
    extraTags = eventTagsForMember({ memberJson, referralSource });
  } catch (err) {
    console.error('Event tag lookup failed (continuing):', err?.message || err);
  }

  const ghlResult = await upsertGhlContact({ email, firstName, lastName, planName, referralSource, salesRep, extraTags });

  // FWN plans already include the setup fee on the Memberstack price.
  // When one of those plans is attached, also POST the buyer to the FWN
  // hook. A failure returns 500 so Memberstack retries. The contact upsert
  // above is idempotent. Other plans are unchanged.
  try {
    const fwnResult = await notifyFwnPlanAdded({
      planId: planName,
      email,
      customFields,
      metaData,
      json: memberJson,
      env: process.env,
    });
    if (fwnResult && fwnResult.posted) {
      return json(200, { received: true, synced: true, ghlResult, fwn: true, package: fwnResult.package });
    }
  } catch (err) {
    console.error('FWN hook failed:', err?.message || err);
    return json(500, { error: 'FWN hook failed' });
  }

  return json(200, { received: true, synced: true, ghlResult });
};
