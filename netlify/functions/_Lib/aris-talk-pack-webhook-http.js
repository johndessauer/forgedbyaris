// Adds pack minutes after Checkout. A session id is credited once.
// Minutes attach to the month stored on the session, not the month the
// event arrives. Other payments are ignored.
const { json } = require('./http');
const talk = require('../../../assets/js/aris-talk');
const stripe = require('./aris-talk-pack-stripe');

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
    if (!secret) return json(503, { error: 'Talk pack webhook is not configured.' });
    const payload = rawBody(event);
    const header = (event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature'])) || '';
    if (!stripe.verifyWebhook(payload, header, secret)) return json(400, { error: 'Invalid signature.' });

    let parsed;
    try { parsed = JSON.parse(payload); }
    catch (err) { return json(400, { error: 'Invalid payload.' }); }
    if (parsed && parsed.livemode === true && !stripe.liveCheckout(env)) {
      return json(200, { ignored: true });
    }
    if (!parsed || parsed.type !== 'checkout.session.completed') return json(200, { ignored: true });
    const session = parsed.data && parsed.data.object || {};
    const meta = session.metadata || {};
    if (meta.purpose !== 'talk-extra-minutes') return json(200, { ignored: true });
    if (session.payment_status !== 'paid') return json(200, { ignored: true });

    const memberId = meta.member_id || session.client_reference_id;
    const monthKey = String(meta.month_key || '');
    const minutes = Math.floor(Number(meta.minutes) || 0);
    const paid = Math.floor(Number(session.amount_total) || 0);
    const amount = Math.floor(Number(meta.amount_cents) || 0);
    if (!memberId || minutes !== talk.PACK_MINUTES || !/^[0-9]{4}-[0-9]{2}$/.test(monthKey)) {
      return json(400, { error: 'That pack is not valid.' });
    }
    if (paid !== talk.PACK_AMOUNT_CENTS || amount !== talk.PACK_AMOUNT_CENTS) {
      return json(400, { error: 'That pack amount is not valid.' });
    }

    const store = options.store || options.getStore();
    try {
      const result = await store.creditPack({
        memberId: memberId,
        monthKey: monthKey,
        seconds: talk.PACK_SECONDS,
        amountCents: talk.PACK_AMOUNT_CENTS,
        stripeSessionId: session.id,
      });
      if (!result || result.ok === false) return json(400, { error: 'That pack is not valid.' });
      return json(200, {
        credited: !!result.credited,
        duplicate: !!result.duplicate,
        packSeconds: result.packSeconds,
      });
    } catch (err) {
      if (err && err.code === 'missing') return json(503, { error: 'Extra minutes are not ready yet.' });
      console.error('talk pack webhook credit failed');
      return json(500, { error: 'Extra minutes could not be recorded.' });
    }
  };
}

module.exports = { createHandler };
