// Member file uploads.
//
// Files go straight to a private Storage bucket with a signed upload URL.
// Netlify never receives the bytes (a sync function rejects bodies around 6MB,
// and base64 makes that worse). This module checks size and type, keeps every
// path under the signed-in member, and turns PDFs, spreadsheets, Word files,
// and public Docs/Sheets links into text the model can read.
//
// Loaded with require / dynamic import. Do not use createRequire(import.meta.url).

const crypto = require('crypto');

const MAX_BYTES = 25 * 1024 * 1024;
const LEGACY_INLINE_MAX_BYTES = 4 * 1024 * 1024;
const MODEL_TEXT_MAX_CHARS = 48000;
const RESPONSE_BINARY_MAX_BYTES = Math.floor(3.5 * 1024 * 1024);
const DIRECT_IMAGE_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);
const DIRECT_PDF_MAX_BYTES = 4 * 1024 * 1024;
const LINK_FETCH_TIMEOUT_MS = 12000;
const LINK_MAX_REDIRECTS = 3;
const MAX_FILES_PER_REQUEST = 3;
const MAX_LINKS_PER_REQUEST = 3;

const PRIVATE_BUCKET = 'member-uploads';
const AVATAR_BUCKET = 'avatars';

const PRIVATE_LINK_MESSAGE = 'That file is private. Set sharing to Anyone with the link and try again.';
const BAD_LINK_MESSAGE = 'Paste a Google Docs or Google Sheets link.';

const EXT_MIME = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const SHEET_MIMES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const ANALYZER_MIMES = [PDF_MIME, DOCX_MIME].concat(SHEET_MIMES, IMAGE_MIMES);
const COACH_MIMES = ANALYZER_MIMES.slice();
const DOCUMENT_MIMES = ANALYZER_MIMES.concat(['application/msword']);
const DEAL_FILE_MIMES = DOCUMENT_MIMES.slice();

const PURPOSES = {
  quote: { bucket: PRIVATE_BUCKET, mimes: ANALYZER_MIMES },
  coach: { bucket: PRIVATE_BUCKET, mimes: COACH_MIMES },
  document: { bucket: PRIVATE_BUCKET, mimes: DOCUMENT_MIMES },
  'deal-file': { bucket: PRIVATE_BUCKET, mimes: DEAL_FILE_MIMES },
  avatar: { bucket: AVATAR_BUCKET, mimes: IMAGE_MIMES },
};

class UploadError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'UploadError';
    this.statusCode = statusCode || 400;
    this.code = code || 'upload';
  }
}

function extensionOf(filename) {
  const base = String(filename || '').split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeContentType(contentType, filename) {
  let mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpg' || mime === 'image/pjpeg' || mime === 'image/x-citrix-jpeg') mime = 'image/jpeg';
  if (mime === 'image/heic-sequence') mime = 'image/heic';
  if (mime === 'image/heif-sequence') mime = 'image/heif';
  if (mime === 'application/csv' || mime === 'text/comma-separated-values') mime = 'text/csv';
  if (mime === 'application/vnd.ms-excel' && extensionOf(filename) === 'xlsx') {
    mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream' || (mime === 'text/plain' && extensionOf(filename) === 'csv')) {
    mime = EXT_MIME[extensionOf(filename)] || '';
  }
  return mime;
}

function isAllowed(purpose, mime) {
  const spec = PURPOSES[purpose];
  return !!(spec && spec.mimes.indexOf(mime) !== -1);
}

function assertSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) throw new UploadError('Choose a file that is not empty.', 400, 'empty');
  if (n > MAX_BYTES) throw new UploadError('File is too large — max 25MB.', 400, 'too_large');
  return n;
}

function safeMemberId(memberId) {
  const id = String(memberId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) throw new UploadError('Sign in again, then retry the upload.', 401, 'auth');
  return id;
}

function safeFileName(name) {
  const base = String(name || 'file').split(/[/\\]/).pop();
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').replace(/^\.+/, '').slice(0, 80);
  return cleaned || 'file';
}

