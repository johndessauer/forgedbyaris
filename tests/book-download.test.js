const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const badges = require('../netlify/functions/_Lib/education-badges');
const download = require('../netlify/functions/book-download');

const ROOT = path.join(__dirname, '..');
const COACHING_URL = 'https://calendar.app.google/eyhEYt8ApK1DAQWY6';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function handlerFor(badgesForMember, store) {
  const calls = { store: 0, badges: 0 };
  const handler = download.createHandler({
    enforceMembership: async () => ({ access: { memberId: 'mem_test' } }),
    loadBadges: async () => {
      calls.badges += 1;
      return badgesForMember;
    },
    getStore: (name) => {
      calls.store += 1;
      assert.equal(name, 'forge-books');
      return store;
    },
  });
  return { handler, calls };
}

function event(book, part) {
  const params = { book };
  if (part) params.part = part;
  return { httpMethod: 'GET', queryStringParameters: params, headers: { authorization: 'Bearer test' } };
}

test('badge rule matches the lesson list: every published topic, passed', () => {
  const modules = [{ id: 'a' }, { id: 'b' }];
  const none = badges.badgesFromProgress(modules, []);
  assert.deepEqual(none, { rookie: false, investor: false, mogul: false });

  const oneRookie = badges.badgesFromProgress(modules, [
    { module_id: 'a', tier: 'rookie', passed: true },
  ]);
  assert.equal(oneRookie.rookie, false);

  const rookie = badges.badgesFromProgress(modules, [
    { module_id: 'a', tier: 'rookie', passed: true },
    { module_id: 'b', tier: 'rookie', passed: true },
  ]);
  assert.equal(rookie.rookie, true);
  assert.equal(rookie.investor, false);

  const failed = badges.badgesFromProgress(modules, [
    { module_id: 'a', tier: 'rookie', passed: true },
    { module_id: 'b', tier: 'rookie', passed: false },
  ]);
  assert.equal(failed.rookie, false);
  assert.deepEqual(badges.badgesFromProgress([], []), { rookie: false, investor: false, mogul: false });
});

test('Rookie or higher gets H2O, and Investor or higher gets Apartment Confidential', () => {
  const h2o = badges.BOOKS['real-estate-h2o'];
  const apt = badges.BOOKS['apartment-confidential'];
  assert.equal(h2o.minLevel, 'rookie');
  assert.equal(h2o.blobKey, 'real-estate-h2o.pdf');
  assert.equal(apt.minLevel, 'investor');
  assert.equal(apt.blobKey, 'apartment-confidential.pdf');
  assert.equal(badges.BOOK_STORE, 'forge-books');
  assert.deepEqual(badges.LEVEL_LABEL, { rookie: 'Rookie', investor: 'Investor', mogul: 'Mogul' });

  const cases = [
    [{}, false, false],
    [{ rookie: true }, true, false],
    [{ investor: true }, true, true],
    [{ mogul: true }, true, true],
    [{ rookie: true, investor: true, mogul: true }, true, true],
  ];
  for (const [level, h2oOk, aptOk] of cases) {
    assert.equal(badges.meetsLevel(level, 'rookie'), h2oOk, JSON.stringify(level));
    assert.equal(badges.meetsLevel(level, 'investor'), aptOk, JSON.stringify(level));
  }
});

test('a Rookie cannot download Apartment Confidential, and a missing blob is a friendly 404', async () => {
  const rookie = handlerFor({ rookie: true });
  const denied = await rookie.handler(event('apartment-confidential'));
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body, /Earn the Investor level to download Apartment Confidential/);
  assert.equal(denied.body.includes(COACHING_URL), false);
  assert.equal(rookie.calls.store, 0);

  const store = {
    async get(key, options) {
      assert.equal(key, 'real-estate-h2o.pdf');
      assert.equal(options.type, 'stream');
      return null;
    },
  };
  const missing = handlerFor({ rookie: true }, store);
  const res = await missing.handler(event('real-estate-h2o'));
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /Real Estate H2O isn't available for download yet/);
  assert.equal(missing.calls.store, 1);
});

