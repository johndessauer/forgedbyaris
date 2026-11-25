// Credits the skip-trace ledger after Checkout. A Stripe session id is
// credited once. Marketing wallet events are ignored.
const { json } = require('./http');
const shared = require('../../../assets/js/skip-trace-shared');
const stripe = require('./skip-trace-stripe');
const { storageDown } = require('./skip-trace-http');

function rawBody(event) {
  if (event.isBase64Encoded) return Buffer.from(event.body || '', 'base64').toString('utf8');
  return String(event.body || '');
}

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const env = options.env || process.env;
    const secret = stripe.webhookSecret(env);
    if (!secret) return json(503, { error: 'Skip-trace webhook is not configured.' });
    const payload = rawBody(event);
    const header = (event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature'])) || '';
    if (!stripe.verifyWebhook(payload, header, secret)) return json(400, { error: 'Invalid signature.' });

    let parsed;
    try { parsed = JSON.parse(payload); }
    catch (err) { return json(400, { error: 'Invalid payload.' }); }
    if (!parsed || parsed.type !== 'checkout.session.completed') return json(200, { ignored: true });
    const session = parsed.data && parsed.data.object || {};
    const meta = session.metadata || {};
    if (meta.purpose !== 'skip-trace-credits') return json(200, { ignored: true });
    if (session.payment_status && session.payment_status !== 'paid') return json(200, { ignored: true });

    const memberId = meta.member_id || session.client_reference_id;
    const pack = shared.packByAmount(meta.amount_cents);
    const paid = Math.floor(Number(session.amount_total) || 0);
    if (!memberId || !pack || (paid && paid !== pack.amountCents)) {
      return json(400, { error: 'That pack amount is not valid.' });
    }

    const store = options.store || options.getStore();
    try {
      const result = await store.credit({
        memberId: memberId,
        amountCents: pack.amountCents,
        stripeSessionId: session.id,
        note: 'Skip-trace credit pack',
      });
      return json(200, {
        credited: !!result.credited,
        duplicate: !!result.duplicate,
        balanceCents: result.balanceCents,
      });
    } catch (err) {
      if (storageDown(err)) return json(503, { error: 'Owner contact credits are not ready yet.' });
      console.error('skip-trace webhook credit failed:', err && err.message);
      return json(500, { error: 'Credit could not be recorded.' });
    }
  };
}

module.exports = { createHandler };
