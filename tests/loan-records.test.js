// Loan and lien facts ride on the existing property export. Document images
// stay off unless the flag and a price are set, and tests never call a
// paid endpoint without a mock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const loanRecords = require('../netlify/functions/_Lib/loan-records');
const vendor = require('../netlify/functions/_Lib/loan-docs-vendor');
const storeLib = require('../netlify/functions/_Lib/loan-docs-store');
const { createHandler } = require('../netlify/functions/_Lib/loan-docs-http');
const ui = require('../assets/js/loan-records');
const spend = require('../netlify/functions/_Lib/property-search-spend');

const RADAR = 'P8A0E18D';
const DOC = 'd654159205';
const PDF = 'data:application/pdf;base64,JVBERi0=';

function loadPropertySearch(supabase) {
  const stubs = {
    [path.join(__dirname, '../netlify/functions/_Lib/verify-member.js')]: { verifyMember: async () => 'mem_1', AuthError: class extends Error {} },
    [path.join(__dirname, '../netlify/functions/_Lib/membership.js')]: {
      enforceMembership: async () => ({ access: { memberId: 'mem_1', active: true, empire: true, comps: true } }),
    },
    [path.join(__dirname, '../netlify/functions/_Lib/supabase-client.js')]: { supabase: supabase || {} },
  };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (stubs[resolved]) return stubs[resolved];
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../netlify/functions/property-search')];
    return require('../netlify/functions/property-search');
  } finally {
    Module._load = orig;
  }
}

function searchEvent() {
  return {
    httpMethod: 'GET',
    headers: { authorization: 'Bearer t' },
    queryStringParameters: { action: 'search', location: '46307', plays: 'prefore', start: '0' },
  };
}

function radarRow() {
  return {
    RadarID: RADAR,
    Address: '1930 SILVER CREEK CT',
    City: 'Crown Point',
    State: 'IN',
    ZipFive: '46307',
    Latitude: 41.4,
    Longitude: -87.3,
    NumberLoans: 1,
    TotalLoanBalance: '$186,000',
    FirstLenderOriginal: 'First National',
    FirstAmount: 200000,
    FirstDate: '20040315',
    FirstRate: '6.5%',
    FirstLoanType: 'Conventional',
    FirstTermInYears: 30,
    CLTV: 0.62,
    PropertyHasOpenLiens: 0,
    isFreeAndClear: 1,
    RecorderSearchURL: 'https://county.example/records?apn=1',
    Transactions: [{ DocumentID: 'should-not-stick' }],
  };
}

test('loan fields are added to the existing export and Transactions is not', async () => {
  const ps = loadPropertySearch();
  for (const name of loanRecords.LOAN_EXPORT_FIELDS) {
    assert.ok(ps.PROPERTYRADAR_FIELDS.includes(name), name);
  }
  assert.equal(ps.PROPERTYRADAR_FIELDS.includes('Transactions'), false);
  assert.equal(loanRecords.LOAN_EXPORT_FIELDS.includes('Transactions'), false);

  const mapped = ps.mapRadarRecord(radarRow(), 0, ['prefore']);
  assert.equal(mapped.details.sample, false);
  assert.equal(mapped.details.loans.numberLoans, 1);
  assert.equal(mapped.details.loans.totalLoanBalance, 186000);
  assert.equal(mapped.details.loans.lender, 'First National');
  assert.equal(mapped.details.loans.originalAmount, 200000);
  assert.equal(mapped.details.loans.date, '20040315');
  assert.equal(mapped.details.loans.rate, 6.5);
  assert.equal(mapped.details.loans.type, 'Conventional');
  assert.equal(mapped.details.loans.termYears, 30);
  assert.equal(mapped.details.loans.cltv, 0.62);
  assert.equal(mapped.details.loans.openLiens, false);
  assert.equal(mapped.details.loans.freeAndClear, true);
  assert.equal(mapped.details.loans.recorderUrl, 'https://county.example/records?apn=1');
  assert.equal(mapped.details.loans.Transactions, undefined);
  assert.equal(JSON.stringify(mapped).toLowerCase().includes('propertyradar'), false);

  const hidden = ps.mapRadarRecord({
    RadarID: RADAR,
    Address: '1 Main',
    FirstLenderOriginal: 'PropertyRadar Lending',
    RecorderSearchURL: 'https://www.propertyradar.com/county',
  }, 0, ['prefore']);
  assert.equal(hidden.details.loans.lender, null);
  assert.equal(hidden.details.loans.recorderUrl, null);
  assert.equal(loanRecords.safeRecorderUrl('javascript:alert(1)'), null);

  const seen = [];
  const recorded = [];
  const origRecord = spend.record;
  spend.record = async function (store, memberId, count, now) {
    recorded.push(count);
    return origRecord(store, memberId, count, now);
  };
  const realFetch = global.fetch;
  process.env.PROPERTYRADAR_API_KEY = 'test-pr-key';
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), method: opts && opts.method, body: opts && opts.body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ totalResultCount: 1, results: [radarRow()] }),
    };
  };
  try {
    const res = await ps.handler(searchEvent());
    const page = JSON.parse(res.body);
    assert.equal(seen.length, 1);
    const u = new URL(seen[0].url);
    assert.equal(u.origin + u.pathname, 'https://api.propertyradar.com/v1/properties');
    assert.equal(u.searchParams.get('Purchase'), '1');
    assert.equal(seen[0].method, 'POST');
    const fields = u.searchParams.get('Fields').split(',');
    for (const name of loanRecords.LOAN_EXPORT_FIELDS) assert.ok(fields.includes(name), name);
    assert.equal(fields.includes('Transactions'), false);
    assert.equal(seen[0].url.includes('/transactions'), false);
    assert.equal(seen[0].url.includes('/documents'), false);
    assert.deepEqual(recorded, [1]);
    assert.equal(page.demo, false);
    assert.equal(page.results[0].details.loans.lender, 'First National');
    assert.equal(JSON.stringify(page).toLowerCase().includes('propertyradar'), false);
  } finally {
    spend.record = origRecord;
    global.fetch = realFetch;
    delete process.env.PROPERTYRADAR_API_KEY;
  }
});

