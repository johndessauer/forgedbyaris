// County document list and document image. Both endpoints are pay-per-record
// when Purchase=1. Purchase=0 on the transaction list is a count preview
// and returns no records. Callers must not invoke the Purchase=1 helpers
// unless the member confirmed and the feature flag is on.
//
// Member-facing payloads never include the upstream host or name.

const { readRuntimeEnv } = require('./runtime-env');
const loans = require('./loan-records');

const API_BASE = 'https://api.propertyradar.com/v1';
const LIST_FIELDS = [
  'DocumentID',
  'DocTypeUI',
  'RecDate',
  'Amount',
  'LoanPosition',
  'DocNumber',
  'hasDocumentImage',
  'Purpose',
];
const LIST_LIMIT = 20;
const VENDOR_HOST = /(^|\.)propertyradar\.com$/i;
const VENDOR_RE = /propertyradar/i;

function enabled(env) {
  const raw = readRuntimeEnv(env, 'LOAN_DOCS_ENABLED').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

// No default. Blank, zero, and non-integers are "not priced".
function memberPriceCents(env) {
  const raw = readRuntimeEnv(env, 'LOAN_DOC_MEMBER_PRICE_CENTS');
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 100000) return null;
  return n;
}

function apiKey(env) {
  return readRuntimeEnv(env, 'PROPERTYRADAR_API_KEY');
}

function validRadarId(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9]{4,32}$/.test(text)) return false;
  if (/^demo/i.test(text)) return false;
  return true;
}

function validDocumentId(value) {
  return /^[A-Za-z0-9]{4,40}$/.test(String(value || ''));
}

function transactionsUrl(radarId, purchase, limit) {
  const qs = new URLSearchParams({
    Purchase: purchase ? '1' : '0',
    Limit: String(limit),
    Fields: LIST_FIELDS.join(','),
    DocGroup: 'Mortgage,Lien',
  });
  return API_BASE + '/properties/' + encodeURIComponent(radarId) + '/transactions?' + qs.toString();
}

function documentUrl(documentId, radarId) {
  const qs = new URLSearchParams({
    Purchase: '1',
    Fields: 'DocImage,DocumentID',
    RadarID: radarId,
  });
  return API_BASE + '/documents/' + encodeURIComponent(documentId) + '?' + qs.toString();
}

function authHeaders(key) {
  return {
    Accept: 'application/json',
    Authorization: 'Bearer ' + key,
  };
}

async function getJson(fetchImpl, url, key) {
  const resp = await fetchImpl(url, { method: 'GET', headers: authHeaders(key) });
  if (!resp || !resp.ok) {
    const status = resp && resp.status ? resp.status : 502;
    return { ok: false, status: status };
  }
  let data = {};
  try { data = await resp.json(); }
  catch (err) { return { ok: false, status: 502 }; }
  return { ok: true, status: resp.status, data: data };
}

function publicDocument(row) {
  if (!row || typeof row !== 'object') return null;
  const documentId = loans.textOrNull(row.DocumentID);
  if (!validDocumentId(documentId)) return null;
  return {
    documentId: documentId,
    type: loans.textOrNull(row.DocTypeUI) || loans.textOrNull(row.Purpose) || 'Recorded document',
    date: loans.textOrNull(row.RecDate),
    amount: loans.numberOrNull(row.Amount),
    position: loans.textOrNull(row.LoanPosition),
    number: loans.textOrNull(row.DocNumber),
    hasImage: loans.flagOrNull(row.hasDocumentImage),
  };
}

// Purchase=0 first. A zero count does not continue into Purchase=1.
async function fetchTransactionList(options) {
  const fetchImpl = options.fetch;
  const key = apiKey(options.env);
  const radarId = options.radarId;
  if (!key) return { ok: false, code: 'unconfigured' };
  // Preview Limit matches the purchase cap. A Limit of 1 would make
  // resultCount 1 even when more documents match, and the paid call
  // would export only that one.
  const previewUrl = transactionsUrl(radarId, false, LIST_LIMIT);
  const preview = await getJson(fetchImpl, previewUrl, key);
  if (!preview.ok) return { ok: false, code: 'upstream', status: preview.status };
  const data = preview.data || {};
  const total = Number(data.totalResultCount);
  const selected = Number(data.resultCount != null ? data.resultCount : data.count);
  const count = Number.isFinite(total) ? total : (Number.isFinite(selected) ? selected : 0);
  const matches = count > 0 ? Math.min(LIST_LIMIT, Math.floor(count)) : 0;
  if (!matches) return { ok: true, documents: [], purchased: false };
  const paidUrl = transactionsUrl(radarId, true, matches);
  const paid = await getJson(fetchImpl, paidUrl, key);
  if (!paid.ok) return { ok: false, code: 'upstream', status: paid.status };
  const rows = Array.isArray(paid.data && paid.data.results) ? paid.data.results : [];
  const documents = rows.map(publicDocument).filter(Boolean);
  return { ok: true, documents: documents, purchased: true };
}

