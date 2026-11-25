const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const uploads = require('../netlify/functions/_Lib/member-uploads');
const client = require('../assets/js/direct-upload');
const { createHandler } = require('../netlify/functions/storage-upload');
const { createHandler: createQuote } = require('../netlify/functions/aris-quote');

const ROOT = path.join(__dirname, '..');

function pdfWithText(text) {
  const parts = [];
  const offsets = [0];
  function obj(n, body) {
    offsets[n] = parts.join('').length;
    parts.push(n + ' 0 obj\n' + body + '\nendobj\n');
  }
  parts.push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  const stream = 'BT /F1 18 Tf 72 720 Td (' + text + ') Tj ET';
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  obj(4, '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xrefAt = parts.join('').length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  parts.push(xref);
  parts.push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n');
  return Buffer.from(parts.join(''));
}

function response({ status, headers, body }) {
  const map = headers || {};
  return {
    status: status == null ? 200 : status,
    headers: { get(name) { return map[String(name).toLowerCase()] || ''; } },
    arrayBuffer: async () => body || Buffer.alloc(0),
  };
}

test('25MB is the limit and 4MB inline files still fit', () => {
  assert.equal(uploads.MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(uploads.LEGACY_INLINE_MAX_BYTES, 4 * 1024 * 1024);
  assert.equal(uploads.assertSize(uploads.MAX_BYTES), uploads.MAX_BYTES);
  assert.throws(() => uploads.assertSize(uploads.MAX_BYTES + 1), (err) => err.code === 'too_large' && /25MB/.test(err.message));
  assert.throws(() => uploads.assertSize(0), (err) => err.code === 'empty');
  assert.equal(client.MAX_BYTES, uploads.MAX_BYTES);
});

test('type checks accept photos, HEIC, PDF, Excel, Word, and CSV', () => {
  const samples = [
    ['', 'contract.PDF', 'application/pdf'],
    ['application/octet-stream', 'rent.csv', 'text/csv'],
    ['text/plain', 'rent.csv', 'text/csv'],
    ['application/vnd.ms-excel', 'book.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['', 'offer.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['', 'IMG_0001.HEIC', 'image/heic'],
    ['image/jpg', 'photo.jpg', 'image/jpeg'],
    ['image/heif', 'photo.heif', 'image/heif'],
  ];
  for (const [type, name, mime] of samples) {
    assert.equal(uploads.normalizeContentType(type, name), mime, name);
    assert.equal(client.normalizeContentType(type, name), mime, name);
    assert.equal(uploads.isAllowed('quote', mime), client.isAllowed('quote', mime), name);
    assert.equal(uploads.isAllowed('coach', mime), true, name);
  }
  assert.equal(uploads.isAllowed('quote', 'application/msword'), false);
  assert.equal(uploads.isAllowed('document', 'application/msword'), true);
  assert.equal(uploads.isAllowed('coach', 'application/x-msdownload'), false);
  assert.equal(client.isAllowed('avatar', 'image/heic'), true);
});

test('paths stay under the signed-in member', () => {
  const path = uploads.memberObjectPath('mem_abc', 'quote', '../secret.pdf', 'abcd1234');
  assert.equal(path.startsWith('mem_abc/quote/'), true);
  assert.equal(path.includes('..'), false);
  assert.equal(uploads.assertMemberPath('mem_abc', path), path);
  assert.throws(() => uploads.assertMemberPath('mem_abc', 'mem_other/quote/file.pdf'), (err) => err.statusCode === 403);
  assert.throws(() => uploads.assertMemberPath('mem_abc', 'mem_abc/../mem_other/file.pdf'));
  assert.throws(() => uploads.assertMemberPath('mem_abc', '/mem_abc/file.pdf'));
  const plan = uploads.planUpload('mem_abc', {
    purpose: 'quote',
    filename: 'evil/../../other.pdf',
    contentType: 'application/pdf',
    size: 1200,
    path: 'mem_other/stolen.pdf',
  }, 'abcd1234');
  assert.equal(plan.bucket, 'member-uploads');
  assert.equal(plan.path.startsWith('mem_abc/quote/'), true);
  assert.equal(plan.path.includes('stolen'), false);
  assert.equal(uploads.planUpload('mem_abc', { purpose: 'avatar', filename: 'me.heic', contentType: 'image/heic', size: 10 }).path, 'mem_abc/avatar.heic');
});

test('long documents keep the first and last pages under the model cap', () => {
  const pages = [];
  for (let i = 0; i < 6; i++) pages.push(('PageBody' + i + ' ').repeat(4000) + 'END' + i);
  const text = uploads.chunkPages(pages);
  assert.ok(text.length <= uploads.MODEL_TEXT_MAX_CHARS);
  assert.match(text, /Page 1/);
  assert.match(text, /PageBody0/);
  assert.match(text, /END5/);
  assert.match(text, /middle pages/i);
  const small = uploads.chunkPages(['Asking price 250000']);
  assert.match(small, /Asking price 250000/);
  assert.equal(/middle pages/i.test(small), false);
});

test('PDF, spreadsheet, CSV, and Word text are extracted', async () => {
  const pdf = await uploads.contentBlockFromBytes({
    buffer: pdfWithText('Asking price 250000'),
    contentType: 'application/pdf',
    name: 'contract.pdf',
  }, { binaryMax: uploads.DIRECT_PDF_MAX_BYTES });
  assert.equal(pdf.type, 'text');
  assert.match(pdf.text, /Asking price 250000/);
  assert.equal(pdf.text.includes('base64'), false);

  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Amount'], ['Asking', 250000]]), 'Rent Roll');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Expense', 'Amount'], ['Tax', 1200]]), 'T-12');
  const sheet = uploads.spreadsheetBufferToText(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.match(sheet, /Tab: Rent Roll/);
  assert.match(sheet, /Tab: T-12/);
  assert.match(sheet, /250000/);
  assert.match(sheet, /1200/);

  const csv = uploads.csvBufferToText(Buffer.from('Item,Amount\nAsking,180000\n', 'utf8'));
  assert.match(csv, /Asking/);
  assert.match(csv, /180000/);

  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Rehab budget 40000</w:t></w:r></w:p></w:body>
</w:document>`);
  const docx = await uploads.docxBufferToText(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.match(docx, /Rehab budget 40000/);
});

test('Google links are only public Docs and Sheets exports', async () => {
  const seen = [];
  const doc = await uploads.fetchPublicGoogle('https://docs.google.com/document/d/abc_123/edit?usp=sharing', {
    fetchImpl: async (url) => {
      seen.push(String(url));
      return response({ headers: { 'content-type': 'text/plain' }, body: Buffer.from('Purchase price 250000') });
    },
  });
  assert.equal(seen[0], 'https://docs.google.com/document/d/abc_123/export?format=txt');
  assert.match(doc.text, /Purchase price 250000/);

  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Rent', 2000]]), 'Units');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tax', 900]]), 'Expenses');
  const sheetBytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const hops = [];
  const sheet = await uploads.fetchPublicGoogle('https://docs.google.com/spreadsheets/d/SHEET123/edit#gid=0', {
    fetchImpl: async (url) => {
      hops.push(String(url));
      if (hops.length === 1) {
        return response({ status: 302, headers: { location: 'https://doc-00-docs.googleusercontent.com/export/SHEET123' } });
      }
      return response({
        headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        body: sheetBytes,
      });
    },
  });
  assert.equal(hops[0], 'https://docs.google.com/spreadsheets/d/SHEET123/export?format=xlsx');
  assert.match(hops[1], /^https:\/\/doc-00-docs\.googleusercontent\.com\//);
  assert.match(sheet.text, /Tab: Units/);
  assert.match(sheet.text, /Tab: Expenses/);

  let called = false;
  const refused = [
    'https://evil.example/document/d/abc_123',
    'http://docs.google.com/document/d/abc_123/edit',
    'https://drive.google.com/file/d/abc_123/view',
    'https://docs.google.com.evil.com/document/d/abc_123/edit',
    'https://user:pass@docs.google.com/document/d/abc_123/edit',
  ];
  for (const url of refused) {
    await assert.rejects(uploads.fetchPublicGoogle(url, { fetchImpl: async () => { called = true; } }), (err) => err.code === 'bad_link');
  }
  assert.equal(called, false);

  const stolen = [];
  await assert.rejects(uploads.fetchPublicGoogle('https://docs.google.com/document/d/abc_123/edit', {
    fetchImpl: async (url) => {
      stolen.push(String(url));
      return response({ status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } });
    },
  }), (err) => err.code === 'private_link' && /Anyone with the link/.test(err.message));
  assert.equal(stolen.length, 1);
  assert.equal(/accounts\.google\.com/.test(stolen[0]), false);

  let readBody = false;
  await assert.rejects(uploads.fetchPublicGoogle('https://docs.google.com/document/d/abc_123/edit', {
    fetchImpl: async () => ({
      status: 200,
      headers: { get(name) { return String(name).toLowerCase() === 'content-length' ? String(uploads.MAX_BYTES + 1) : ''; } },
      arrayBuffer: async () => { readBody = true; return Buffer.alloc(0); },
    }),
  }), (err) => err.code === 'too_large');
  assert.equal(readBody, false);

  await assert.rejects(uploads.fetchPublicGoogle('https://docs.google.com/document/d/abc_123/edit', {
    fetchImpl: async () => { const err = new Error('slow'); err.name = 'TimeoutError'; throw err; },
  }), (err) => err.code === 'timeout');
});

test('the signing function checks the member, size, and type', async () => {
  const signed = [];
  const handler = createHandler({
    nonce: 'abcd1234',
    env: { SUPABASE_URL: 'https://project.example' },
    enforceMembership: async (event) => {
      const header = event.headers.authorization || '';
      if (header !== 'Bearer tok') return { response: { statusCode: 401, headers: {}, body: JSON.stringify({ error: 'Sign in again' }) } };
      return { access: { memberId: 'mem_abc' } };
    },
    getStorage: async () => ({
      sign: async (bucket, objectPath) => {
        signed.push({ bucket, objectPath });
        return { signedUrl: '/object/upload/sign/' + bucket + '/' + objectPath + '?token=test-token', token: 'test-token' };
      },
    }),
  });
  const call = (body, auth) => handler({
    httpMethod: 'POST',
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  }).then((res) => ({ status: res.statusCode, body: JSON.parse(res.body) }));

  assert.equal((await call({ action: 'sign', purpose: 'quote', filename: 'a.pdf', contentType: 'application/pdf', size: 10 }, null)).status, 401);
  const tooBig = await call({ action: 'sign', purpose: 'quote', filename: 'a.pdf', contentType: 'application/pdf', size: uploads.MAX_BYTES + 1 }, 'Bearer tok');
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.body.code, 'too_large');
  const bad = await call({ action: 'sign', purpose: 'quote', filename: 'a.exe', contentType: 'application/octet-stream', size: 10 }, 'Bearer tok');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_type');
  const ok = await call({
    action: 'sign',
    purpose: 'quote',
    filename: 'contract.pdf',
    contentType: 'application/pdf',
    size: 2048,
    path: 'mem_other/nope.pdf',
  }, 'Bearer tok');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.bucket, 'member-uploads');
  assert.equal(ok.body.path.startsWith('mem_abc/quote/'), true);
  assert.equal(ok.body.path.includes('nope'), false);
  assert.equal(ok.body.signedUrl.startsWith('https://project.example/storage/v1/object/upload/sign/'), true);
  assert.equal(signed[0].objectPath, ok.body.path);
  assert.equal(signed.length, 1);
});

test('quote calls read a stored file instead of a base64 blob', async () => {
  const sent = [];
  const handler = createQuote({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    verifyMember: async () => 'mem_abc',
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { json: async () => ({ content: [{ type: 'text', text: '{"asking_price":250000}' }] }) };
    },
    prepareMessages: (messages, ctx) => uploads.resolveMessages(messages, {
      memberId: ctx.memberId,
      binaryMax: uploads.DIRECT_PDF_MAX_BYTES,
      loadObject: async () => ({ buffer: Buffer.from('Item,Amount\nAsking,250000\n', 'utf8'), contentType: 'text/csv' }),
      fetchImpl: async () => response({ headers: { 'content-type': 'text/plain' }, body: Buffer.from('Private should not be used') }),
    }),
  });
  const ok = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({
      max_tokens: 200,
      messages: [{ role: 'user', content: [
        { type: 'forge_file', path: 'mem_abc/quote/rent.csv', mediaType: 'text/csv', name: 'rent.csv' },
        { type: 'text', text: 'Extract the numbers.' },
      ] }],
    }),
  });
  assert.equal(ok.statusCode, 200);
  const content = sent[0].messages[0].content;
  assert.equal(content.some((block) => block.type === 'text' && /250000/.test(block.text)), true);
  assert.equal(JSON.stringify(content).includes('forge_file'), false);
  assert.equal(JSON.stringify(content).includes('"type":"document"'), false);

  const blocked = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: [
        { type: 'forge_link', url: 'https://docs.google.com/document/d/abc_123/edit' },
        { type: 'text', text: 'Read this.' },
      ] }],
    }),
  });
  // The injected fetcher returns plain text, so this one succeeds. A private
  // response is covered below with the real guard and a fresh handler.
  assert.equal(blocked.statusCode, 200);

  let anthropic = 0;
  const quote = createQuote({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    verifyMember: async () => 'mem_abc',
    fetch: async () => { anthropic += 1; return { json: async () => ({}) }; },
    prepareMessages: (messages, ctx) => uploads.resolveMessages(messages, {
      memberId: ctx.memberId,
      fetchImpl: async () => response({ status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } }),
    }),
  });
  const priv = await quote({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'forge_link', url: 'https://docs.google.com/spreadsheets/d/SHEET123/edit' }] }] }),
  });
  assert.equal(priv.statusCode, 400);
  assert.equal(JSON.parse(priv.body).code, 'private_link');
  assert.match(JSON.parse(priv.body).message, /Anyone with the link/);
  assert.equal(anthropic, 0);

  const legacy = Buffer.alloc(uploads.LEGACY_INLINE_MAX_BYTES + 1).toString('base64');
  const huge = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: legacy } }] }] }),
  });
  assert.equal(huge.statusCode, 400);
  assert.equal(JSON.parse(huge.body).code, 'inline_too_large');
});

test('small inline files still pass through while this rolls out', async () => {
  const sent = [];
  const handler = createQuote({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    verifyMember: async () => 'mem_abc',
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    },
  });
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('tiny').toString('base64') } },
      { type: 'text', text: 'Read it.' },
    ] }] }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(sent[0].messages[0].content[0].type, 'document');
  assert.equal(sent[0].messages[0].content[0].source.data, Buffer.from('tiny').toString('base64'));
});

test('saved attachments reject another member and oversized inline files', () => {
  const stored = uploads.storedAttachment('mem_abc', {
    name: 'front.heic',
    path: 'mem_abc/deal-file/front.heic',
    contentType: 'image/heic',
    size: 1000,
    dataUrl: 'data:image/heic;base64,AAAA',
  }, 'photo');
  assert.equal(stored.path, 'mem_abc/deal-file/front.heic');
  assert.equal(stored.dataUrl, undefined);
  assert.throws(() => uploads.storedAttachment('mem_abc', { path: 'mem_other/deal-file/a.pdf', contentType: 'application/pdf', size: 10, name: 'a.pdf' }, 'doc'));
  const big = 'data:application/pdf;base64,' + Buffer.alloc(uploads.LEGACY_INLINE_MAX_BYTES + 1).toString('base64');
  assert.throws(() => uploads.storedAttachment('mem_abc', { name: 'big.pdf', dataUrl: big }, 'doc'), (err) => err.code === 'inline_too_large');
  const small = uploads.storedAttachment('mem_abc', { name: 'note.pdf', dataUrl: 'data:application/pdf;base64,YQ==' }, 'doc');
  assert.equal(typeof small.dataUrl, 'string');
});

test('pages advertise 25MB and the new file types', () => {
  const analyzer = fs.readFileSync(path.join(ROOT, 'deal-analyzer.html'), 'utf8');
  const coach = fs.readFileSync(path.join(ROOT, 'aris-coach.html'), 'utf8');
  const crm = fs.readFileSync(path.join(ROOT, 'crm.html'), 'utf8');
  const profile = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
  for (const src of [analyzer, coach, crm, profile]) {
    assert.equal(/max 4MB|Max 4MB/i.test(src), false);
    assert.match(src, /25MB|25 \* 1024 \* 1024/);
    assert.match(src, /direct-upload\.js/);
  }
  assert.match(analyzer, /\.xlsx/);
  assert.match(analyzer, /\.docx/);
  assert.match(analyzer, /\.csv/);
  assert.match(analyzer, /\.heic/);
  assert.match(analyzer, /readDealLink\('w'\)/);
  assert.match(analyzer, /forge_file/);
  assert.match(analyzer, /forge_link/);
  assert.match(coach, /\.xlsx/);
  assert.match(coach, /\.heic/);
  assert.match(coach, /forge_link/);
  assert.match(coach, /Anyone with the link/);
  const sql = fs.readFileSync(path.join(ROOT, 'sql/migrations/add-member-uploads.sql'), 'utf8');
  assert.match(sql, /member-uploads/);
  assert.match(sql, /26214400/);
  assert.match(sql, /on conflict \(id\) do update/);
  assert.match(sql, /storage_path/);
  const fn = fs.readFileSync(path.join(ROOT, 'netlify/functions/storage-upload.js'), 'utf8');
  assert.equal(fn.includes('createRequire'), false);
  assert.match(fn, /enforceMembership/);
});

test('the coach edge resolves storage paths without fetching arbitrary links', async () => {
  const edge = await import(pathToFileURL(path.join(ROOT, 'netlify/edge-functions/lib/resolve-uploads.js')).href);
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'user', content: [{ type: 'forge_file', path: 'mem_abc/coach/a.pdf', name: 'a.pdf' }, { type: 'forge_link', url: 'https://docs.google.com/document/d/abc/edit' }] },
  ];
  const found = edge.collectUploads(messages);
  assert.equal(found.files.length, 1);
  assert.equal(found.links.length, 1);
  assert.equal(edge.oversizedInline([{ role: 'user', content: [{ type: 'document', source: { type: 'base64', data: 'YQ==' } }] }]), false);
  const huge = Buffer.alloc(uploads.LEGACY_INLINE_MAX_BYTES + 1).toString('base64');
  assert.equal(edge.oversizedInline([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: huge } }] }]), true);
  const applied = edge.applyResolvedBlocks(messages, {
    files: [{ path: 'mem_abc/coach/a.pdf', block: { type: 'text', text: 'extracted' } }],
    links: [{ url: 'https://docs.google.com/document/d/abc/edit', block: { type: 'text', text: 'doc text' } }],
  });
  assert.equal(applied[1].content[0].text, 'extracted');
  assert.equal(applied[1].content[1].text, 'doc text');
});
