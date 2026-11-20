// Marketing prices. Member pages must not import this file: the mail
// provider name stays off every screen and out of ARIS copy.
//
// Mail and postage: vendor cost × 1.20.
// Printed goods: vendor cost + 25% to 35%, default 30% (MARKETING_PRINT_MARKUP).
// Only postcards and letters are charged and mailed. Each line keeps
// vendor cost, markup, and student price so the three numbers add up.

const MAIL_MARKUP_RATE = 0.20;
const PRINT_MARKUP_RATE = 0.30;
const PRINT_MARKUP_RATE_MIN = 0.25;
const PRINT_MARKUP_RATE_MAX = 0.35;
const MAIL_PROVIDER = 'lob';
const LOB_CHANNELS = Object.freeze(['postcard', 'letter']);
const catalog = require('../../../assets/js/marketing-catalog.js');

// TODO: No print vendor is connected. Do not call a print API from this
// file. The name below is the assumed vendor for bandit signs, yard signs,
// door hangers, flyers, and business cards, because that name is already
// the print stand-in in the student-facing vendor filter. Unit costs are
// stubs, not a published rate card. Swap this when John connects the vendor
// and keep the 25% to 35% markup.
const PRINT_VENDOR = 'dirt-cheap-signs';

// A handwritten-style note is printed as the standard 4x6 postcard.
// Letters stay one-page letters. Anything else is not mailed.
function mailFormat(channelId) {
  const id = String(channelId || '');
  if (id === 'postcard' || id === 'handwritten') return 'postcard';
  if (id === 'letter') return 'letter';
  return '';
}
const TOP_UPS_CENTS = Object.freeze([2500, 5000, 10000, 25000]);

// Mail unit costs are Lob Developer edition, the plan a new account gets
// (no monthly fee, up to 500 mailings a month). Each price includes print
// and USPS postage. Stored in cents, rounded from the published dollars.
// Student price is that cent cost times 1.20, rounded to the nearest cent.
//
// Source, table "Pricing details - 11/01/2026":
// https://help.lob.com/print-and-mail/ready-to-get-started/pricing-details
//
// 4x6 postcard, First Class: $0.909. Lob does not publish a 4x6 Standard
// Class rate (Standard Class starts at 5x7).
// 1-page black-and-white letter, Standard Class: $0.834. Lob's "Standard
// Class" is USPS Marketing Mail. First Class for that same letter is
// $1.066, so Standard Class is the cheaper published rate.
// Printed-goods shipping is not inside those unit prices.
function publishedCents(dollars) {
  return Math.round(dollars * 100);
}

const POSTCARD_4X6_FIRST_CLASS_USD = 0.909;
const LETTER_BW_STANDARD_USD = 0.834;

const BASIS = Object.freeze({
  postcard: line('mail', publishedCents(POSTCARD_4X6_FIRST_CLASS_USD), MAIL_MARKUP_RATE, MAIL_PROVIDER),
  letter: line('mail', publishedCents(LETTER_BW_STANDARD_USD), MAIL_MARKUP_RATE, MAIL_PROVIDER),
  handwritten: line('mail', 118, MAIL_MARKUP_RATE, null),
  'door-hanger': line('print', 21, PRINT_MARKUP_RATE, PRINT_VENDOR),
  flyer: line('print', 8, PRINT_MARKUP_RATE, PRINT_VENDOR),
  bandit: line('print', 395, PRINT_MARKUP_RATE, PRINT_VENDOR),
  'yard-sign': line('print', 395, PRINT_MARKUP_RATE, PRINT_VENDOR),
  'business-card': line('print', 10, PRINT_MARKUP_RATE, PRINT_VENDOR),
  'skip-trace': unpriced('data', 20),
  'phone-scrub': unpriced('data', 2),
  'list-pull': unpriced('data', 5),
});

function line(medium, vendorCostCents, markupRate, provider) {
  const studentPriceCents = Math.round(vendorCostCents * (1 + markupRate));
  return Object.freeze({
    medium: medium,
    priced: true,
    vendorCostCents: vendorCostCents,
    markupRate: markupRate,
    markupCents: studentPriceCents - vendorCostCents,
    studentPriceCents: studentPriceCents,
    provider: provider,
    shippingSeparate: medium === 'print',
  });
}

function unpriced(medium, exampleStudentPriceCents) {
  return Object.freeze({
    medium: medium,
    priced: false,
    vendorCostCents: null,
    markupRate: null,
    markupCents: null,
    studentPriceCents: null,
    exampleStudentPriceCents: exampleStudentPriceCents,
    provider: null,
    shippingSeparate: false,
  });
}

function emptyBilling() {
  return {
    method: null,
    stripeReference: null,
    walletDebitCents: null,
  };
}

function orderLine(channelId, quantity) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const basis = BASIS[channelId];
  if (!basis || !basis.priced) {
    return {
      channelId: String(channelId || ''),
      quantity: qty,
      currency: 'usd',
      priced: false,
      unitVendorCostCents: null,
      unitMarkupCents: null,
      unitStudentPriceCents: null,
      vendorCostCents: null,
      markupRate: basis ? basis.markupRate : null,
      markupCents: null,
      studentPriceCents: null,
      shippingCents: null,
      provider: null,
      billing: emptyBilling(),
    };
  }
  return {
    channelId: channelId,
    quantity: qty,
    currency: 'usd',
    priced: true,
    unitVendorCostCents: basis.vendorCostCents,
    unitMarkupCents: basis.markupCents,
    unitStudentPriceCents: basis.studentPriceCents,
    vendorCostCents: basis.vendorCostCents * qty,
    markupRate: basis.markupRate,
    markupCents: basis.markupCents * qty,
    studentPriceCents: basis.studentPriceCents * qty,
    shippingCents: basis.shippingSeparate ? null : 0,
    provider: basis.provider,
    billing: emptyBilling(),
  };
}