test('sample listings do not invent loan facts and do not call the export', async () => {
  const ps = loadPropertySearch();
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('sample search must not export'); };
  delete process.env.PROPERTYRADAR_API_KEY;
  try {
    const res = await ps.handler(searchEvent());
    const page = JSON.parse(res.body);
    assert.equal(page.demo, true);
    assert.ok(page.results.length > 0);
    page.results.forEach((row) => {
      assert.equal(row.details.sample, true);
      assert.equal(row.details.loans, null);
      assert.match(row.id, /^demo-/);
    });
  } finally {
    global.fetch = realFetch;
  }
});

test('saving a lead keeps loan facts on the existing details JSON', async () => {
  const inserted = [];
  const supabase = {
    from() {
      return {
        insert(row) {
          inserted.push(row);
          return { select() { return { single: async () => ({ data: { id: 'saved-1' }, error: null }) }; } };
        },
      };
    },
  };
  const ps = loadPropertySearch(supabase);
  const res = await ps.handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer t' },
    body: JSON.stringify({
      action: 'save',
      leadId: RADAR,
      address: '1930 SILVER CREEK CT',
      playIds: ['prefore'],
      details: {
        beds: 3,
        loans: {
          numberLoans: 1,
          lender: 'First National',
          originalAmount: 200000,
          recorderUrl: 'https://county.example/records',
          Transactions: [{ DocumentID: 'nope' }],
          vendorNote: 'PropertyRadar',
        },
        sample: false,
      },
    }),
  });
  assert.equal(res.statusCode, 201);
  assert.equal(inserted.length, 1);
  const loans = inserted[0].details.loans;
  assert.equal(loans.numberLoans, 1);
  assert.equal(loans.lender, 'First National');
  assert.equal(loans.originalAmount, 200000);
  assert.equal(loans.recorderUrl, 'https://county.example/records');
  assert.equal(loans.Transactions, undefined);
  assert.equal(loans.vendorNote, undefined);
  assert.equal(inserted[0].details.sample, false);
  assert.equal(JSON.stringify(inserted[0]).toLowerCase().includes('propertyradar'), false);
});

