// Load 25 More uses PropertyRadar's Start offset and must not purchase
// the same page twice. Clear Search drops filters, rows, and any in-flight page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const P = require('../assets/js/property-search-paging');

function rows(startId, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const n = startId + i;
    out.push({ id: n, address: n + ' Main St', lat: 41.4, lng: -87.3, playIds: ['prefore'], owner: 'Owner ' + n });
  }
  return out;
}

test('load more appends the next Start window and skips ids already shown', () => {
  const s = P.createState();
  const first = P.beginNewSearch(s, '46307', ['prefore']);
  assert.equal(first.ok, true);
  assert.equal(first.start, 0);
  const page = P.applyPage(s, first.generation, rows(1, 25), 40);
  assert.equal(page.appended.length, 25);
  assert.equal(P.hasMore(s), true);
  assert.equal(s.start, 25);

  const more = P.beginLoadMore(s);
  assert.equal(more.ok, true);
  assert.equal(more.start, 25);
  assert.equal(P.searchQuery(s, more.start), '/api/property-search?action=search&location=46307&plays=prefore&start=25');
  // Records 24 and 25 repeat the tail of page 1. They must not be appended,
  // and the offset still moves past the whole returned window.
  const next = P.applyPage(s, more.generation, rows(24, 15), 40);
  assert.deepEqual(next.appended.map(r => r.id), [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]);
  assert.equal(s.ids.length, 38);
  assert.equal(s.start, 40);
  assert.equal(P.hasMore(s), false);
});

test('a second load-more click while a page is in flight does not start another purchase', () => {
  const s = P.createState();
  const first = P.beginNewSearch(s, '46307', ['prefore']);
  P.applyPage(s, first.generation, rows(1, 25), 80);
  const a = P.beginLoadMore(s);
  const b = P.beginLoadMore(s);
  assert.equal(a.ok, true);
  assert.equal(a.start, 25);
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'in-flight');
  assert.equal(s.start, 25);
  assert.equal(s.loading, true);
  P.applyPage(s, a.generation, rows(26, 25), 80);
  assert.equal(s.loading, false);
  assert.equal(s.start, 50);
  assert.equal(P.hasMore(s), true);
});

test('a repeated Search click does not fire a second first page', () => {
  const s = P.createState();
  const a = P.beginNewSearch(s, '46307', ['prefore']);
  const b = P.beginNewSearch(s, '46307', ['prefore']);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'in-flight');
  assert.equal(s.generation, a.generation);
  P.applyPage(s, a.generation, rows(1, 25), 40);
  assert.equal(s.ids.length, 25);
});

test('an empty page or a page of only duplicates hides Load 25 More', () => {
  const s = P.createState();
  const first = P.beginNewSearch(s, '46307', ['prefore']);
  P.applyPage(s, first.generation, rows(1, 25), 100);

  const dup = P.beginLoadMore(s);
  const dupPage = P.applyPage(s, dup.generation, rows(1, 25), 100);
  assert.equal(dupPage.appended.length, 0);
  assert.equal(P.hasMore(s), false);
  assert.equal(s.total, 100);
  const blocked = P.beginLoadMore(s);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'no-more');
  assert.equal(s.loading, false);

  const fresh = P.createState();
  const open = P.beginNewSearch(fresh, '46307', ['prefore']);
  P.applyPage(fresh, open.generation, rows(1, 25), 100);
  const more = P.beginLoadMore(fresh);
  P.applyPage(fresh, more.generation, [], 100);
  assert.equal(P.hasMore(fresh), false);
  assert.equal(fresh.total, 25);
  assert.equal(P.beginLoadMore(fresh).reason, 'no-more');
});

test('Clear Search resets filters and drops a page that comes back later', () => {
  const s = P.createState();
  const first = P.beginNewSearch(s, 'Crown Point, IN', ['prefore', 'vacant']);
  P.applyPage(s, first.generation, rows(1, 25), 60);
  const more = P.beginLoadMore(s);
  assert.equal(P.searchQuery(s, 0), '/api/property-search?action=search&location=Crown%20Point%2C%20IN&plays=prefore,vacant&start=0');
  P.clearState(s);
  assert.equal(s.location, '');
  assert.deepEqual(s.plays, []);
  assert.equal(s.start, 0);
  assert.equal(s.total, 0);
  assert.deepEqual(s.ids, []);
  assert.equal(s.loading, false);
  assert.equal(P.hasMore(s), false);
  const late = P.applyPage(s, more.generation, rows(26, 25), 60);
  assert.equal(late.stale, true);
  assert.deepEqual(s.ids, []);
  const failed = P.failPage(s, more.generation);
  assert.equal(failed.stale, true);
});

