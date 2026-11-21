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
const THANKS_PROVIDER = 'thanks-io';
const LOB_CHANNELS = Object.freeze(['postcard', 'letter', 'jumbo-postcard', 'offer-letter']);
const catalog = require('../../../assets/js/marketing-catalog.js');
const { readRuntimeEnv } = require('./runtime-env');

// TODO: No print vendor is connected. Do not call a print API from this
// file. The name below is the assumed vendor for yard signs and
// door hangers, because that name is already
// the print stand-in in the student-facing vendor filter. Unit costs are
// stubs, not a published rate card. Swap this when John connects the vendor
// and keep the 25% to 35% markup.
const PRINT_VENDOR = 'dirt-cheap-signs';

// Lob mails postcards and letters only. Handwritten notes use a separate
// adapter and are not sent here.
function mailFormat(channelId) {
  const id = String(channelId || '');
  if (id === 'postcard' || id === 'jumbo-postcard') return 'postcard';
  if (id === 'letter' || id === 'offer-letter') return 'letter';
  return '';
}

function handwrittenReady(env) {
  const key = readRuntimeEnv(env, 'THANKSIO_API_KEY');
  return typeof key === 'string' && key.indexOf('tio_') === 0;
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
// Postcard and letter costs are the approved Nov 20, 2026 vendor dollars.
// 4x6 First Class is Lob's published $0.909. 6x9 and 6x11 are the approved
// costs that price to $1.24 and $1.55 after the 20 percent mail markup.
// Letters are one page, First Class, #10 double-window: black and white
// $1.067 and color $1.225.
// Printed-goods shipping is not inside those unit prices.
function publishedCents(dollars) {
  return Math.round(dollars * 100);
}

function mailPrice(vendorUsd) {
  const vendorCostCents = publishedCents(vendorUsd);
  const studentPriceCents = Math.round(Number(vendorUsd) * (1 + MAIL_MARKUP_RATE) * 100);
  return {
    vendorCostCents: vendorCostCents,
    studentPriceCents: studentPriceCents,
    markupCents: studentPriceCents - vendorCostCents,
    markupRate: MAIL_MARKUP_RATE,
  };
}

const POSTCARD_COSTS_USD = Object.freeze({ '4x6': 0.909, '6x9': 1.033, '6x11': 1.292 });
const LETTER_COSTS_USD = Object.freeze({ bw: 1.067, color: 1.225 });
// Jumbo is Lob's 6×11 First Class postcard at the Developer rate John approved.
// The offer letter is a one-page color letter in a #10 envelope, First Class.
const JUMBO_POSTCARD_6X11_USD = 1.294;
const OFFER_LETTER_COLOR_USD = 1.226;
const POSTCARD_4X6_FIRST_CLASS_USD = POSTCARD_COSTS_USD['4x6'];
const LETTER_BW_FIRST_CLASS_USD = LETTER_COSTS_USD.bw;
const LETTER_COLOR_FIRST_CLASS_USD = LETTER_COSTS_USD.color;
// Integer cents chosen so cost × 1.20 rounds to the approved student prices.
// Notecard, 4x6, and 6x9 are the pay-as-you-go rates (postage included).
// The yellow letter is the pay-as-you-go windowless letter, also postage included.
// Source, "Pricing last updated November 5, 2026":
// https://thanks.io/pricing
const HANDWRITTEN_VENDOR_CENTS = Object.freeze({ notecard: 304, '4x6': 118, '6x9': 165 });
const YELLOW_LETTER_USD = 2.56;
// Pack cost in cents. Per-sign vendor cost is the pack divided by the count.
const SIGN_PACK_VENDOR_CENTS = Object.freeze({ 50: 24900, 100: 39500 });
const SOON_VENDOR_CENTS = Object.freeze({ 'door-hanger': 140 });

const postcardDefault = mailPrice(POSTCARD_COSTS_USD['4x6']);
const letterDefault = mailPrice(LETTER_COSTS_USD.bw);

const BASIS = Object.freeze({
  postcard: line('mail', postcardDefault.vendorCostCents, MAIL_MARKUP_RATE, MAIL_PROVIDER),
  letter: line('mail', letterDefault.vendorCostCents, MAIL_MARKUP_RATE, MAIL_PROVIDER),
  handwritten: line('mail', HANDWRITTEN_VENDOR_CENTS.notecard, MAIL_MARKUP_RATE, THANKS_PROVIDER),
  'yellow-letter': line('mail', mailPrice(YELLOW_LETTER_USD).vendorCostCents, MAIL_MARKUP_RATE, THANKS_PROVIDER),
  'jumbo-postcard': line('mail', mailPrice(JUMBO_POSTCARD_6X11_USD).vendorCostCents, MAIL_MARKUP_RATE, MAIL_PROVIDER),
  'offer-letter': line('mail', mailPrice(OFFER_LETTER_COLOR_USD).vendorCostCents, MAIL_MARKUP_RATE, MAIL_PROVIDER),
  'door-hanger': line('print', SOON_VENDOR_CENTS['door-hanger'], PRINT_MARKUP_RATE, PRINT_VENDOR),
  'yard-sign': line('print', SIGN_PACK_VENDOR_CENTS[100] / 100, PRINT_MARKUP_RATE, PRINT_VENDOR),
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
function stylePick(channelId, styles) {
  const spec = catalog.pieceStyle(channelId);
  const raw = styles && styles[channelId] || {};
  if (!spec) return { id: '', label: '', hand: '', spec: null };
  const chosen = spec.choices.some(function (row) { return row.id === raw[spec.field]; }) ? raw[spec.field] : spec.default;
  const choice = spec.choices.filter(function (row) { return row.id === chosen; })[0] || spec.choices[0];
  const hand = spec.hands && spec.hands.some(function (row) { return row.id === raw.hand; }) ? raw.hand : (spec.handDefault || '');
  return { id: choice.id, label: choice.label, hand: hand, spec: spec };
}

function signUnit(pack, printRate) {
  const packVendor = SIGN_PACK_VENDOR_CENTS[pack];
  const unitVendor = packVendor / pack;
  const unitStudent = Math.round(unitVendor * (1 + printRate));
  return {
    vendorCostCents: packVendor,
    studentPriceCents: unitStudent * pack,
    markupCents: (unitStudent * pack) - packVendor,
    unitVendorCostCents: unitVendor,
    unitStudentPriceCents: unitStudent,
    markupRate: printRate,
  };
}

function normalizePrints(prints) {
  const out = [];
  const seen = {};
  (prints || []).forEach(function (row) {
    const id = String(row && (row.channelId || row.channel) || '');
    if (!id || id === 'bandit' || seen[id]) return;
    const spec = catalog.printSpec(id);
    const basis = BASIS[id];
    if (!spec || spec.comingSoon || !basis || basis.medium !== 'print') return;
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
function quoteOrder(channels, quantity, env, prints, styles) {
  const leadCount = Math.max(0, Math.floor(Number(quantity) || 0));
  const printRate = printMarkupRate(env);
  const requested = normalizePrints(prints);
  const byId = {};
  requested.forEach(function (row) { byId[row.channelId] = row; });
  const lines = [];
  const seen = {};
  function add(id) {
    const key = String(id || '');
    if (!key || key === 'bandit' || seen[key]) return;
    seen[key] = true;
    const basis = BASIS[key];
    if (!basis || !basis.priced) return;
    const picked = stylePick(key, styles);
    const format = mailFormat(key);
    const print = basis.medium === 'print';
    const printed = catalog.printSpec(key);
    const soonPrint = !!(printed && printed.comingSoon);
    const note = key === 'handwritten' || key === 'yellow-letter';
    let unitVendor = basis.vendorCostCents;
    let unitStudent = Math.round(unitVendor * (1 + (print ? printRate : MAIL_MARKUP_RATE)));
    let count = 0;
    let orderable = false;
    let kind = print ? 'print' : basis.medium;
    if (key === 'jumbo-postcard') {
      const price = mailPrice(JUMBO_POSTCARD_6X11_USD);
      unitVendor = price.vendorCostCents;
      unitStudent = price.studentPriceCents;
      count = leadCount;
      orderable = true;
      kind = 'mail';
    } else if (key === 'offer-letter') {
      const price = mailPrice(OFFER_LETTER_COLOR_USD);
      unitVendor = price.vendorCostCents;
      unitStudent = price.studentPriceCents;
      count = leadCount;
      orderable = true;
      kind = 'mail';
    } else if (format === 'postcard') {
      const price = mailPrice(POSTCARD_COSTS_USD[picked.id]);
      unitVendor = price.vendorCostCents;
      unitStudent = price.studentPriceCents;
      count = leadCount;
      orderable = true;
      kind = 'mail';
    } else if (format === 'letter') {
      const price = mailPrice(LETTER_COSTS_USD[picked.id]);
      unitVendor = price.vendorCostCents;
      unitStudent = price.studentPriceCents;
      count = leadCount;
      orderable = true;
      kind = 'mail';
    } else if (note) {
      if (key === 'yellow-letter') {
        const price = mailPrice(YELLOW_LETTER_USD);
        unitVendor = price.vendorCostCents;
        unitStudent = price.studentPriceCents;
      } else {
        unitVendor = HANDWRITTEN_VENDOR_CENTS[picked.id] || HANDWRITTEN_VENDOR_CENTS.notecard;
        unitStudent = Math.round(unitVendor * (1 + MAIL_MARKUP_RATE));
      }
      orderable = handwrittenReady(env);
      count = orderable ? leadCount : 0;
      kind = 'mail';
    } else if (print && printed && !soonPrint) {
      const pack = byId[key] ? byId[key].quantity : 0;
      const sample = signUnit(pack || 50, printRate);
      unitVendor = sample.unitVendorCostCents;
      unitStudent = sample.unitStudentPriceCents;
      if (pack) {
        count = pack;
        orderable = true;
      }
    } else if (soonPrint) {
      unitVendor = SOON_VENDOR_CENTS[key] || unitVendor;
      unitStudent = Math.round(unitVendor * (1 + printRate));
      orderable = false;
      count = 0;
    }
    const rate = kind === 'mail' && !print ? MAIL_MARKUP_RATE : printRate;
    const vendorCost = (print && count && SIGN_PACK_VENDOR_CENTS[count] && !soonPrint) ? SIGN_PACK_VENDOR_CENTS[count] : unitVendor * count;
    const studentCost = (print && count && !soonPrint) ? unitStudent * count : unitStudent * count;
    const markup = studentCost - vendorCost;
    lines.push({
      channelId: key,
      medium: basis.medium,
      kind: kind,
      mailed: kind === 'mail' && orderable,
      orderable: orderable,
      comingSoon: note ? !orderable : soonPrint,
      quantity: count,
      option: byId[key] ? byId[key].option : (picked.id || ''),
      styleId: picked.id,
      styleLabel: picked.label,
      handStyle: picked.hand,
      unitVendorCostCents: unitVendor,
      unitStudentPriceCents: unitStudent,
      vendorCostCents: vendorCost,
      markupRate: note || format ? MAIL_MARKUP_RATE : rate,
      markupCents: markup,
      studentPriceCents: studentCost,
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
    option: row.option || '',
    currency: row.currency,
    priced: row.priced,
    styleId: row.styleId || '',
    styleLabel: row.styleLabel || '',
    vendorCostCents: row.vendorCostCents,
    markupCents: row.markupCents,
    markupRate: row.markupRate,
    studentPriceCents: row.studentPriceCents,
    shippingCents: row.shippingCents,
  };
}

function publicMenu(env) {
  const printRate = printMarkupRate(env);
  function rowsFromUsd(table, labels) {
    return Object.keys(table).map(function (id) {
      return { id: id, label: labels[id], studentPriceCents: mailPrice(table[id]).studentPriceCents };
    });
  }
  function rowsFromCents(table, labels) {
    return Object.keys(table).map(function (id) {
      return { id: id, label: labels[id], studentPriceCents: Math.round(table[id] * (1 + MAIL_MARKUP_RATE)) };
    });
  }
  const ready = handwrittenReady(env);
  const soonIds = ['door-hanger'];
  if (!ready) soonIds.push('handwritten', 'yellow-letter');
  const yellowPrice = mailPrice(YELLOW_LETTER_USD).studentPriceCents;
  return {
    postcard: rowsFromUsd(POSTCARD_COSTS_USD, { '4x6': '4 × 6', '6x9': '6 × 9', '6x11': '6 × 11' }),
    letter: rowsFromUsd(LETTER_COSTS_USD, { bw: 'Black and white', color: 'Color' }),
    'jumbo-postcard': [{ id: '6x11', label: '6 × 11', studentPriceCents: mailPrice(JUMBO_POSTCARD_6X11_USD).studentPriceCents }],
    'offer-letter': [{ id: 'color', label: 'Color', studentPriceCents: mailPrice(OFFER_LETTER_COLOR_USD).studentPriceCents }],
    handwritten: rowsFromCents(HANDWRITTEN_VENDOR_CENTS, { notecard: 'Folded notecard', '4x6': '4 × 6 postcard', '6x9': '6 × 9 postcard' }),
    'yellow-letter': [{ id: 'lined', label: 'Yellow lined', studentPriceCents: yellowPrice }],
    signs: [],
    comingSoon: soonIds.map(function (id) {
      if (id === 'yellow-letter') return { id: id, studentPriceCents: yellowPrice, pack: 0 };
      const cents = SOON_VENDOR_CENTS[id] || HANDWRITTEN_VENDOR_CENTS.notecard;
      const rate = id === 'handwritten' ? MAIL_MARKUP_RATE : printRate;
      return { id: id, studentPriceCents: Math.round(cents * (1 + rate)), pack: id === 'handwritten' ? 0 : 50 };
    }),
    handwrittenOrderable: ready,
    yellowLetterOrderable: ready,
  };
}

module.exports = {
  MAIL_MARKUP_RATE: MAIL_MARKUP_RATE,
  PRINT_MARKUP_RATE: PRINT_MARKUP_RATE,
  PRINT_MARKUP_RATE_MIN: PRINT_MARKUP_RATE_MIN,
  PRINT_MARKUP_RATE_MAX: PRINT_MARKUP_RATE_MAX,
  MAIL_PROVIDER: MAIL_PROVIDER,
  PRINT_VENDOR: PRINT_VENDOR,
  THANKS_PROVIDER: THANKS_PROVIDER,
  POSTCARD_4X6_FIRST_CLASS_USD: POSTCARD_4X6_FIRST_CLASS_USD,
  LETTER_BW_FIRST_CLASS_USD: LETTER_BW_FIRST_CLASS_USD,
  LETTER_COLOR_FIRST_CLASS_USD: LETTER_COLOR_FIRST_CLASS_USD,
  POSTCARD_COSTS_USD: POSTCARD_COSTS_USD,
  LETTER_COSTS_USD: LETTER_COSTS_USD,
  JUMBO_POSTCARD_6X11_USD: JUMBO_POSTCARD_6X11_USD,
  OFFER_LETTER_COLOR_USD: OFFER_LETTER_COLOR_USD,
  HANDWRITTEN_VENDOR_CENTS: HANDWRITTEN_VENDOR_CENTS,
  YELLOW_LETTER_USD: YELLOW_LETTER_USD,
  SIGN_PACK_VENDOR_CENTS: SIGN_PACK_VENDOR_CENTS,
  publishedCents: publishedCents,
  mailPrice: mailPrice,
  LOB_CHANNELS: LOB_CHANNELS,
  mailFormat: mailFormat,
  handwrittenReady: handwrittenReady,
  publicMenu: publicMenu,
  TOP_UPS_CENTS: TOP_UPS_CENTS,
  BASIS: BASIS,
  orderLine: orderLine,
  publicQuote: publicQuote,
  printMarkupRate: printMarkupRate,
  normalizePrints: normalizePrints,
  quoteOrder: quoteOrder,
};