test('the command center shows loan facts, empty states, and the public-record note', () => {
  const html = ui.sectionHtml({
    id: RADAR,
    details: {
      sample: false,
      loans: {
        numberLoans: 1,
        totalLoanBalance: 186000,
        lender: 'First National',
        originalAmount: 200000,
        date: '20040315',
        rate: 6.5,
        type: 'Conventional',
        termYears: 30,
        cltv: 0.62,
        openLiens: false,
        freeAndClear: true,
        recorderUrl: 'https://county.example/records?apn=1',
      },
    },
  });
  assert.match(html, /Loan &amp; Lien Records/);
  assert.match(html, /Open loans/);
  assert.match(html, />1</);
  assert.match(html, /First National/);
  assert.match(html, /\$200,000\.00/);
  assert.match(html, /\$186,000\.00/);
  assert.match(html, /Mar 15, 2004/);
  assert.match(html, /6\.5%/);
  assert.match(html, /62%/);
  assert.match(html, /Conventional/);
  assert.match(html, /30 years/);
  assert.match(html, /Free and clear/);
  assert.match(html, /No open liens/);
  assert.match(html, /View county records/);
  assert.match(html, /href="https:\/\/county\.example\/records\?apn=1"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal(html.includes(ui.DISCLAIMER), true);
  assert.equal(html.toLowerCase().includes('propertyradar'), false);

  const sample = ui.sectionHtml({ id: 'demo-1', details: { sample: true, loans: null } });
  assert.match(sample, /Sample listing/);
  assert.equal(sample.includes('$200,000.00'), false);
  assert.equal(sample.includes(ui.DISCLAIMER), true);

  const older = ui.sectionHtml({ id: RADAR, details: { beds: 3 } });
  assert.match(older, /not included with this saved listing/);

  const empty = ui.sectionHtml({ id: RADAR, details: { loans: loanRecords.emptyLoans() } });
  assert.match(empty, /No recorded loan or lien details/);

  assert.equal(ui.formatDollars(186000), '$186,000.00');
  assert.equal(ui.formatPercent(0.065), '6.5%');
  assert.equal(ui.formatPercent(6.5), '6.5%');
  assert.equal(ui.formatDate('2004-03-15'), 'Mar 15, 2004');
  assert.equal(ui.safeUrl('javascript:alert(1)'), '');

  const command = fs.readFileSync(path.join(__dirname, '../assets/js/property-command.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../property-search.html'), 'utf8');
  const browser = fs.readFileSync(path.join(__dirname, '../assets/js/loan-records.js'), 'utf8');
  assert.match(command, /ForgeLoanRecords\.sectionHtml/);
  assert.match(command, /ForgeLoanRecords\.mount/);
  assert.equal(browser.toLowerCase().includes('propertyradar'), false);
  assert.equal(command.toLowerCase().includes('propertyradar'), false);
  const loanScript = page.indexOf('/assets/js/loan-records.js');
  const commandScript = page.indexOf('/assets/js/property-command.js');
  assert.ok(loanScript > 0 && loanScript < commandScript);
  const toml = fs.readFileSync(path.join(__dirname, '../netlify.toml'), 'utf8');
  assert.match(toml, /\/api\/loan-records/);
});

function post(body) {
  return { httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) };
}

function handlerFor(env, extras) {
  storeLib.resetMemory();
  const store = storeLib.memoryStore();
  const charges = [];
  const releases = [];
  const fetches = [];
  const fetchImpl = (extras && extras.fetch) || (async (url) => {
    fetches.push(String(url));
    throw new Error('unexpected export ' + url);
  });
  const handler = createHandler(Object.assign({
    env: env,
    store: store,
    fetch: async (url, init) => {
      fetches.push(String(url));
      return fetchImpl(url, init);
    },
    charge: async (info) => {
      charges.push(info);
      return { ok: true, chargedCents: info.cents };
    },
    release: async (info) => { releases.push(info); },
    enforceMembership: async () => ({
      access: { memberId: 'mem_1', active: true, empire: !(extras && extras.foundation), comps: true },
    }),
  }, extras && extras.override));
  return { handler, store, charges, releases, fetches };
}

const pricedEnv = {
  LOAN_DOCS_ENABLED: 'true',
  LOAN_DOC_MEMBER_PRICE_CENTS: '250',
  PROPERTYRADAR_API_KEY: 'test-pr-key',
};

function jsonOk(payload, status) {
  return {
    ok: status ? status < 400 : true,
    status: status || 200,
    json: async () => payload,
    headers: { get: () => 'application/pdf' },
    arrayBuffer: async () => Buffer.from('%PDF-1.4'),
  };
}