function assertMemberPath(memberId, objectPath) {
  const path = String(objectPath || '');
  if (!path || path.length > 700 || path.includes('..') || path.includes('\\') || path.startsWith('/') || path.includes('\0')) {
    throw new UploadError('That file path is not valid.', 400, 'bad_path');
  }
  const prefix = safeMemberId(memberId) + '/';
  if (!path.startsWith(prefix)) throw new UploadError('That file path is not valid.', 403, 'bad_path');
  return path;
}

function memberObjectPath(memberId, purpose, filename, nonce) {
  if (!PURPOSES[purpose] || purpose === 'avatar') throw new UploadError('Unknown upload.', 400, 'bad_purpose');
  const id = safeMemberId(memberId);
  const day = new Date().toISOString().slice(0, 10);
  const rand = nonce || crypto.randomBytes(8).toString('hex');
  if (!/^[a-f0-9]{8,32}$/.test(rand)) throw new UploadError('Could not start the upload.', 500, 'path');
  return id + '/' + purpose + '/' + day + '/' + rand + '-' + safeFileName(filename);
}

function avatarObjectPath(memberId, mime) {
  const ext = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  }[mime];
  if (!ext) throw new UploadError('Choose a JPEG, PNG, WEBP, GIF, or HEIC photo.', 400, 'bad_type');
  return safeMemberId(memberId) + '/avatar.' + ext;
}

function planUpload(memberId, body, nonce) {
  const purpose = String(body && body.purpose || '');
  const spec = PURPOSES[purpose];
  if (!spec) throw new UploadError('Unknown upload.', 400, 'bad_purpose');
  const filename = body.filename || 'file';
  const mime = normalizeContentType(body.contentType, filename);
  if (!isAllowed(purpose, mime)) throw new UploadError('That file type is not supported.', 400, 'bad_type');
  assertSize(body.size);
  const path = purpose === 'avatar' ? avatarObjectPath(memberId, mime) : memberObjectPath(memberId, purpose, filename, nonce);
  return { bucket: spec.bucket, path, contentType: mime, upsert: purpose === 'avatar' };
}