test('Investor or higher receives the PDF stream and the coaching link', async () => {
  const bytes = Buffer.from('%PDF-1.4 apartment');
  const store = {
    async get(key, options) {
      assert.equal(options.type, 'stream');
      assert.equal(key, 'apartment-confidential.pdf');
      return (async function* () { yield bytes; })();
    },
  };
  const investor = handlerFor({ investor: true }, store);
  const pdf = await investor.handler(event('apartment-confidential'));
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.isBase64Encoded, true);
  assert.match(pdf.headers['Content-Type'], /application\/pdf/);
  assert.match(pdf.headers['Content-Disposition'], /Apartment-Confidential\.pdf/);
  assert.equal(Buffer.from(pdf.body, 'base64').toString(), '%PDF-1.4 apartment');

  const coaching = await investor.handler(event('apartment-confidential', 'coaching'));
  assert.equal(coaching.statusCode, 200);
  const body = JSON.parse(coaching.body);
  assert.equal(body.url, COACHING_URL);
  assert.equal(body.callsUsed, 0);
  assert.equal(body.callsTotal, 3);
  assert.match(body.callsNote, /not tracked/);

  const mogul = handlerFor({ mogul: true }, {
    async get() { return bytes; },
  });
  const mogulPdf = await mogul.handler(event('real-estate-h2o'));
  assert.equal(mogulPdf.statusCode, 200);

  const h2oCalls = await investor.handler(event('real-estate-h2o', 'coaching'));
  assert.equal(h2oCalls.statusCode, 404);
  assert.equal(h2oCalls.body.includes(COACHING_URL), false);
});

test('the coaching link stays out of public pages and public scripts', () => {
  assert.equal(download.COACHING_BOOKING_URL, COACHING_URL);
  const server = read('netlify/functions/book-download.js');
  assert.match(server, /calendar\.app\.google\/eyhEYt8ApK1DAQWY6/);

  const files = walk(ROOT, []).filter((file) => {
    return file.endsWith('.html') || file.endsWith('.js') || file.endsWith('.css');
  });
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (rel === path.join('netlify', 'functions', 'book-download.js')) continue;
    if (rel === path.join('tests', 'book-download.test.js')) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes(COACHING_URL), false, rel);
    assert.equal(text.includes('calendar.app.google'), false, rel);
  }

  const investor = read('unlocks/investor.html');
  assert.match(investor, /Your 3 coaching calls with John/);
  assert.match(investor, /Calls used: 0 of 3/);
  assert.match(investor, /This count is not tracked/);
  assert.match(investor, /id="coaching-book-btn"[^>]*disabled/);
  assert.equal(/<a[^>]*coaching-book-btn/.test(investor), false);
  assert.match(investor, /You've unlocked Apartment Confidential/);
  assert.match(investor, /data-level="investor"/);
  assert.match(investor, /src="\/assets\/apartment-confidential-cover-3d\.jpg"/);
  assert.match(investor, /alt="3D cover of Apartment Confidential, a black hardcover by John Dessauer"/);
  assert.equal(investor.includes('apartment-confidential-cover.jpg'), false);
  const publicBook = read('apartment-confidential.html');
  assert.match(publicBook, /src="\/assets\/apartment-confidential-cover\.jpg"/);
  assert.match(publicBook, /href="\/assets\/apartment-confidential\.pdf"/);

  const rookie = read('unlocks/rookie.html');
  assert.match(rookie, /You've unlocked Real Estate H2O/);
  assert.match(rookie, /src="\/assets\/real-estate-h2o-cover\.jpg"/);
  assert.match(rookie, /alt="Cover of Real Estate H2O by John Dessauer: a marina and glass towers under the title Real Estate H2O"/);
  assert.equal(rookie.includes('cover-placeholder'), false);
  assert.match(rookie, /data-level="rookie"/);
  assert.match(rookie, /Placeholder copy\. John has to approve this wording\./);
  assert.match(rookie, /id="ira-bonus"/);
  assert.equal(rookie.includes('coaching-book-btn'), false);

  const edge = read('netlify/edge-functions/member-page.js');
  assert.match(edge, /'\/unlocks\/rookie'/);
  assert.match(edge, /'\/unlocks\/investor\.html'/);
  assert.match(read('netlify.toml'), /\/api\/book-download/);
  assert.match(read('package.json'), /@netlify\/blobs/);
});

test('a non-member never reaches the blob store or the coaching link', async () => {
  let storeCalls = 0;
  const handler = download.createHandler({
    enforceMembership: async () => ({ response: { statusCode: 401, body: JSON.stringify({ error: 'Authentication failed' }) } }),
    loadBadges: async () => { throw new Error('should not load badges'); },
    getStore: () => { storeCalls += 1; throw new Error('should not open the store'); },
  });
  const res = await handler(event('apartment-confidential', 'coaching'));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.includes(COACHING_URL), false);
  assert.equal(storeCalls, 0);
});
