const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const whatsNew = require(path.join(ROOT, 'assets/js/whats-new.js'));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function memoryStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) { data[key] = String(value); },
    dump: function () { return data; },
  };
}

const VENDORS = /PropertyRadar|Tracerfy|RentCast|ElevenLabs|Anthropic|Claude|Supabase/i;

test('feed is dated, linked, and free of vendor names', () => {
  const items = JSON.parse(read('assets/whats-new.json'));
  assert.ok(items.length >= 5);
  const ids = new Set();
  for (const item of items) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.equal(ids.has(item.id), false);
    ids.add(item.id);
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item.title && item.description && item.link);
    assert.equal(VENDORS.test(JSON.stringify(item)), false);
  }
  const comps = items.find((item) => item.id === 'forge-cast-comps');
  assert.equal(comps.requires, 'empire');
  assert.match(comps.description, /estimate from recorded sales, not an appraisal/);
  assert.equal(items.some((item) => /skip trace|document image/i.test(item.title + item.description)), false);
  assert.equal(whatsNew.newestId(items), 'aris-member-memory');
});

test('dismissal is per member and follows the newest item id', () => {
  const items = JSON.parse(read('assets/whats-new.json'));
  const storage = memoryStorage();
  assert.equal(whatsNew.isDismissed(storage, 'mem_a', items), false);
  assert.equal(whatsNew.dismiss(storage, 'mem_a', items), 'aris-member-memory');
  assert.equal(storage.dump()[whatsNew.memberKey('mem_a')], 'aris-member-memory');
  assert.equal(whatsNew.isDismissed(storage, 'mem_a', items), true);
  assert.equal(whatsNew.isDismissed(storage, 'mem_b', items), false);

  const newer = [{ id: 'next-feature', date: '2026-12-01', title: 'Next', description: 'Later.', link: 'dashboard.html' }].concat(items);
  assert.equal(whatsNew.newestId(newer), 'next-feature');
  assert.equal(whatsNew.isDismissed(storage, 'mem_a', newer), false);
});

test('an empire-locked feature upgrades instead of linking', () => {
  const comps = {
    id: 'forge-cast-comps',
    date: '2026-10-29',
    title: 'FORGE Cast Comps',
    description: 'A FORGE ARV is an estimate from recorded sales, not an appraisal.',
    link: 'property-search.html',
    requires: 'empire',
  };
  const open = {
    id: 'aris-member-memory',
    date: '2026-11-25',
    title: 'ARIS Remembers Your Chats',
    description: 'Past chats stay on this account.',
    link: 'aris-coach.html',
  };
  const locked = whatsNew.markup([comps, open], { empire: false });
  assert.match(locked, /data-whats-new-id="forge-cast-comps"/);
  assert.match(locked, /class="whats-new-card is-locked"/);
  assert.match(locked, /Unlock Empire/);
  assert.match(locked, /Included with Empire and FORGE Zero/);
  assert.equal(locked.includes('href="property-search.html"'), false);
  assert.match(locked, /href="aris-coach.html"/);
  assert.match(locked, /estimate from recorded sales, not an appraisal/);

  const unlocked = whatsNew.markup([comps], { empire: true });
  assert.equal(unlocked.includes('is-locked'), false);
  assert.equal(unlocked.includes('Unlock Empire'), false);
  assert.match(unlocked, /href="property-search.html"/);
});