function base64DecodedBytes(data) {
  const s = String(data || '').replace(/\s/g, '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : (s.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

function dataUrlBytes(dataUrl) {
  const value = String(dataUrl || '');
  const comma = value.indexOf(',');
  if (comma === -1) return base64DecodedBytes(value);
  return base64DecodedBytes(value.slice(comma + 1));
}

function chunkPlain(text, maxChars) {
  const limit = maxChars || MODEL_TEXT_MAX_CHARS;
  const clean = String(text || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (clean.length <= limit) return clean;
  const marker = '\n\n[Middle of the file left out. The start and the end are included.]\n\n';
  const budget = Math.max(0, limit - marker.length);
  const head = Math.floor(budget * 0.62);
  const tail = budget - head;
  return clean.slice(0, head) + marker + clean.slice(clean.length - tail);
}

function chunkPages(pages, maxChars) {
  const limit = maxChars || MODEL_TEXT_MAX_CHARS;
  const list = Array.isArray(pages) ? pages : [];
  const labeled = [];
  list.forEach((page, index) => {
    const body = String(page || '').replace(/\u0000/g, '').trim();
    if (!body) return;
    labeled.push('Page ' + (index + 1) + '\n' + body);
  });
  if (!labeled.length) return '';
  const full = labeled.join('\n\n');
  if (full.length <= limit) return full;
  const marker = '\n\n[Some middle pages were left out. The first and last pages are included.]\n\n';
  const budget = Math.max(0, limit - marker.length);
  const headBudget = Math.floor(budget * 0.62);
  const tailBudget = budget - headBudget;
  const head = [];
  let used = 0;
  for (let i = 0; i < labeled.length; i++) {
    const page = labeled[i];
    if (head.length && used + page.length + 2 > headBudget) break;
    if (!head.length && page.length > headBudget) {
      head.push(page.slice(0, headBudget));
      used = headBudget;
      break;
    }
    head.push(page);
    used += page.length + 2;
  }
  const tail = [];
  used = 0;
  for (let i = labeled.length - 1; i >= head.length; i--) {
    const page = labeled[i];
    const room = tailBudget - used - (tail.length ? 2 : 0);
    if (room <= 0) break;
    if (page.length > room) {
      tail.unshift(page.slice(page.length - room));
      break;
    }
    tail.unshift(page);
    used += page.length + 2;
  }
  let joined = head.join('\n\n');
  if (tail.length) joined += marker + tail.join('\n\n');
  if (joined.length > limit) return chunkPlain(joined, limit);
  return joined;
}

function hasExtractableText(pages) {
  const letters = (Array.isArray(pages) ? pages.join(' ') : String(pages || '')).replace(/[^A-Za-z0-9]/g, '');
  return letters.length >= 8;
}

function textBlock(name, text, kind) {
  return {
    type: 'text',
    text: 'Uploaded ' + kind + ' "' + name + '" (text extracted for analysis):\n\n' + text,
  };
}

function binaryBlock(kind, mime, buffer) {
  return {
    type: kind,
    source: { type: 'base64', media_type: mime, data: buffer.toString('base64') },
  };
}

function parseGoogleLink(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch (e) { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.hostname.toLowerCase() !== 'docs.google.com') return null;
  const doc = url.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  if (doc) return { kind: 'doc', id: doc[1] };
  const sheet = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  if (sheet) return { kind: 'sheet', id: sheet[1] };
  return null;
}

function exportUrlFor(parsed) {
  if (!parsed) return '';
  if (parsed.kind === 'doc') return 'https://docs.google.com/document/d/' + parsed.id + '/export?format=txt';
  if (parsed.kind === 'sheet') return 'https://docs.google.com/spreadsheets/d/' + parsed.id + '/export?format=xlsx';
  return '';
}

function redirectAllowed(nextUrl) {
  let parsed;
  try { parsed = new URL(nextUrl); } catch (e) { return false; }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'docs.google.com') return true;
  if (host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com')) return true;
  return false;
}

function headerGet(res, name) {
  if (!res || !res.headers) return '';
  if (typeof res.headers.get === 'function') return res.headers.get(name) || res.headers.get(name.toLowerCase()) || '';
  const value = res.headers[name] || res.headers[name.toLowerCase()] || '';
  return Array.isArray(value) ? value[0] : String(value || '');
}

function looksLikeHtml(buffer, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('text/html') || type.includes('application/xhtml')) return true;
  const start = buffer.slice(0, 240).toString('utf8').trim().toLowerCase();
  return start.startsWith('<!doctype html') || start.startsWith('<html') || start.startsWith('<head');
}

async function readLimited(res, maxBytes) {
  const declared = Number(headerGet(res, 'content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new UploadError('That file is over 25MB.', 400, 'too_large');
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      total += value.byteLength;
      if (total > maxBytes) {
        if (typeof reader.cancel === 'function') await reader.cancel();
        throw new UploadError('That file is over 25MB.', 400, 'too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  if (typeof res.arrayBuffer === 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new UploadError('That file is over 25MB.', 400, 'too_large');
    return buf;
  }
  throw new UploadError('Could not read that link.', 502, 'read_failed');
}

function tablesFromWorkbook(wb) {
  const XLSX = require('xlsx');
  const parts = [];
  const names = wb && Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  names.forEach((name) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (!csv) return;
    parts.push('Tab: ' + String(name).replace(/[\r\n]/g, ' ').slice(0, 80) + '\n' + csv);
  });
  return chunkPlain(parts.join('\n\n'));
}

function spreadsheetBufferToText(buffer) {
  const XLSX = require('xlsx');
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    throw new UploadError('Could not read that spreadsheet.', 400, 'unreadable');
  }
  const text = tablesFromWorkbook(wb);
  if (!text) throw new UploadError('That spreadsheet is empty.', 400, 'empty');
  return text;
}

function csvBufferToText(buffer) {
  const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (raw.includes('\u0000')) throw new UploadError('That CSV could not be read.', 400, 'unreadable');
  const XLSX = require('xlsx');
  let wb;
  try {
    wb = XLSX.read(raw, { type: 'string' });
  } catch (e) {
    throw new UploadError('That CSV could not be read.', 400, 'unreadable');
  }
  const text = tablesFromWorkbook(wb);
  if (!text) throw new UploadError('That CSV is empty.', 400, 'empty');
  return text;
}

async function docxBufferToText(buffer) {
  const mammoth = require('mammoth');
  let result;
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch (e) {
    throw new UploadError('Could not read that Word document. Save it as .docx and try again.', 400, 'unreadable');
  }
  const text = chunkPlain(String(result && result.value || ''));
  if (!text) throw new UploadError('That Word document has no text.', 400, 'empty');
  return text;
}

async function pdfBufferToPages(buffer) {
  const unpdf = require('unpdf');
  const extractText = unpdf.extractText;
  const getDocumentProxy = unpdf.getDocumentProxy;
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: false });
  const text = result && result.text;
  if (Array.isArray(text)) return text.map((page) => String(page || ''));
  return [String(text || '')];
}

async function prepareAvatar(buffer, contentType, filename) {
  const mime = normalizeContentType(contentType, filename);
  if (!isAllowed('avatar', mime)) throw new UploadError('Choose a JPEG, PNG, WEBP, GIF, or HEIC photo.', 400, 'bad_type');
  if (buffer.length > MAX_BYTES) throw new UploadError('File is too large — max 25MB.', 400, 'too_large');
  if (mime === 'image/heic' || mime === 'image/heif') return convertHeic(buffer);
  return { buffer, mime };
}

async function convertHeic(buffer) {
  try {
    const convert = require('heic-convert');
    const output = await convert({ buffer, format: 'JPEG', quality: 0.82 });
    return { buffer: Buffer.from(output), mime: 'image/jpeg' };
  } catch (e) {
    throw new UploadError('That photo is in a high-efficiency format this page cannot read. Send a JPEG or PNG.', 400, 'heic');
  }
}

async function contentBlockFromBytes(file, options) {
  const opts = options || {};
  const binaryMax = Number.isFinite(opts.binaryMax) ? opts.binaryMax : 0;
  const name = safeFileName(file && file.name);
  let buffer = Buffer.isBuffer(file && file.buffer) ? file.buffer : Buffer.from(file && file.buffer || []);
  let mime = normalizeContentType(file && file.contentType, name);
  if (!mime || (!isAllowed('coach', mime) && !isAllowed('quote', mime) && !isAllowed('document', mime))) {
    throw new UploadError('That file type is not supported.', 400, 'bad_type');
  }
  if (buffer.length > MAX_BYTES) throw new UploadError('That file is over 25MB.', 400, 'too_large');
  if (mime === 'image/heic' || mime === 'image/heif') {
    const converted = await convertHeic(buffer);
    buffer = converted.buffer;
    mime = converted.mime;
  }
  if (mime === PDF_MIME) {
    let pages = [];
    try { pages = await pdfBufferToPages(buffer); } catch (e) { pages = []; }
    if (hasExtractableText(pages)) return textBlock(name, chunkPages(pages), 'PDF');
    if (buffer.length <= binaryMax && buffer.length <= DIRECT_PDF_MAX_BYTES) return binaryBlock('document', mime, buffer);
    throw new UploadError('That PDF looks scanned and is too large to read here. Upload a smaller file, or a PDF, Excel, Word, or CSV with selectable text.', 400, 'scan');
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mime === 'application/vnd.ms-excel') {
    return textBlock(name, spreadsheetBufferToText(buffer), 'spreadsheet');
  }
  if (mime === 'text/csv') return textBlock(name, csvBufferToText(buffer), 'CSV');
  if (mime === DOCX_MIME) return textBlock(name, await docxBufferToText(buffer), 'Word document');
  if (mime === 'application/msword') {
    throw new UploadError('Save that Word file as .docx and upload it again.', 400, 'bad_type');
  }
  if (mime.startsWith('image/')) {
    const cap = Math.min(binaryMax, DIRECT_IMAGE_MAX_BYTES);
    if (buffer.length <= cap && buffer.length <= DIRECT_IMAGE_MAX_BYTES) return binaryBlock('image', mime, buffer);
    throw new UploadError('That photo is too large to analyze. Send one under 5MB, or a JPEG or PNG.', 400, 'image_too_large');
  }
  throw new UploadError('That file type is not supported.', 400, 'bad_type');
}

async function fetchPublicGoogle(input, deps) {
  const options = deps || {};
  const parsed = parseGoogleLink(input);
  if (!parsed) throw new UploadError(BAD_LINK_MESSAGE, 400, 'bad_link');
  const exportUrl = exportUrlFor(parsed);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || LINK_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes || MAX_BYTES;
  let current = exportUrl;
  for (let hop = 0; hop <= LINK_MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
        headers: { Accept: parsed.kind === 'doc' ? 'text/plain,*/*' : 'application/octet-stream,*/*' },
      });
    } catch (err) {
      const name = err && err.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new UploadError('That link took too long to open. Try again.', 504, 'timeout');
      }
      throw new UploadError('Could not open that link. Try again.', 502, 'fetch_failed');
    }
    const status = Number(res && res.status);
    if (status >= 300 && status < 400) {
      const loc = headerGet(res, 'location');
      let next = '';
      try { next = loc ? new URL(loc, current).toString() : ''; } catch (e) { next = ''; }
      if (!next || !redirectAllowed(next)) throw new UploadError(PRIVATE_LINK_MESSAGE, 400, 'private_link');
      current = next;
      continue;
    }
    if (status === 401 || status === 403) throw new UploadError(PRIVATE_LINK_MESSAGE, 400, 'private_link');
    const buffer = await readLimited(res, maxBytes);
    const type = headerGet(res, 'content-type');
    if (status < 200 || status >= 300 || looksLikeHtml(buffer, type)) {
      throw new UploadError(PRIVATE_LINK_MESSAGE, 400, 'private_link');
    }
    if (parsed.kind === 'doc') {
      const text = chunkPlain(buffer.toString('utf8').replace(/^\uFEFF/, ''));
      if (!text) throw new UploadError('That document is empty.', 400, 'empty');
      return { name: 'Google Doc', kind: 'doc', text };
    }
    return { name: 'Google Sheet', kind: 'sheet', text: spreadsheetBufferToText(buffer) };
  }
  throw new UploadError(PRIVATE_LINK_MESSAGE, 400, 'private_link');
}

