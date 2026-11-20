// Handwritten notes. No account is connected yet. When THANKSIO_API_KEY
// is missing, or live mail is not explicitly on, orders are refused and
// nothing is sent. The request body is ready for the day the key exists.
// TODO: replace handwriting style names with the account's style ids.
const { readRuntimeEnv } = require('./runtime-env');

const COMING_SOON = 'Handwritten notes are coming soon.';
const HANDS = Object.freeze({
  'hi-clarice': 'Hi Clarice',
  'shopping-list': 'Shopping List',
  'normal-print': 'Normal Print',
});

function readiness(env) {
  const key = readRuntimeEnv(env, 'THANKSIO_API_KEY');
  const live = readRuntimeEnv(env, 'MARKETING_LIVE_MAIL') === 'true';
  if (!key || !live) {
    const err = new Error(COMING_SOON);
    err.statusCode = 400;
    return { ok: false, error: err };
  }
  return { ok: true, key: key };
}

function recipient(lead) {
  const row = lead || {};
  return {
    name: String(row.owner || 'Resident').slice(0, 80),
    address: String(row.address || '').slice(0, 80),
    city: String(row.city || '').slice(0, 40),
    province: String(row.state || '').slice(0, 2).toUpperCase(),
    postal_code: String(row.zip || '').slice(0, 10),
    country: 'US',
  };
}

function buildRequest(piece, leads, styles) {
  const style = styles && styles.handwritten || {};
  const product = style.product === '4x6' || style.product === '6x9' ? style.product : 'notecard';
  const hand = HANDS[style.hand] || HANDS['hi-clarice'];
  const path = product === 'notecard' ? '/send/notecard' : '/send/postcard';
  const body = {
    message: String(piece && piece.variantA || '').slice(0, 500),
    handwriting_style: hand,
    ink_color: 'blue',
    recipients: (leads || []).map(recipient),
  };
  if (product === 'notecard') body.realism_mode = true;
  else body.size = product;
  return { path: path, body: body };
}

async function sendNotes(options) {
  const ready = readiness(options.env || {});
  if (!ready.ok) throw ready.error;
  const piece = (options.pieces || []).filter(function (row) { return row && row.channel === 'handwritten'; })[0];
  const request = buildRequest(piece, options.leads, options.styles);
  const response = await options.fetch('https://api.thanks.io/api/v2' + request.path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ready.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request.body),
  });
  const data = await response.json();
  if (!response.ok) {
    const err = new Error(COMING_SOON);
    err.statusCode = 502;
    throw err;
  }
  const id = data && (data.id || data.order_id || data.batch_id);
  return { ids: id ? [String(id)] : [], request: request };
}

module.exports = {
  COMING_SOON: COMING_SOON,
  readiness: readiness,
  buildRequest: buildRequest,
  sendNotes: sendNotes,
};