test('mount shows the panel, dismisses it for that member, and wires upgrade', () => {
  const items = JSON.parse(read('assets/whats-new.json'));
  const storage = memoryStorage();
  const clicks = [];
  const grid = {
    innerHTML: '',
    _forgeWhatsNewBound: false,
    addEventListener: function (type, fn) { this._fn = fn; },
  };
  const section = { hidden: true, style: { display: 'none' } };
  const sub = { textContent: '' };
  let dismissed = false;
  const button = {
    addEventListener: function (type, fn) { this._fn = fn; },
  };
  const first = whatsNew.mount({
    section: section,
    grid: grid,
    sub: sub,
    dismissButton: button,
    items: items,
    storage: storage,
    memberId: 'mem_foundation',
    empire: false,
    onUpgrade: function () { clicks.push('upgrade'); },
  });
  assert.equal(first.visible, true);
  assert.equal(section.hidden, false);
  assert.match(grid.innerHTML, /is-locked/);
  assert.match(grid.innerHTML, /href="aris-coach.html"/);
  assert.equal(grid.innerHTML.includes('href="property-search.html"'), true);
  assert.equal((grid.innerHTML.match(/href="property-search.html"/g) || []).length >= 1, true);
  const lockedSlice = grid.innerHTML.slice(grid.innerHTML.indexOf('forge-cast-comps'), grid.innerHTML.indexOf('forge-cast-comps') + 700);
  assert.equal(lockedSlice.includes('href='), false);
  grid._fn({ target: { closest: function () { return {}; } } });
  assert.deepEqual(clicks, ['upgrade']);
  button._fn();
  dismissed = section.hidden === true && storage.dump()[whatsNew.memberKey('mem_foundation')] === 'aris-member-memory';
  assert.equal(dismissed, true);
  const again = whatsNew.mount({
    section: { hidden: false, style: { display: '' } },
    grid: { innerHTML: '', addEventListener: function () {} },
    sub: { textContent: '' },
    dismissButton: { addEventListener: function () {} },
    items: items,
    storage: storage,
    memberId: 'mem_foundation',
    empire: false,
  });
  assert.equal(again.visible, false);
});

test('description and link aliases still render', () => {
  const html = whatsNew.cardHtml({
    id: 'legacy',
    date: '2026-11-01',
    title: 'Legacy',
    body: 'Older field name.',
    href: 'crm.html',
  }, { empire: true });
  assert.match(html, /Older field name/);
  assert.match(html, /href="crm\.html"/);
  assert.match(html, /Nov 1/);
});

test('dashboard mounts the feed, dismisses it, and stays usable on a phone', () => {
  const page = read('dashboard.html');
  const cssStart = page.indexOf('/* ── WHAT\'S NEW ── */');
  const css = page.slice(cssStart, page.indexOf('/* ── RECENT DEALS ── */'));
  assert.match(page, /\/assets\/js\/whats-new\.js/);
  assert.match(page, /id="whats-new-section"/);
  assert.match(page, /id="whats-new-dismiss"/);
  assert.match(page, /ForgeWhatsNew\.mount/);
  assert.match(page, /whatsNewMemberId/);
  assert.match(page, /whatsNewEmpire/);
  assert.match(css, /minmax\(240px, 1fr\)/);
  assert.match(page, /@media \(max-width: 768px\)[\s\S]*\.whats-new-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /whats-new-upgrade/);
  assert.doesNotMatch(page.slice(page.indexOf('id="whats-new-section"'), page.indexOf('id="whats-new-section"') + 900), /javascript:/);
});

test('public pages describe live capabilities and keep the comp disclaimer', () => {
  const index = read('index.html');
  const about = read('about-aris.html');
  const founding = read('founding-member.html');
  const sales = read('netlify/edge-functions/aris-stream.js');
  const salesPrompt = sales.slice(sales.indexOf('const ARIS_SYSTEM_SALES'), sales.indexOf('const COMPS_MEMBER_BLOCK'));
  for (const text of [index, about, founding, read('assets/whats-new.json')]) {
    assert.equal(VENDORS.test(text), false);
  }
  assert.match(index, /past chats, markets, deals, goals, and buy box/i);
  assert.match(index, /Past chats/);
  assert.match(index, /lease option, subject-to, and loan assumption/i);
  assert.match(index, /capital stack/i);
  assert.match(index, /Loan and lien records/i);
  assert.match(index, /FORGE Cast/);
  assert.match(index, /estimate from recorded sales, not an appraisal/);
  assert.equal(/skip-?trac/i.test(index), false);
  assert.match(about, /Past chats/);
  assert.match(founding, /past chats/i);
  assert.match(salesPrompt, /Property Search — live/);
  assert.equal(/Property Search \(coming soon\)/.test(salesPrompt), false);
  assert.equal(/skip-traced/i.test(salesPrompt), false);
  assert.match(salesPrompt, /estimate, not an appraisal/);
  assert.match(sales, /A FORGE ARV is an estimate, not an appraisal/);
});