async function resolveBlock(block, state, options) {
  if (!block || typeof block !== 'object') return block;
  if (block.type === 'document' || block.type === 'image') {
    const data = block.source && block.source.type === 'base64' ? block.source.data : '';
    if (data && base64DecodedBytes(data) > LEGACY_INLINE_MAX_BYTES) {
      throw new UploadError('This file is too large to send directly. Refresh the page and upload it again.', 400, 'inline_too_large');
    }
    return block;
  }
  if (block.type === 'forge_file') {
    state.files += 1;
    if (state.files > MAX_FILES_PER_REQUEST) throw new UploadError('Attach up to 3 files at a time.', 400, 'too_many');
    const path = assertMemberPath(options.memberId, block.path);
    if (typeof options.loadObject !== 'function') throw new UploadError('Could not read that file.', 500, 'storage');
    const loaded = await options.loadObject(path);
    if (!loaded || !loaded.buffer) throw new UploadError('Upload it again. The file did not arrive.', 400, 'missing');
    return contentBlockFromBytes({
      buffer: loaded.buffer,
      contentType: loaded.contentType || block.mediaType,
      name: block.name || path,
    }, { binaryMax: options.binaryMax });
  }
  if (block.type === 'forge_link') {
    state.links += 1;
    if (state.links > MAX_LINKS_PER_REQUEST) throw new UploadError('Paste up to 3 links at a time.', 400, 'too_many');
    const imported = await fetchPublicGoogle(block.url, options);
    const kind = imported.kind === 'sheet' ? 'spreadsheet' : 'document';
    return textBlock(imported.name, imported.text, kind);
  }
  return block;
}

