// Test-mode Marketing credit top-ups. Reads MARKETING_STRIPE_SECRET_KEY only.
const { json, preflight } = require('./http');
const { loadMarketingGate } = require('./marketing-access');
const { openBlobStore } = require('./marketing-store');
const wallet = require('./marketing-wallet');
const stripe = require('./marketing-stripe');
const { TOP_UPS_CENTS } = require('./marketing-pricing');

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    const gate = await loadMarketingGate(event, {
      requireMembership: options.requireMembership,
      getMember: options.getMember,
      env: options.env || process.env,
    });
    if (gate.response) return gate.response;
    if (!gate.flag.allowed) return json(403, { error: 'Marketing is not available on this account yet.' });

    let store;
    try { store = options.getStore ? options.getStore() : openBlobStore(event); }
    catch (err) { return json(503, { error: 'Marketing credits are not available.' }); }

    const memberId = gate.access.memberId;
    if (event.httpMethod === 'GET') {
      const row = await wallet.readWallet(store, memberId);
      return json(200, { balanceCents: row.balanceCents, topUpsCents: TOP_UPS_CENTS, testMode: true });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: 'Invalid JSON body' }); }
    if (body.action !== 'topup') return json(400, { error: 'Unknown wallet action.' });

    const origin = options.origin || 'https://forgedbyaris.com';
    try {
      const session = await stripe.createTopUpSession({
        env: options.env || process.env,
        fetch: options.fetch,
        amountCents: body.amountCents,
        memberId: memberId,
        successUrl: origin + '/marketing.html?wallet=ok',
        cancelUrl: origin + '/marketing.html?wallet=cancel',
      });
      return json(200, { url: session.url, testMode: true });
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 502;
      return json(status, { error: err.message || 'Test checkout could not be started.' });
    }
  };
}

exports.createHandler = createHandler;
