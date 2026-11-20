// Credits a Marketing wallet after a test Checkout session is paid.
// Uses MARKETING_STRIPE_WEBHOOK_SECRET only. The live checkout webhook is untouched.
const { json } = require('./_Lib/http');
const { openBlobStore } = require('./_Lib/marketing-store');
const wallet = require('./_Lib/marketing-wallet');
const stripe = require('./_Lib/marketing-stripe');

function rawBody(event) {
  if (event.isBase64Encoded) return Buffer.from(event.body || '', 'base64').toString('utf8');
  return String(event.body || '');
}

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const env = options.env || process.env;
    const secret = String(env.MARKETING_STRIPE_WEBHOOK_SECRET || '');
    if (!secret) return json(503, { error: 'Test webhook is not configured.' });
    const payload = rawBody(event);
    const header = (event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature'])) || '';
    if (!stripe.verifyWebhook(payload, header, secret)) return json(400, { error: 'Invalid signature.' });

    let parsed;
    try { parsed = JSON.parse(payload); }
    catch (err) { return json(400, { error: 'Invalid payload.' }); }
    if (!parsed || parsed.type !== 'checkout.session.completed') return json(200, { ignored: true });
    const session = parsed.data && parsed.data.object || {};
    const meta = session.metadata || {};
    if (meta.purpose !== 'marketing-wallet') return json(200, { ignored: true });
    if (session.payment_status && session.payment_status !== 'paid') return json(200, { ignored: true });
    const memberId = meta.member_id || session.client_reference_id;
    const amount = stripe.allowedTopUp(meta.amount_cents);
    const paid = Math.floor(Number(session.amount_total) || 0);
    if (!memberId || !amount || (paid && paid !== amount)) return json(400, { error: 'That top-up amount is not valid.' });

    let store;
    try { store = options.getStore ? options.getStore() : openBlobStore(event); }
    catch (err) { return json(503, { error: 'Marketing credits are not available.' }); }
    const result = await wallet.credit(store, {
      memberId: memberId,
      amountCents: amount,
      stripeSessionId: session.id,
      note: 'Test top-up',
    });
    return json(200, { credited: result.credited, duplicate: result.duplicate, balanceCents: result.balanceCents });
  };
}

exports.createHandler = createHandler;
let prod = null;
exports.handler = function (event, context) {
  if (!prod) prod = createHandler({});
  return prod(event, context);
};