async function resolveMessages(messages, options) {
  if (!Array.isArray(messages)) return messages;
  const state = { files: 0, links: 0 };
  const out = [];
  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) {
      out.push(message);
      continue;
    }
    const content = [];
    for (const block of message.content) content.push(await resolveBlock(block, state, options || {}));
    out.push(Object.assign({}, message, { content }));
  }
  return out;
}

function storedAttachment(memberId, item, kind) {
  if (!item || typeof item !== 'object') throw new UploadError('That attachment is not valid.', 400, 'bad_attachment');
  if (item.path) {
    const path = assertMemberPath(memberId, item.path);
    const name = safeFileName(item.name);
    const mime = normalizeContentType(item.contentType, name);
    if (kind === 'photo') {
      if (!mime.startsWith('image/') || !isAllowed('deal-file', mime)) throw new UploadError('Choose a photo (JPEG, PNG, WEBP, GIF, or HEIC).', 400, 'bad_type');
    } else if (!isAllowed('deal-file', mime) || mime.startsWith('image/')) {
      throw new UploadError('Attach a PDF, Excel, Word, or CSV file.', 400, 'bad_type');
    }
    const size = assertSize(item.size);
    return { name, path, contentType: mime, size };
  }
  if (typeof item.dataUrl === 'string' && item.dataUrl) {
    const bytes = dataUrlBytes(item.dataUrl);
    if (bytes > LEGACY_INLINE_MAX_BYTES) {
      throw new UploadError('This file is too large to send directly. Refresh the page and upload it again.', 400, 'inline_too_large');
    }
    return { name: safeFileName(item.name || 'file'), dataUrl: item.dataUrl };
  }
  throw new UploadError('That attachment is not valid.', 400, 'bad_attachment');
}