function dataUrlFromBytes(bytes, contentType) {
  const type = contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/gif' || contentType === 'image/webp'
    ? contentType
    : 'application/pdf';
  return 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64');
}

function sniffDataUrl(value) {
  const text = String(value || '').trim();
  const ready = text.match(/^data:(application\/pdf|image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (ready) {
    if (VENDOR_RE.test(ready[1])) return null;
    if (ready[2].length > 8000000) return null;
    return { dataUrl: 'data:' + ready[1].toLowerCase() + ';base64,' + ready[2], contentType: ready[1].toLowerCase() };
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(text) || text.length < 16 || text.length > 8000000) return null;
  const compact = text.replace(/\s/g, '');
  let contentType = '';
  if (compact.startsWith('JVBERi')) contentType = 'application/pdf';
  else if (compact.startsWith('iVBORw0')) contentType = 'image/png';
  else if (compact.startsWith('/9j/')) contentType = 'image/jpeg';
  else return null;
  return { dataUrl: 'data:' + contentType + ';base64,' + compact, contentType: contentType };
}

function remoteImageUrl(value) {
  if (!value || typeof value !== 'object') return '';
  const raw = value.url || value.href || value.link || '';
  if (typeof raw !== 'string') return '';
  let url;
  try { url = new URL(raw); }
  catch (err) { return ''; }
  if (url.protocol !== 'https:') return '';
  if (!VENDOR_HOST.test(url.hostname)) return '';
  if (url.username || url.password) return '';
  return url.toString();
}

function imageFromValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') return sniffDataUrl(value);
  if (typeof value === 'object') {
    if (typeof value.data === 'string') return sniffDataUrl(value.data);
    if (typeof value.base64 === 'string') return sniffDataUrl(value.base64);
    const remote = remoteImageUrl(value);
    if (remote) return { remoteUrl: remote };
  }
  return null;
}

async function downloadRemote(fetchImpl, url, key) {
  const resp = await fetchImpl(url, {
    method: 'GET',
    redirect: 'manual',
    headers: authHeaders(key),
  });
  const status = resp && resp.status ? resp.status : 0;
  if (status >= 300 && status < 400) return null;
  if (!resp || !resp.ok) return null;
  const headerType = String((resp.headers && resp.headers.get && resp.headers.get('content-type')) || '').split(';')[0].trim().toLowerCase();
  if (headerType && headerType !== 'application/pdf' && headerType.indexOf('image/') !== 0) return null;
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (!bytes.length || bytes.length > 6000000) return null;
  const contentType = headerType && headerType.indexOf('image/') === 0 ? headerType : 'application/pdf';
  return { dataUrl: dataUrlFromBytes(bytes, contentType), contentType: contentType };
}

async function fetchDocumentImage(options) {
  const fetchImpl = options.fetch;
  const key = apiKey(options.env);
  if (!key) return { ok: false, code: 'unconfigured' };
  const url = documentUrl(options.documentId, options.radarId);
  const loaded = await getJson(fetchImpl, url, key);
  if (!loaded.ok) return { ok: false, code: 'upstream', status: loaded.status };
  const results = loaded.data && loaded.data.results;
  const row = Array.isArray(results) ? results[0] : (loaded.data && loaded.data.DocImage != null ? loaded.data : null);
  const raw = row && (row.DocImage != null ? row.DocImage : row.docImage);
  const image = imageFromValue(raw);
  if (!image) return { ok: false, code: 'no_image' };
  if (image.remoteUrl) {
    const downloaded = await downloadRemote(fetchImpl, image.remoteUrl, key);
    if (!downloaded) return { ok: false, code: 'no_image' };
    return { ok: true, image: downloaded };
  }
  return { ok: true, image: { dataUrl: image.dataUrl, contentType: image.contentType } };
}

function containsVendorName(value) {
  return VENDOR_RE.test(JSON.stringify(value == null ? '' : value));
}

module.exports = {
  API_BASE,
  LIST_FIELDS,
  LIST_LIMIT,
  enabled,
  memberPriceCents,
  apiKey,
  validRadarId,
  validDocumentId,
  transactionsUrl,
  documentUrl,
  publicDocument,
  fetchTransactionList,
  fetchDocumentImage,
  sniffDataUrl,
  containsVendorName,
};