function loadPropertySearch() {
  const stubs = {
    [path.join(__dirname, '../netlify/functions/_Lib/verify-member.js')]: { verifyMember: async () => 'mem_1', AuthError: class extends Error {} },
    [path.join(__dirname, '../netlify/functions/_Lib/membership.js')]: {
      enforceMembership: async () => ({ access: { memberId: 'mem_1', active: true, empire: true, comps: true } }),
    },
    [path.join(__dirname, '../netlify/functions/_Lib/supabase-client.js')]: { supabase: {} },
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

function searchEvent(start) {
  return {
    httpMethod: 'GET',
    headers: { authorization: 'Bearer t' },
    queryStringParameters: { action: 'search', location: '46307', plays: 'prefore', start: String(start) },
  };
}

test('PropertyRadar Search sends Start and Limit 25, and demo pages do not repeat', async () => {
  const ps = loadPropertySearch();
  const realFetch = global.fetch;
  const seen = [];
  process.env.PROPERTYRADAR_API_KEY = 'test-pr-key';
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), body: opts && opts.body, method: opts && opts.method });
    const start = new URL(String(url)).searchParams.get('Start');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        totalResultCount: 40,
        results: [{ RadarID: 'R' + start, Address: '1 Main', City: 'Crown Point', State: 'IN', ZipFive: '46307', Latitude: 41.4, Longitude: -87.3 }],
      }),
    };
  };
  try {
    const first = await ps.handler(searchEvent(0));
    const second = await ps.handler(searchEvent(25));
    const negative = await ps.handler(searchEvent(-4));
    assert.equal(seen.length, 3);
    seen.forEach((call, i) => {
      const u = new URL(call.url);
      assert.equal(u.origin + u.pathname, 'https://api.propertyradar.com/v1/properties');
      assert.equal(u.searchParams.get('Purchase'), '1');
      assert.equal(u.searchParams.get('Limit'), '25');
      assert.equal(call.method, 'POST');
      const body = JSON.parse(call.body);
      assert.equal(body.Purchase, undefined);
      assert.equal(body.Start, undefined);
      assert.ok(Array.isArray(body.Criteria));
      assert.equal(u.searchParams.get('Start'), ['0', '25', '0'][i]);
    });
    const page = JSON.parse(second.body);
    assert.equal(page.demo, false);
    assert.equal(page.total, 40);
    assert.equal(page.results[0].id, 'R25');
    assert.equal(JSON.parse(negative.body).results[0].id, 'R0');
  } finally {
    global.fetch = realFetch;
    delete process.env.PROPERTYRADAR_API_KEY;
  }

  const demo = loadPropertySearch();
  global.fetch = async () => { throw new Error('demo mode must not call PropertyRadar'); };
  try {
    const page1 = JSON.parse((await demo.handler(searchEvent(0))).body);
    const page2 = JSON.parse((await demo.handler(searchEvent(25))).body);
    assert.equal(page1.demo, true);
    assert.ok(page1.results.length > 0);
    assert.ok(page1.results.length <= 25);
    assert.equal(page1.results.length, Math.min(25, page1.total));
    assert.equal(page2.demo, true);
    assert.equal(page2.results.length, 0);
    assert.equal(page2.total, page1.total);
    const ids = new Set(page1.results.map(r => r.id));
    assert.equal(ids.size, page1.results.length);
  } finally {
    global.fetch = realFetch;
  }

  process.env.PROPERTYRADAR_API_KEY = 'test-pr-key';
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'nope' });
  const logged = console.error;
  console.error = () => {};
  try {
    const live = loadPropertySearch();
    const fallback = JSON.parse((await live.handler(searchEvent(25))).body);
    assert.equal(fallback.demo, true);
    assert.equal(fallback.results.length, 0);
    assert.ok(fallback.total > 0);
  } finally {
    console.error = logged;
    global.fetch = realFetch;
    delete process.env.PROPERTYRADAR_API_KEY;
  }
});

function pageScript() {
  const html = fs.readFileSync(path.join(__dirname, '../property-search.html'), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1] || '')) continue;
    if (m[2].includes('function loadMoreResults')) return m[2];
  }
  throw new Error('property search script not found');
}