test('document images stay off and do not charge or export', async () => {
  const off = handlerFor({ LOAN_DOC_MEMBER_PRICE_CENTS: '250', PROPERTYRADAR_API_KEY: 'test-pr-key' });
  const status = JSON.parse((await off.handler(post({ action: 'status' }))).body);
  assert.equal(status.enabled, false);
  assert.equal(status.comingSoon, true);
  assert.equal(status.priceCents, null);
  const purchase = JSON.parse((await off.handler(post({
    action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC, priceCents: 1,
  }))).body);
  assert.equal(purchase.comingSoon, true);
  assert.equal(off.charges.length, 0);
  assert.equal(off.fetches.length, 0);

  const unpriced = handlerFor({ LOAN_DOCS_ENABLED: 'true', PROPERTYRADAR_API_KEY: 'test-pr-key' });
  const none = JSON.parse((await unpriced.handler(post({
    action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC,
  }))).body);
  assert.equal(none.priced, false);
  assert.equal(unpriced.charges.length, 0);
  assert.equal(unpriced.fetches.length, 0);

  const zero = handlerFor({ LOAN_DOCS_ENABLED: 'yes', LOAN_DOC_MEMBER_PRICE_CENTS: '0', PROPERTYRADAR_API_KEY: 'k' });
  const zeroBody = JSON.parse((await zero.handler(post({ action: 'status' }))).body);
  assert.equal(zeroBody.priced, false);
  assert.equal(zeroBody.priceCents, null);

  const foundation = handlerFor(pricedEnv, { foundation: true });
  const denied = await foundation.handler(post({ action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC }));
  assert.equal(denied.statusCode, 403);
  assert.equal(foundation.charges.length, 0);
  assert.equal(foundation.fetches.length, 0);
  const foundationStatus = JSON.parse((await foundation.handler(post({ action: 'status' }))).body);
  assert.equal(foundationStatus.empire, false);
  assert.equal(foundationStatus.priceCents, null);

  const badId = handlerFor(pricedEnv);
  const sample = await badId.handler(post({ action: 'purchase', confirm: true, radarId: 'demo-1', documentId: DOC }));
  assert.equal(sample.statusCode, 400);
  assert.equal(badId.fetches.length, 0);
  assert.equal(badId.charges.length, 0);
});

test('a document quote does not charge or export, and confirm uses the env price', async () => {
  const rig = handlerFor(pricedEnv, {
    fetch: async (url) => {
      const u = new URL(String(url));
      assert.equal(u.origin + u.pathname, 'https://api.propertyradar.com/v1/documents/' + DOC);
      assert.equal(u.searchParams.get('Purchase'), '1');
      assert.equal(u.searchParams.get('Fields').includes('DocImage'), true);
      assert.equal(u.searchParams.get('RadarID'), RADAR);
      return jsonOk({ results: [{ DocumentID: DOC, DocImage: PDF }] });
    },
  });
  const quote = JSON.parse((await rig.handler(post({
    action: 'purchase', radarId: RADAR, documentId: DOC, priceCents: 1,
  }))).body);
  assert.equal(quote.quote, true);
  assert.equal(quote.costCents, 250);
  assert.equal(quote.cached, false);
  assert.equal(rig.charges.length, 0);
  assert.equal(rig.fetches.length, 0);

  const bought = JSON.parse((await rig.handler(post({
    action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC, priceCents: 1,
  }))).body);
  assert.equal(bought.chargedCents, 250);
  assert.equal(bought.cached, false);
  assert.equal(bought.imageDataUrl, PDF);
  assert.equal(rig.charges.length, 1);
  assert.equal(rig.charges[0].cents, 250);
  assert.equal(rig.fetches.length, 1);
  assert.equal(JSON.stringify(bought).toLowerCase().includes('propertyradar'), false);

  const again = JSON.parse((await rig.handler(post({
    action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC,
  }))).body);
  assert.equal(again.cached, true);
  assert.equal(again.chargedCents, 0);
  assert.equal(again.imageDataUrl, PDF);
  assert.equal(rig.charges.length, 1);
  assert.equal(rig.fetches.length, 1);

  const other = createHandler({
    env: pricedEnv,
    store: rig.store,
    fetch: async () => { throw new Error('cached image must not export again'); },
    charge: async (info) => {
      rig.charges.push(info);
      return { ok: true };
    },
    enforceMembership: async () => ({ access: { memberId: 'mem_2', active: true, empire: true } }),
  });
  const secondMember = JSON.parse((await other(post({
    action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC,
  }))).body);
  assert.equal(secondMember.chargedCents, 250);
  assert.equal(secondMember.cached, false);
  assert.equal(secondMember.imageDataUrl, PDF);
  assert.equal(rig.charges.length, 2);
  assert.equal(rig.charges[1].cents, 250);
  assert.equal(rig.fetches.length, 1);
});