function absoluteSignedUrl(signedUrl, supabaseUrl) {
  const value = String(signedUrl || '');
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(supabaseUrl || '').replace(/\/$/, '');
  if (!base || !value) return value;
  if (value.startsWith('/storage/')) return base + value;
  if (value.startsWith('/object/')) return base + '/storage/v1' + value;
  return base + '/storage/v1' + (value.startsWith('/') ? value : '/' + value);
}

module.exports = {
  MAX_BYTES,
  LEGACY_INLINE_MAX_BYTES,
  MODEL_TEXT_MAX_CHARS,
  RESPONSE_BINARY_MAX_BYTES,
  DIRECT_IMAGE_MAX_BYTES,
  DIRECT_PDF_MAX_BYTES,
  LINK_FETCH_TIMEOUT_MS,
  PRIVATE_BUCKET,
  AVATAR_BUCKET,
  PURPOSES,
  PRIVATE_LINK_MESSAGE,
  BAD_LINK_MESSAGE,
  UploadError,
  normalizeContentType,
  isAllowed,
  extensionOf,
  assertSize,
  assertMemberPath,
  memberObjectPath,
  avatarObjectPath,
  planUpload,
  safeFileName,
  base64DecodedBytes,
  dataUrlBytes,
  chunkPlain,
  chunkPages,
  hasExtractableText,
  parseGoogleLink,
  exportUrlFor,
  redirectAllowed,
  fetchPublicGoogle,
  contentBlockFromBytes,
  spreadsheetBufferToText,
  csvBufferToText,
  docxBufferToText,
  pdfBufferToPages,
  prepareAvatar,
  resolveMessages,
  storedAttachment,
  absoluteSignedUrl,
};