function bootPage() {
  const dom = createDom();
  const calls = [];
  let hold = null;
  const mapApi = {
    view: null,
    fitted: false,
    removeLayer() {},
    setView(latlng, zoom) { this.view = { latlng: latlng.slice(), zoom }; return this; },
    fitBounds() { this.fitted = true; return this; },
  };
  const L = {
    map() { return mapApi; },
    tileLayer() { return { addTo() {} }; },
    divIcon() { return {}; },
    marker() {
      const marker = { addTo() { return marker; }, bindPopup() { return marker; }, on() { return marker; } };
      return marker;
    },
  };
  const sandbox = {
    window: { ForgePropertySearchPaging: P },
    document: {
      getElementById: dom.getElementById,
      querySelectorAll() { return []; },
    },
    L,
    alert() {},
    console,
    fetch: async (url) => {
      calls.push(String(url));
      if (hold) await hold;
      const start = Number(new URL(String(url), 'https://preview.example').searchParams.get('start'));
      const batch = start === 0 ? rows(1, 25) : rows(24, 15);
      return { json: async () => ({ results: batch, total: 40, demo: false }) };
    },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(pageScript(), sandbox, { filename: 'property-search.html' });
  sandbox.initMap();
  dom.getElementById('ps-location-input').value = '46307';
  return {
    sandbox,
    calls,
    dom,
    mapApi,
    holdNext() {
      let release;
      hold = new Promise(resolve => { release = resolve; });
      return () => { hold = null; release(); };
    },
  };
}

function createDom() {
  const elements = {};
  function make(id) {
    const node = {
      id,
      value: '',
      textContent: '',
      style: {},
      disabled: false,
      focused: false,
      _html: '',
      _owned: [],
      classList: { add() {}, remove() {} },
      focus() { node.focused = true; },
      insertAdjacentHTML(_pos, html) { node._html += html; },
    };
    Object.defineProperty(node, 'innerHTML', {
      configurable: true,
      get() { return node._html; },
      set(html) {
        node._html = String(html);
        node._owned.forEach(ownedId => { delete elements[ownedId]; });
        node._owned = [];
        const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
        let match;
        while ((match = re.exec(node._html))) {
          const idMatch = /id="([^"]+)"/.exec(match[1]);
          if (!idMatch) continue;
          const button = make(idMatch[1]);
          button.textContent = match[2];
          button.disabled = /\bdisabled\b/.test(match[1]);
          elements[idMatch[1]] = button;
          node._owned.push(idMatch[1]);
        }
      },
    });
    elements[id] = node;
    return node;
  }
  function getElementById(id) {
    if (!elements[id]) make(id);
    return elements[id];
  }
  return { elements, getElementById };
}

test('the page appends the next 25, ignores a second click, and Clear Search empties the view', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../property-search.html'), 'utf8');
  assert.match(html, /property-search-paging\.js/);
  assert.match(html, />Clear Search</);
  assert.match(html, /Pick a lead type and location, then hit Search\./);
  assert.match(html, /beginLoadMore\(searchState\)/);
  assert.match(html, /clearState\(searchState\)/);
  assert.equal(P.PAGE_SIZE, 25);

  const page = bootPage();
  const releaseSearch = page.holdNext();
  const firstSearch = page.sandbox.runPropertySearch();
  const repeatSearch = page.sandbox.runPropertySearch();
  assert.equal(page.calls.length, 1);
  releaseSearch();
  await firstSearch;
  await repeatSearch;
  assert.equal(page.calls.length, 1);
  assert.match(page.calls[0], /start=0/);
  assert.match(page.calls[0], /location=46307/);
  assert.match(page.dom.elements['ps-load-more-wrap'].innerHTML, /Load 25 More \(25 of 40\)/);

  const release = page.holdNext();
  const firstClick = page.sandbox.loadMoreResults();
  const secondClick = page.sandbox.loadMoreResults();
  assert.equal(page.calls.length, 2);
  assert.match(page.calls[1], /start=25/);
  assert.equal(page.dom.elements['ps-load-more-btn'].disabled, true);
  assert.equal(page.dom.elements['ps-load-more-btn'].textContent, 'Loading...');
  release();
  await firstClick;
  await secondClick;
  assert.equal(page.calls.length, 2);

  const ids = [...page.dom.elements['ps-grid'].innerHTML.matchAll(/id="ps-card-([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, 38);
  assert.equal(new Set(ids).size, 38);
  assert.equal(page.dom.elements['ps-load-more-wrap'].innerHTML, '');
  assert.equal(page.dom.elements['ps-results-count'].textContent, 'Showing 38 of 40');

  page.sandbox.clearSearch();
  assert.equal(page.dom.elements['ps-location-input'].value, '');
  assert.match(page.dom.elements['ps-grid'].innerHTML, /Pick a lead type and location, then hit Search\./);
  assert.equal(page.dom.elements['ps-load-more-wrap'].innerHTML, '');
  assert.equal(page.dom.elements['ps-results-count'].textContent, '—');
  assert.equal(page.dom.elements['ps-map-badge'].textContent, 'Search results');
  assert.equal(page.dom.elements['ps-demo-banner'].style.display, 'none');
  assert.equal(page.dom.elements['ps-location-input'].focused, true);
  assert.equal(Number(page.mapApi.view.latlng[0]), 41.4189);
  assert.equal(Number(page.mapApi.view.latlng[1]), -87.3653);
  assert.equal(page.mapApi.view.zoom, 12);
  assert.equal(page.calls.length, 2);
});

test('a Load 25 More response that arrives after Clear Search does not refill the list', async () => {
  const page = bootPage();
  await page.sandbox.runPropertySearch();
  const release = page.holdNext();
  const pending = page.sandbox.loadMoreResults();
  page.sandbox.clearSearch();
  release();
  await pending;
  assert.equal(page.calls.length, 2);
  assert.match(page.dom.elements['ps-grid'].innerHTML, /Pick a lead type and location, then hit Search\./);
  assert.equal(page.dom.elements['ps-grid'].innerHTML.includes('ps-card-'), false);
  assert.equal(page.dom.elements['ps-load-more-wrap'].innerHTML, '');
});