test('a failed document export releases the charge and does not keep a purchase', async () => {
  const rig = handlerFor(pricedEnv, {
    fetch: async () => ({ ok: false, status: 500, json: async () => ({ error: 'PropertyRadar down' }) }),
  });
  const res = await rig.handler(post({ action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 502);
  assert.match(body.error, /not charged/i);
  assert.equal(body.error.toLowerCase().includes('propertyradar'), false);
  assert.equal(rig.charges.length, 1);
  assert.equal(rig.releases.length, 1);
  assert.equal(await rig.store.get(storeLib.purchaseKey('mem_1', DOC)), null);
  assert.equal(rig.fetches.length, 1);
});

test('the document list previews before it exports, and a repeat list does not export again', async () => {
  const rig = handlerFor(pricedEnv, {
    fetch: async (url) => {
      const u = new URL(String(url));
      assert.match(u.pathname, /\/transactions$/);
      assert.equal(u.pathname.includes('/documents'), false);
      if (u.searchParams.get('Purchase') === '0') {
        return jsonOk({ totalResultCount: 0, results: [] });
      }
      throw new Error('zero preview must not purchase');
    },
  });
  const idle = JSON.parse((await rig.handler(post({ action: 'list', radarId: RADAR }))).body);
  assert.equal(idle.needsConfirm, true);
  assert.equal(idle.costCents, 0);
  assert.equal(rig.fetches.length, 0);
  assert.equal(rig.charges.length, 0);

  const empty = JSON.parse((await rig.handler(post({ action: 'list', confirm: true, radarId: RADAR }))).body);
  assert.deepEqual(empty.documents, []);
  assert.equal(rig.fetches.length, 1);
  assert.equal(rig.charges.length, 0);

  const listed = handlerFor(pricedEnv, {
    fetch: async (url) => {
      const purchase = new URL(String(url)).searchParams.get('Purchase');
      if (purchase === '0') return jsonOk({ totalResultCount: 2, results: [] });
      assert.equal(purchase, '1');
      assert.equal(new URL(String(url)).searchParams.get('Limit'), '2');
      return jsonOk({
        results: [
          { DocumentID: DOC, DocTypeUI: 'Loan', RecDate: '2019-03-02', Amount: 240000, LoanPosition: '1st', hasDocumentImage: 1, Purpose: 'PropertyRadar internal' },
          { DocumentID: 'd654159206', DocTypeUI: 'Lien', RecDate: '2020-01-01', Amount: 5000, hasDocumentImage: 0 },
        ],
      });
    },
  });
  const page = JSON.parse((await listed.handler(post({ action: 'list', confirm: true, radarId: RADAR }))).body);
  assert.equal(page.documents.length, 2);
  assert.equal(page.documents[0].type, 'Loan');
  assert.equal(page.documents[0].hasImage, true);
  assert.equal(page.documents[1].hasImage, false);
  assert.equal(page.priceCents, 250);
  assert.equal(JSON.stringify(page).toLowerCase().includes('propertyradar'), false);
  assert.equal(listed.charges.length, 0);
  assert.equal(listed.fetches.length, 2);
  const cached = JSON.parse((await listed.handler(post({ action: 'list', confirm: true, radarId: RADAR }))).body);
  assert.equal(cached.cached, true);
  assert.equal(cached.documents.length, 2);
  assert.equal(listed.fetches.length, 2);
});

test('a remote document image is stored without the upstream address', async () => {
  const rig = handlerFor(pricedEnv, {
    fetch: async (url, init) => {
      const text = String(url);
      if (text.includes('/documents/')) {
        return jsonOk({
          results: [{ DocumentID: DOC, DocImage: { url: 'https://files.propertyradar.com/img/doc.pdf' } }],
        });
      }
      assert.equal(text, 'https://files.propertyradar.com/img/doc.pdf');
      assert.equal(init.redirect, 'manual');
      return jsonOk(null);
    },
  });
  const bought = JSON.parse((await rig.handler(post({
    action: 'purchase', confirm: true, radarId: RADAR, documentId: DOC,
  }))).body);
  assert.equal(bought.chargedCents, 250);
  assert.match(bought.imageDataUrl, /^data:application\/pdf;base64,/);
  assert.equal(JSON.stringify(bought).toLowerCase().includes('propertyradar'), false);
  assert.equal(rig.fetches.length, 2);
});

test('loan record functions do not call createRequire(import.meta.url)', () => {
  const files = [
    '../netlify/functions/loan-records.js',
    '../netlify/functions/_Lib/loan-docs-http.js',
    '../netlify/functions/_Lib/loan-docs-vendor.js',
    '../netlify/functions/_Lib/loan-docs-store.js',
    '../netlify/functions/_Lib/loan-records.js',
  ];
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(source), false, file);
  });
});
