// Balance, recent lookups, and Stripe Checkout for skip-trace packs.
// Separate from the Marketing wallet.
const { json, preflight } = require('./http');
const { returnOrigin } = require('./marketing-wallet-http');
const shared = require('../../../assets/js/skip-trace-shared');
const stripe = require('./skip-trace-stripe');
const { storageDown } = require('./skip-trace-http');

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    const env = options.env || process.env;
    const enforce = options.enforceMembership || function (ev, opts) {
      return require('./membership').enforceMembership(ev, opts);
    };
    const gate = await enforce(event, { need: 'empire' });
    if (gate.response) return gate.response;
    const memberId = gate.access.memberId;
    const store = options.store || options.getStore();

    try {
      if (event.httpMethod === 'GET') {
        const wallet = await store.getWallet(memberId);
        const recent = await store.listRecent(memberId, 8);
        return json(200, {
          balanceCents: wallet.balanceCents,
          lookupCents: shared.LOOKUP_CENTS,
          packs: shared.PACKS,
          recent: recent,
        });
      }
      if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch (err) { return json(400, { error: 'Invalid JSON body' }); }
      if (body.action !== 'checkout') return json(400, { error: 'Unknown action' });
      const origin = returnOrigin(event, options.origin);
      const session = await stripe.createPackSession({
        env: env,
        fetch: options.fetch,
        packId: body.pack,
        memberId: memberId,
        successUrl: origin + '/profile.html?skiptrace=success&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: origin + '/profile.html?skiptrace=cancel',
      });
      return json(200, { url: session.url, testMode: !session.live });
    } catch (err) {
      if (storageDown(err)) return json(503, { error: 'Owner contact credits are not ready yet.' });
      const status = err && err.statusCode ? err.statusCode : 500;
      const payload = { error: err && err.message ? err.message : 'Skip-trace checkout could not be started.' };
      if (err && err.reason) payload.reason = err.reason;
      return json(status, payload);
    }
  };
}

module.exports = { createHandler };
