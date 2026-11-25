// Browser helper for direct file uploads. The bytes go to Storage with a
// signed URL. This page only sends the storage path (or a Docs/Sheets link)
// to the app afterwards.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ForgeUpload = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var MAX_BYTES = 25 * 1024 * 1024;
  var ACCEPT_DOCUMENT = 'application/pdf,.pdf,text/csv,.csv,application/vnd.ms-excel,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif';
  var ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/*,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif';
  var ACCEPT_CRM = ACCEPT_DOCUMENT + ',application/msword,.doc';

  var EXT_MIME = {
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
    heif: 'image/heif'
  };

  var PURPOSES = {
    quote: ['application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
    coach: ['application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
    document: ['application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
    'deal-file': ['application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
    avatar: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
  };

  function extensionOf(filename) {
    var base = String(filename || '').split(/[/\\]/).pop() || '';
    var dot = base.lastIndexOf('.');
    if (dot < 0) return '';
    return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function normalizeContentType(contentType, filename) {
    var mime = String(contentType || '').split(';')[0].trim().toLowerCase();
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
    var list = PURPOSES[purpose];
    return !!(list && list.indexOf(mime) !== -1);
  }

  function formatSize(bytes) {
    var n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function parseGoogleLink(input) {
    var url;
    try { url = new URL(String(input || '').trim()); } catch (e) { return null; }
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.hostname.toLowerCase() !== 'docs.google.com') return null;
    if (/\/document\/(?:u\/\d+\/)?d\/[a-zA-Z0-9_-]+/.test(url.pathname)) return { kind: 'doc' };
    if (/\/spreadsheets\/(?:u\/\d+\/)?d\/[a-zA-Z0-9_-]+/.test(url.pathname)) return { kind: 'sheet' };
    return null;
  }

  function findGoogleLink(text) {
    var matches = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    for (var i = 0; i < matches.length; i++) {
      var trimmed = matches[i].replace(/[),.;]+$/, '');
      if (parseGoogleLink(trimmed)) return trimmed;
    }
    return '';
  }

  async function uploadFile(file, opts) {
    var options = opts || {};
    var fetchImpl = options.fetchImpl || options.fetch || globalThis.fetch;
    if (!file) throw new Error('Choose a file.');
    if (file.size > MAX_BYTES) {
      var tooBig = new Error('File is too large — max 25MB.');
      tooBig.code = 'too_large';
      throw tooBig;
    }
    var contentType = normalizeContentType(file.type, file.name);
    if (!isAllowed(options.purpose, contentType)) {
      var bad = new Error('That file type is not supported.');
      bad.code = 'bad_type';
      throw bad;
    }
    var signRes = await fetchImpl('/api/storage-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + options.token },
      body: JSON.stringify({
        action: 'sign',
        purpose: options.purpose,
        filename: file.name,
        contentType: contentType,
        size: file.size
      })
    });
    var signed = {};
    try { signed = await signRes.json(); } catch (e) { signed = {}; }
    if (!signRes.ok || !signed.signedUrl || !signed.path) {
      throw new Error(signed.message || 'Could not start the upload.');
    }
    var putHeaders = { 'Content-Type': contentType };
    if (signed.upsert) putHeaders['x-upsert'] = 'true';
    var putRes = await fetchImpl(signed.signedUrl, { method: 'PUT', headers: putHeaders, body: file });
    if (!putRes.ok) throw new Error('Could not upload the file. Try again.');
    return { bucket: signed.bucket, path: signed.path, contentType: contentType, name: file.name, size: file.size };
  }

  async function uploadDataUrl(dataUrl, filename, opts) {
    var value = String(dataUrl || '');
    var comma = value.indexOf(',');
    var meta = comma === -1 ? '' : value.slice(0, comma);
    var b64 = comma === -1 ? value : value.slice(comma + 1);
    var mimeMatch = meta.match(/^data:([^;,]+)/i);
    var mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var blob = new Blob([bytes], { type: mime });
    var file = new File([blob], filename || 'report.pdf', { type: mime });
    return uploadFile(file, opts);
  }

  return {
    MAX_BYTES: MAX_BYTES,
    ACCEPT_DOCUMENT: ACCEPT_DOCUMENT,
    ACCEPT_COACH: ACCEPT_DOCUMENT,
    ACCEPT_IMAGE: ACCEPT_IMAGE,
    ACCEPT_CRM: ACCEPT_CRM,
    normalizeContentType: normalizeContentType,
    isAllowed: isAllowed,
    formatSize: formatSize,
    parseGoogleLink: parseGoogleLink,
    findGoogleLink: findGoogleLink,
    uploadFile: uploadFile,
    uploadDataUrl: uploadDataUrl
  };
});
