// Test-mode mail. A live key is refused unless MARKETING_LIVE_MAIL is the
// string "true". The key itself is never returned to the browser.
const { mailFormat } = require('./marketing-pricing');
const { readRuntimeEnv } = require('./runtime-env');

function assertMailKey(env) {
  const key = readRuntimeEnv(env, 'LOB_API_KEY');
  const live = readRuntimeEnv(env, 'MARKETING_LIVE_MAIL') === 'true';
  if (!key) {
    const err = new Error('Mail is not configured.');
    err.statusCode = 503;
    throw err;
  }
  if (!key.startsWith('test_') && !live) {
    const err = new Error('Refusing to mail because this key is not a test key.');
    err.statusCode = 403;
    throw err;
  }
  return { key: key, testMode: !live || key.startsWith('test_') };
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fromAddress(brand) {
  const addr = brand && brand.returnAddress || {};
  return {
    name: String(brand.businessName || '').slice(0, 40),
    address_line1: String(addr.line1 || '').slice(0, 64),
    address_line2: String(addr.line2 || '').slice(0, 64),
    address_city: String(addr.city || '').slice(0, 40),
    address_state: String(addr.state || '').slice(0, 2).toUpperCase(),
    address_zip: String(addr.zip || '').slice(0, 10),
    phone: String(brand.phone || '').slice(0, 20),
  };
}

function firstText() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] == null) continue;
    const text = String(arguments[i]).trim();
    if (text) return text;
  }
  return '';
}

function parseCityStateZip(tail) {
  const match = String(tail || '').trim().match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!match) return null;
  return { state: match[1].toUpperCase(), zip: match[2] };
}

// Property Search often stores one formatted line ("412 W Joliet St, Crown
// Point, IN 46307") and leaves city, state, and ZIP empty. Split that line
// so the count matches properties that actually have a mailing address.
function normalizeMailLead(lead) {
  const row = lead && typeof lead === 'object' ? lead : {};
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  let address = firstText(row.address, row.street, row.addressLine1, row.line1, details.address, details.street);
  let city = firstText(row.city, details.city);
  let state = firstText(row.state, details.state);
  let zip = firstText(row.zip, row.zipCode, row.postalCode, details.zip, details.zipCode);
  if ((!city || !state || !zip) && address.indexOf(',') !== -1) {
    const parts = address.split(',').map(function (part) { return part.trim(); }).filter(Boolean);
    if (parts.length >= 3) {
      const region = parseCityStateZip(parts[parts.length - 1]);
      if (region) {
        city = city || parts[parts.length - 2];
        state = state || region.state;
        zip = zip || region.zip;
        address = parts.slice(0, -2).join(', ');
      }
    }
  }
  return {
    owner: firstText(row.owner, details.owner) || 'Resident',
    address: address,
    city: city,
    state: state,
    zip: zip,
  };
}

function toAddress(lead) {
  const row = normalizeMailLead(lead);
  return {
    name: String(row.owner || 'Resident').slice(0, 40),
    address_line1: String(row.address || '').slice(0, 64),
    address_city: String(row.city || '').slice(0, 40),
    address_state: String(row.state || '').slice(0, 2).toUpperCase(),
    address_zip: String(row.zip || '').slice(0, 10),
  };
}

function mailable(lead) {
  const row = toAddress(lead || {});
  return !!(row.address_line1 && row.address_city && row.address_state && row.address_zip);
}

function hexColor(value, fallback) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || '')) ? String(value) : fallback;
}

function pieceHtml(brand, text) {
  const colors = brand.colors || {};
  const primary = hexColor(colors.primary, '#1F3348');
  const accent = hexColor(colors.accent, '#C89B3C');
  const disclosure = brand.disclosure || '';
  return '<html><body style="font-family:sans-serif;font-size:14px;margin:0;">'
    + '<p style="color:#666;font-size:11px;padding:8px 12px 0;">TEST — not a real mailing</p>'
    + '<div style="background:' + primary + ';color:#fff;padding:12px 16px;font-weight:700;">' + esc(brand.businessName || '') + '</div>'
    + '<div style="height:4px;background:' + accent + ';"></div>'
    + '<p style="padding:12px 16px;">' + esc(text).replace(/\n/g, '<br>') + '</p>'
    + (disclosure ? '<p style="font-size:11px;padding:0 16px 12px;">' + esc(disclosure) + '</p>' : '')
    + '</body></html>';
}

async function sendPieces(options) {
  const env = options.env || {};
  const auth = assertMailKey(env);
  const fetchImpl = options.fetch;
  const brand = options.brand;
  const leads = (options.leads || []).filter(mailable);
  const pieces = (options.pieces || []).filter(function (piece) {
    return !!mailFormat(piece && piece.channel);
  });
  if (!leads.length) {
    const err = new Error('Add a street, city, state, and ZIP for each property you want mailed.');
    err.statusCode = 400;
    throw err;
  }
  if (!pieces.length) {
    const err = new Error('Choose a postcard or a letter to mail.');
    err.statusCode = 400;
    throw err;
  }
  const from = fromAddress(brand);
  const ids = [];
  for (const lead of leads) {
    for (const piece of pieces) {
      const format = mailFormat(piece.channel);
      const path = format === 'letter' ? '/v1/letters' : '/v1/postcards';
      const html = pieceHtml(brand, piece.variantA || '');
      const styles = options.styles || {};
      const postcardSize = piece.channel === 'jumbo-postcard'
        ? '6x11'
        : (styles.postcard && styles.postcard.size);
      const size = postcardSize === '6x9' || postcardSize === '6x11' ? postcardSize : '4x6';
      const color = piece.channel === 'offer-letter' || !!(styles.letter && styles.letter.finish === 'color');
      const payload = format === 'letter'
        ? { to: toAddress(lead), from: from, file: html, color: color, mail_type: 'usps_first_class', use_type: 'marketing', description: 'FORGE test letter' }
        : { to: toAddress(lead), from: from, front: html, back: html, size: size, mail_type: 'usps_first_class', use_type: 'marketing', description: 'FORGE test postcard' };
      const response = await fetchImpl('https://api.lob.com' + path, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(auth.key + ':').toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        const err = new Error('The test mailing was not accepted.');
        err.statusCode = 502;
        const message = data && data.error && data.error.message;
        if (message) err.detail = String(message).slice(0, 300);
        throw err;
      }
      if (data && data.id) ids.push(String(data.id));
    }
  }
  return { testMode: auth.testMode, ids: ids, leadCount: leads.length, pieceCount: pieces.length };
}

module.exports = {
  assertMailKey: assertMailKey,
  mailable: mailable,
  normalizeMailLead: normalizeMailLead,
  sendPieces: sendPieces,
};
