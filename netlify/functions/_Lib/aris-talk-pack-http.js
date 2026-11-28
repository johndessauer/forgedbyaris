// Checkout for the Talk Mode extra-minutes pack.
// Offered only after the signed-in member has hit this month's cap.
// TALK_MODE_UNLIMITED never qualifies. No processor name is returned.
const { json, preflight } = require('./http');
const { returnOrigin } = require('./marketing-wallet-http');
const talk = require('../../../assets/js/aris-talk');
const stripe = require('./aris-talk-pack-stripe');

function emailOf(member) {
  if (!member) return '';
  if (member.auth && member.auth.email) return String(member.auth.email);
  if (member.email) return String(member.email);
  return '';
}

function needsEmail(env, memberId) {
  const id = String(memberId || '').trim().toLowerCase();
  const keys = ['TALK_MODE_ALLOWLIST', 'TALK_MODE_UNLIMITED', 'TALK_MOGUL_MEMBER_IDS'];
  return keys.some(function (key) {
    const list = talk.parseAllowlist(env[key]);
    if (!list.length) return false;
    if (id && list.indexOf(id) !== -1) return false;
    return true;
  });
}

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const env = options.env || process.env;
    const now = options.now || (() => new Date());
    const enforce = options.enforceMembership || function (ev) {
      return require('./membership').enforceMembership(ev);
    };
    const gate = await enforce(event);
    if (gate.response) return gate.response;
    const memberId = gate.access && gate.access.memberId;
    if (!memberId) return json(401, { error: 'Active membership required' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: talk.COPY.packFailed }); }
    if (body.action !== 'checkout') return json(400, { error: talk.COPY.packFailed });

    const store = options.store || options.getStore();
    let email = '';
    let member = { id: memberId };
    if (needsEmail(env, memberId)) {
      try {
        const getMember = options.getMember || defaultGetMember(env);
        const loaded = await getMember(memberId);
        if (loaded) member = loaded;
        email = emailOf(member);
      } catch (err) {
        email = '';
      }
    }
    if (!member.id) member.id = memberId;

    const access = talk.talkModeAccess({ env: env, memberId: memberId, email: email });
    if (!access.enabled) return json(403, { error: talk.COPY.packNotYet });
    if (talk.talkUnlimited({ env: env, memberId: memberId, email: email })) {
      return json(403, { error: talk.COPY.packNotYet });
    }

    const monthKey = talk.monthKeyFromDate(now());
    let usage;
    let award = false;
    try {
      usage = await store.read(memberId, monthKey);
      if (typeof store.mogulAward === 'function') award = !!(await store.mogulAward(memberId));
    } catch (err) {
      return json(503, { error: talk.COPY.packFailed });
    }

    const allowance = talk.talkAllowance({
      env: env,
      member: member,
      memberId: memberId,
      email: email,
      awards: { mogul: award },
      packSeconds: usage.packSeconds,
      usedSeconds: usage.usedSeconds,
      packSupported: usage.packSupported,
      unlimited: false,
    });
    if (!allowance.packSupported) return json(503, { error: 'Extra minutes are not ready yet.' });
    if (!allowance.capped) return json(403, { error: talk.COPY.packNotYet });

    try {
      const origin = returnOrigin(event, options.origin);
      const session = await stripe.createPackSession({
        env: env,
        fetch: options.fetch,
        memberId: memberId,
        monthKey: monthKey,
        successUrl: origin + '/aris-coach.html?talkpack=success&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: origin + '/aris-coach.html?talkpack=cancel',
      });
      return json(200, { url: session.url, testMode: !session.live });
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 500;
      const payload = { error: err && err.message ? err.message : talk.COPY.packFailed };
      if (err && err.reason) payload.reason = err.reason;
      return json(status, payload);
    }
  };
}

function defaultGetMember(env) {
  return async function getMember(id) {
    const key = (env || process.env).MEMBERSTACK_SECRET_KEY;
    if (!key) throw new Error('membership lookup is not configured');
    const admin = require('@memberstack/admin').init(key);
    const res = await admin.members.retrieve({ id });
    return (res && res.data) || null;
  };
}

module.exports = { createHandler };
