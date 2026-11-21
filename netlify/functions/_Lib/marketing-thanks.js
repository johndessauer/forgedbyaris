// Handwritten notecards and yellow letters. Orders stay Coming soon until
// THANKSIO_API_KEY is set and starts with tio_. Unless MARKETING_LIVE_MAIL
// is the string "true", every accepted order is cancelled immediately so
// the account's test mode is not the only thing keeping mail from going out.
// The key is never returned to the browser, and this file's errors do not
// name the mail company.
const { readRuntimeEnv } = require('./runtime-env');
const { mailable, normalizeMailLead } = require('./marketing-lob');

const COMING_SOON = 'Handwritten notes are coming soon.';
const YELLOW_COMING_SOON = 'Yellow letters are coming soon.';
const API = 'https://api.thanks.io/api/v2';
const YELLOW_PAPER_PATH = '/assets/marketing/stock/yellow-lined-paper.jpg';

// Public handwriting styles from GET /handwriting-styles.
// https://docs.thanks.io/api-reference/endpoint/handwriting-styles/list-styles
// Everyday hands from the public sample images. Shopping List is the
// default because it reads as casual cursive, not a formal script.
// https://docs.thanks.io/api-reference/endpoint/handwriting-styles/list-styles
const HANDS = Object.freeze({
  'shopping-list': 7,
  'normal-print': 6,
  'lazy-note': 8,
  'blurred-lines': 9,
  'that-dude': 5,
});

function comingSoon(channel) {
  return channel === 'yellow-letter' ? YELLOW_COMING_SOON : COMING_SOON;
}

function readiness(env) {
  const key = readRuntimeEnv(env, 'THANKSIO_API_KEY');
  const live = readRuntimeEnv(env, 'MARKETING_LIVE_MAIL') === 'true';
  if (!key || !String(key).startsWith('tio_')) {
    const err = new Error(COMING_SOON);
    err.statusCode = 400;
    return { ok: false, error: err };
  }
  return { ok: true, key: key, testMode: !live };
}

function recipient(lead) {
  const row = normalizeMailLead(lead);
  return {
    name: String(row.owner || 'Resident').slice(0, 80),
    address: String(row.address || '').slice(0, 80),
    city: String(row.city || '').slice(0, 40),
    province: String(row.state || '').slice(0, 2).toUpperCase(),
    postal_code: String(row.zip || '').slice(0, 10),
    country: 'US',
  };
}

function returnFields(brand) {
  const row = brand || {};
  const addr = row.returnAddress || {};
  return {
    return_name: String(row.businessName || '').slice(0, 80),
    return_address: String(addr.line1 || '').slice(0, 80),
    return_address2: String(addr.line2 || '').slice(0, 80),
    return_city: String(addr.city || '').slice(0, 40),
    return_state: String(addr.state || '').slice(0, 2).toUpperCase(),
    return_postal_code: String(addr.zip || '').slice(0, 10),
  };
}

function paperUrl(origin) {
  const base = String(origin || 'https://forgedbyaris.com').replace(/\/$/, '');
  return base + YELLOW_PAPER_PATH;
}

function buildRequest(piece, leads, styles, brand, origin) {
  const channel = piece && piece.channel === 'yellow-letter' ? 'yellow-letter' : 'handwritten';
  const style = styles && styles[channel] || {};
  const hand = HANDS[style.hand] || HANDS['shopping-list'];
  const yellow = channel === 'yellow-letter';
  const product = !yellow && (style.product === '4x6' || style.product === '6x9') ? style.product : (yellow ? 'windowlessletter' : 'notecard');
  const path = product === 'windowlessletter'
    ? '/send/windowlessletter'
    : (product === 'notecard' ? '/send/notecard' : '/send/postcard');
  const ink = style.ink === 'black' ? 'black' : 'blue';
  const body = Object.assign({
    message: String(piece && piece.variantA || '').slice(0, yellow ? 1500 : 500),
    handwriting_style_id: hand,
    handwriting_color: ink,
    handwriting_realism: true,
    postage_class: 'first_class',
    recipients: (leads || []).map(recipient),
  }, returnFields(brand));
  if (product === 'notecard') body.realism_mode = true;
  if (product === '4x6' || product === '6x9') body.size = product;
  if (yellow) body.front_image_url = paperUrl(origin);
  return { path: path, body: body, channel: channel };
}

async function readJson(response) {
  try { return await response.json(); }
  catch (err) { return {}; }
}

async function sendNotes(options) {
  const ready = readiness(options.env || {});
  if (!ready.ok) throw ready.error;
  const pieces = (options.pieces || []).filter(function (row) {
    return row && (row.channel === 'handwritten' || row.channel === 'yellow-letter');
  });
  const leads = (options.leads || []).filter(mailable);
  if (!pieces.length) {
    const err = new Error(COMING_SOON);
    err.statusCode = 400;
    throw err;
  }
  if (!leads.length) {
    const err = new Error('Add a street, city, state, and ZIP for each property you want mailed.');
    err.statusCode = 400;
    throw err;
  }
  const ids = [];
  const requests = [];
  for (const piece of pieces) {
    for (const lead of leads) {
      const request = buildRequest(piece, [lead], options.styles, options.brand, options.origin);
      requests.push(request);
      const response = await options.fetch(API + request.path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + ready.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body),
      });
      const data = await readJson(response);
      if (!response.ok || !data || data.id == null) {
        const err = new Error('The test mailing was not accepted.');
        err.statusCode = 502;
        throw err;
      }
      const id = String(data.id);
      if (ready.testMode) {
        const cancel = await options.fetch(API + '/orders/' + encodeURIComponent(id) + '/cancel', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer ' + ready.key,
            'Content-Type': 'application/json',
          },
        });
        const cancelled = await readJson(cancel);
        const status = cancelled && cancelled.order && cancelled.order.status;
        if (!cancel.ok && String(status || '').toLowerCase() !== 'cancelled') {
          const err = new Error('The test mailing was not accepted.');
          err.statusCode = 502;
          throw err;
        }
      }
      ids.push(id);
    }
  }
  return {
    testMode: ready.testMode,
    ids: ids,
    requests: requests,
    leadCount: leads.length,
    pieceCount: pieces.length,
  };
}

module.exports = {
  COMING_SOON: COMING_SOON,
  YELLOW_COMING_SOON: YELLOW_COMING_SOON,
  YELLOW_PAPER_PATH: YELLOW_PAPER_PATH,
  HANDS: HANDS,
  comingSoon: comingSoon,
  readiness: readiness,
  buildRequest: buildRequest,
  sendNotes: sendNotes,
};
