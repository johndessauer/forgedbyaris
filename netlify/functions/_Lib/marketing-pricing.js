// Step 2 pricing shape. Nothing here charges a card, opens a wallet, or
// places an order. Member pages must not import this file: the mail
// provider name stays off every screen and out of ARIS copy.
//
// Decided for step 2 (not built): a prepaid Stripe credit wallet, mail at
// vendor cost + 20%, printed goods at vendor cost + 25% to 35%. Each
// future order line keeps vendor cost, the markup, and the student price
// so the three numbers still add up after rounding.

const MAIL_MARKUP_RATE = 0.20;
const PRINT_MARKUP_RATE = 0.25;
const PRINT_MARKUP_RATE_MAX = 0.35;
const MAIL_PROVIDER = 'lob';

// Vendor unit costs are the published list prices from the spec, in cents,
// rounded to the nearest cent. Student unit price is that cost times
// (1 + markup), rounded to the nearest cent. Printed-goods shipping is
// not inside the unit price.
const BASIS = Object.freeze({
  postcard: line('mail', 91, MAIL_MARKUP_RATE, MAIL_PROVIDER),
  letter: line('mail', 83, MAIL_MARKUP_RATE, MAIL_PROVIDER),
  handwritten: line('mail', 118, MAIL_MARKUP_RATE, null),
  'door-hanger': line('print', 21, PRINT_MARKUP_RATE, null),
  flyer: line('print', 8, PRINT_MARKUP_RATE, null),
  bandit: line('print', 395, PRINT_MARKUP_RATE, null),
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
  PRINT_MARKUP_RATE_MAX: PRINT_MARKUP_RATE_MAX,
  MAIL_PROVIDER: MAIL_PROVIDER,
  BASIS: BASIS,
  orderLine: orderLine,
  publicQuote: publicQuote,
};
