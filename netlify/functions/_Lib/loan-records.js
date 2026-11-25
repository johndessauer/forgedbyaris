// Loan and lien facts that ride on the existing property export.
//
// POST /v1/properties bills one export per property record returned.
// Requesting one field or fifty on that same record is still one export
// (PropertyRadar pay-per-record guide). These scalars are added to the
// Fields list of that existing Purchase=1 call. Nothing here calls
// GET /properties/{RadarID}, which would purchase that RadarID again.
//
// Transactions is omitted. Transaction history is a separate pay-per-record
// endpoint, GET /v1/properties/{RadarID}/transactions, billed per
// transaction returned (Limit is "the maximum number of records returned
// and billed"). The property schema lists a Transactions field, but the
// docs do not say that requesting it stays inside the one property export.
// Document images use that transactions endpoint and the documents
// endpoint, and only from the disabled loan-records function.

const LOAN_EXPORT_FIELDS = [
  'NumberLoans',
  'TotalLoanBalance',
  'FirstLenderOriginal',
  'FirstAmount',
  'FirstDate',
  'FirstRate',
  'FirstLoanType',
  'FirstTermInYears',
  'CLTV',
  'PropertyHasOpenLiens',
  'isFreeAndClear',
  'RecorderSearchURL',
];

const VENDOR_RE = /propertyradar/i;

function numberOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[$,%\s,]/g, '');
  if (!text || VENDOR_RE.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || VENDOR_RE.test(text)) return null;
  return text.slice(0, 180);
}

function flagOrNull(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes') return true;
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'no') return false;
  return null;
}

function safeRecorderUrl(value) {
  const text = textOrNull(value);
  if (!text) return null;
  let url;
  try { url = new URL(text); }
  catch (err) { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (VENDOR_RE.test(url.hostname) || VENDOR_RE.test(url.href)) return null;
  return url.toString().slice(0, 500);
}

function emptyLoans() {
  return {
    numberLoans: null,
    totalLoanBalance: null,
    lender: null,
    originalAmount: null,
    date: null,
    rate: null,
    type: null,
    termYears: null,
    cltv: null,
    openLiens: null,
    freeAndClear: null,
    recorderUrl: null,
  };
}

function loansFromRadar(record) {
  const row = record || {};
  return {
    numberLoans: numberOrNull(row.NumberLoans),
    totalLoanBalance: numberOrNull(row.TotalLoanBalance),
    lender: textOrNull(row.FirstLenderOriginal),
    originalAmount: numberOrNull(row.FirstAmount),
    date: textOrNull(row.FirstDate),
    rate: numberOrNull(row.FirstRate),
    type: textOrNull(row.FirstLoanType),
    termYears: numberOrNull(row.FirstTermInYears),
    cltv: numberOrNull(row.CLTV),
    openLiens: flagOrNull(row.PropertyHasOpenLiens),
    freeAndClear: flagOrNull(row.isFreeAndClear),
    recorderUrl: safeRecorderUrl(row.RecorderSearchURL),
  };
}

// Saved leads store the mapped shape, not the upstream field names.
// Unknown keys are dropped so a client cannot persist a transaction dump.
function loansFromStored(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const looksUpstream = ['NumberLoans', 'FirstAmount', 'FirstLenderOriginal', 'RecorderSearchURL', 'CLTV', 'isFreeAndClear', 'PropertyHasOpenLiens']
    .some((key) => value[key] != null && value[key] !== '');
  if (looksUpstream) return loansFromRadar(value);
  return {
    numberLoans: numberOrNull(value.numberLoans),
    totalLoanBalance: numberOrNull(value.totalLoanBalance),
    lender: textOrNull(value.lender),
    originalAmount: numberOrNull(value.originalAmount),
    date: textOrNull(value.date),
    rate: numberOrNull(value.rate),
    type: textOrNull(value.type),
    termYears: numberOrNull(value.termYears),
    cltv: numberOrNull(value.cltv),
    openLiens: flagOrNull(value.openLiens),
    freeAndClear: flagOrNull(value.freeAndClear),
    recorderUrl: safeRecorderUrl(value.recorderUrl),
  };
}

function hasLoanFacts(loans) {
  if (!loans || typeof loans !== 'object') return false;
  return Object.keys(emptyLoans()).some((key) => loans[key] != null);
}

module.exports = {
  LOAN_EXPORT_FIELDS,
  emptyLoans,
  loansFromRadar,
  loansFromStored,
  hasLoanFacts,
  safeRecorderUrl,
  flagOrNull,
  numberOrNull,
  textOrNull,
};