function printMarkupRate(env) {
  const raw = Number(env && env.MARKETING_PRINT_MARKUP);
  if (!Number.isFinite(raw)) return PRINT_MARKUP_RATE;
  return Math.min(PRINT_MARKUP_RATE_MAX, Math.max(PRINT_MARKUP_RATE_MIN, raw));
}

function sumBy(rows, key) {
  return rows.reduce(function (total, row) { return total + (Number(row[key]) || 0); }, 0);
}

// A print line is charged only when the student picked an allowed pack and
// size. The property count is the mail quantity and is never a print quantity.
function normalizePrints(prints) {
  const out = [];
  const seen = {};
  (prints || []).forEach(function (row) {
    const id = String(row && (row.channelId || row.channel) || '');
    if (!id || seen[id]) return;
    const spec = catalog.printSpec(id);
    const basis = BASIS[id];
    if (!spec || !basis || basis.medium !== 'print') return;
    const quantity = Math.floor(Number(row.quantity) || 0);
    if (spec.packs.indexOf(quantity) === -1) return;
    const option = String(row.option || '');
    const known = spec.options.some(function (item) { return item.id === option; });
    if (!known) return;
    seen[id] = true;
    out.push({ channelId: id, quantity: quantity, option: option });
  });
  return out;
}

// Mail that this step can hand to the mail service is charged one per
// property. Printed goods are a separate bulk order. Passing no print
// selection leaves those lines at quantity 0.
function quoteOrder(channels, quantity, env, prints) {
  const leadCount = Math.max(0, Math.floor(Number(quantity) || 0));
  const printRate = printMarkupRate(env);
  const requested = normalizePrints(prints);
  const byId = {};
  requested.forEach(function (row) { byId[row.channelId] = row; });
  const lines = [];
  const seen = {};
  function add(id) {
    const key = String(id || '');
    if (!key || seen[key]) return;
    seen[key] = true;
    const basis = BASIS[key];
    if (!basis || !basis.priced) return;
    const format = mailFormat(key);
    const priceBasis = format ? BASIS[format] : basis;
    const mailed = !!format;
    const print = basis.medium === 'print';
    const request = print ? byId[key] : null;
    const count = mailed ? leadCount : (request ? request.quantity : 0);
    const rate = print ? printRate : MAIL_MARKUP_RATE;
    const unitStudent = Math.round(priceBasis.vendorCostCents * (1 + rate));
    const unitMarkup = unitStudent - priceBasis.vendorCostCents;
    lines.push({
      channelId: key,
      medium: basis.medium,
      kind: mailed ? 'mail' : (print ? 'print' : basis.medium),
      mailed: mailed,
      quantity: count,
      option: request ? request.option : '',
      unitVendorCostCents: priceBasis.vendorCostCents,
      unitStudentPriceCents: unitStudent,
      vendorCostCents: priceBasis.vendorCostCents * count,
      markupRate: rate,
      markupCents: unitMarkup * count,
      studentPriceCents: unitStudent * count,
    });
  }
  (channels || []).forEach(add);
  requested.forEach(function (row) { add(row.channelId); });
  const billed = lines.filter(function (row) { return row.quantity > 0; });
  const mailedRows = lines.filter(function (row) { return row.kind === 'mail'; });
  const printedRows = lines.filter(function (row) { return row.kind === 'print'; });
  return {
    lines: lines,
    leadCount: leadCount,
    printMarkupRate: printRate,
    mailChargedCents: sumBy(mailedRows, 'studentPriceCents'),
    printChargedCents: sumBy(printedRows, 'studentPriceCents'),
    vendorCostCents: sumBy(billed, 'vendorCostCents'),
    chargedCents: sumBy(billed, 'studentPriceCents'),
    markupCents: sumBy(billed, 'markupCents'),
    testMode: String(env && env.MARKETING_LIVE_MAIL || '') !== 'true',
  };
}

// Safe to show a member. The provider name is not on this object.
function publicQuote(line) {
  const row = line || {};
  return {
    channelId: row.channelId,
    quantity: row.quantity,
    currency: row.currency,
    priced: row.priced,
    vendorCostCents: row.vendorCostCents,
    markupCents: row.markupCents,
    studentPriceCents: row.studentPriceCents,
    shippingCents: row.shippingCents,
  };
}

module.exports = {
  MAIL_MARKUP_RATE: MAIL_MARKUP_RATE,
  PRINT_MARKUP_RATE: PRINT_MARKUP_RATE,
  PRINT_MARKUP_RATE_MIN: PRINT_MARKUP_RATE_MIN,
  PRINT_MARKUP_RATE_MAX: PRINT_MARKUP_RATE_MAX,
  MAIL_PROVIDER: MAIL_PROVIDER,
  PRINT_VENDOR: PRINT_VENDOR,
  POSTCARD_4X6_FIRST_CLASS_USD: POSTCARD_4X6_FIRST_CLASS_USD,
  LETTER_BW_STANDARD_USD: LETTER_BW_STANDARD_USD,
  publishedCents: publishedCents,
  LOB_CHANNELS: LOB_CHANNELS,
  mailFormat: mailFormat,
  TOP_UPS_CENTS: TOP_UPS_CENTS,
  BASIS: BASIS,
  orderLine: orderLine,
  publicQuote: publicQuote,
  printMarkupRate: printMarkupRate,
  normalizePrints: normalizePrints,
  quoteOrder: quoteOrder,
};
