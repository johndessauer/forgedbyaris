const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const unlocks = require('../assets/js/level-unlocks');

const ROOT = path.join(__dirname, '..');

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

function memoryStorage() {
  const data = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
  };
}

function fakeContainer() {
  return {
    ownerDocument: null,
    innerHTML: '',
    hidden: true,
    removeAttribute(name) { if (name === 'hidden') this.hidden = false; },
    setAttribute(name) { if (name === 'hidden') this.hidden = true; },
    querySelectorAll() { return []; },
  };
}

function levelLists(html) {
  const lists = html.match(/<ul class="level-card__unlocks">[\s\S]*?<\/ul>/g);
  assert.ok(lists && lists.length === 3, 'why-forge.html should have Rookie, Investor, and Mogul unlock lists');
  return lists;
}

function findUnlock(id) {
  const unlock = unlocks.UNLOCKS.find((item) => item.id === id);
  assert.ok(unlock, id);
  return unlock;
}

test('Directed IRA is the first Rookie unlock and stays optional', () => {
  const rookie = unlocks.UNLOCKS.filter((item) => item.level === 'rookie');
  assert.deepEqual(rookie.map((item) => item.id), ['directed-ira-consult', 'real-estate-h2o']);
  const ira = rookie[0];
  assert.equal(ira.optional, true);
  assert.equal(ira.blocksProgress, false);
  assert.equal(ira.href, 'https://directedira32a69.referralrock.com/l/JOHNDESSAU79/');
  assert.equal(ira.disclosure, 'Directed IRA is an independent company. FORGE may receive a referral fee.');
  assert.equal(ira.dismiss, 'Not now');
  assert.equal(ira.body, 'Book a free consultation about using a self-directed IRA, 401(k), or Solo 401(k) to invest in real estate. This does not change your lessons or your level.');

  const html = unlocks.cardMarkup(ira);
  assert.match(html, /href="https:\/\/directedira32a69\.referralrock\.com\/l\/JOHNDESSAU79\/"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/);
  assert.match(html, /data-dismiss-unlock="directed-ira-consult"/);
  assert.match(html, />Not now</);
  assert.doesNotMatch(html, /rel="noopener noreferrer"/);
});

test('the consultation is hidden until Rookie and Not now does not change the badge', () => {
  const storage = memoryStorage();
  const badges = { rookie: true, investor: false, mogul: false };
  assert.equal(unlocks.markupFor({ rookie: false }, storage), '');
  const shown = unlocks.markupFor(badges, storage);
  assert.match(shown, /data-unlock-id="directed-ira-consult"/);
  assert.match(shown, /data-unlock-id="real-estate-h2o"/);
  assert.doesNotMatch(shown, /apartment-confidential/);

  unlocks.dismiss('directed-ira-consult', storage);
  const after = unlocks.markupFor(badges, storage);
  assert.doesNotMatch(after, /directed-ira-consult/);
  assert.match(after, /data-unlock-id="real-estate-h2o"/);
  assert.deepEqual(badges, { rookie: true, investor: false, mogul: false });
  assert.deepEqual(unlocks.readDismissed(storage), ['directed-ira-consult']);
});

test('render writes the cards into the member page and hides the box when nothing is earned', () => {
  const empty = fakeContainer();
  unlocks.render(empty, {}, memoryStorage());
  assert.equal(empty.hidden, true);
  assert.equal(empty.innerHTML, '');

  const earned = fakeContainer();
  unlocks.render(earned, { rookie: true, investor: true }, memoryStorage());
  assert.equal(earned.hidden, false);
  const iraAt = earned.innerHTML.indexOf('data-unlock-id="directed-ira-consult"');
  const bookAt = earned.innerHTML.indexOf('data-unlock-id="real-estate-h2o"');
  const investorAt = earned.innerHTML.indexOf('data-unlock-id="apartment-confidential"');
  assert.ok(iraAt >= 0 && iraAt < bookAt && bookAt < investorAt);
});

test('book cards open the member unlock pages and do not use the public PDF', () => {
  const bookFiles = walk(ROOT, []).filter((file) => {
    return /h2o/i.test(path.basename(file)) && /\.(pdf|epub|docx|mobi)$/i.test(file);
  });
  assert.deepEqual(bookFiles, []);

  const h2o = findUnlock('real-estate-h2o');
  assert.equal(h2o.level, 'rookie');
  assert.equal(h2o.href, '/unlocks/rookie');
  assert.equal(h2o.external, false);
  const h2oHtml = unlocks.cardMarkup(h2o);
  assert.match(h2oHtml, /href="\/unlocks\/rookie"/);
  assert.match(h2oHtml, /src="\/assets\/real-estate-h2o-cover\.jpg"/);
  assert.match(h2oHtml, /alt="Cover of Real Estate H2O by John Dessauer: a marina and glass towers under the title Real Estate H2O"/);
  assert.doesNotMatch(h2oHtml, /target="_blank"/);
  assert.equal(h2oHtml.includes('apartment-confidential.pdf'), false);

  const book = findUnlock('apartment-confidential');
  assert.equal(book.level, 'investor');
  assert.equal(book.href, '/unlocks/investor');
  assert.equal(book.external, false);
  const html = unlocks.cardMarkup(book);
  assert.match(html, /href="\/unlocks\/investor"/);
  assert.match(html, /src="\/assets\/apartment-confidential-cover-3d\.jpg"/);
  assert.match(html, /alt="3D cover of Apartment Confidential, a black hardcover by John Dessauer"/);
  assert.equal(html.includes('/assets/apartment-confidential.pdf'), false);
  assert.equal(html.includes('apartment-confidential-cover.jpg'), false);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.equal(unlocks.markupFor({ rookie: true }, memoryStorage()).includes('apartment-confidential'), false);
  assert.match(unlocks.markupFor({ investor: true }, memoryStorage()), /data-unlock-id="apartment-confidential"/);

  const publicPage = read('apartment-confidential.html');
  assert.match(publicPage, /href="\/assets\/apartment-confidential\.pdf"/);
  assert.equal(fs.existsSync(path.join(ROOT, 'assets/apartment-confidential.pdf')), true);
});

test('why-forge maps Real Estate H2O to Rookie and Apartment Confidential to Investor', () => {
  const [rookie, investor, mogul] = levelLists(read('why-forge.html'));
  assert.match(rookie, /Real Estate H2O book/);
  assert.equal(rookie.includes('Apartment Confidential'), false);
  assert.match(investor, /Apartment Confidential book/);
  assert.equal(investor.includes('Real Estate H2O'), false);
  assert.equal(mogul.includes('Apartment Confidential'), false);
  assert.equal(mogul.includes('Real Estate H2O'), false);
  assert.match(investor, /Vetted investment opportunities/);
  assert.match(mogul, /1-on-1 call with the FORGE Founder/);
});

test('unlock copy stays neutral and the cards do not gate lessons', () => {
  const banned = /guarantee|tax advice|legal advice|investment advice|\breturns\b|you should|must book|required to/i;
  for (const unlock of unlocks.UNLOCKS) {
    assert.equal(unlock.blocksProgress, false, unlock.id);
    const copy = [unlock.eyebrow, unlock.title, unlock.body, unlock.disclosure, unlock.cta, unlock.dismiss].join(' ');
    assert.doesNotMatch(copy, banned, unlock.id);
  }

  const educationApi = read('netlify/functions/education-data.js');
  assert.match(educationApi, /Score \$\{PASS_THRESHOLD_LABEL\[prior\]\} on the \$\{prior\} quiz first to unlock/);
  assert.equal(educationApi.includes('directedira'), false);
  assert.equal(educationApi.includes('level-unlocks'), false);
  assert.equal(educationApi.includes('apartment-confidential'), false);

  const educationPage = read('education.html');
  assert.match(educationPage, /The 18-lesson Apartment Confidential path is part of FORGE Empire/);
  assert.match(read('netlify/functions/_Lib/empire-lessons.js'), /Apartment Confidential/);
});

test('member pages mount the cards after the badge fetch, and public pages do not', () => {
  for (const page of ['education.html', 'dashboard.html']) {
    const html = read(page);
    assert.match(html, /<script src="\/assets\/js\/level-unlocks\.js"><\/script>/);
    assert.match(html, /<div id="level-unlocks"/);
    assert.match(html, /ForgeLevelUnlocks\.render\(document\.getElementById\('level-unlocks'\), badges, localStorage\)/);
  }

  const education = read('education.html');
  const loadModules = education.slice(education.indexOf('async function loadModules'), education.indexOf('function renderIncomeFilterTabs'));
  assert.match(loadModules, /ForgeLevelUnlocks\.render/);
  assert.ok(education.indexOf('if (!hasActiveMembership)') < education.indexOf('await loadModules()'));

  const dashboard = read('dashboard.html');
  const loadBadges = dashboard.slice(dashboard.indexOf('async function loadEducationBadges'), dashboard.indexOf('function escapeHtml'));
  assert.match(loadBadges, /ForgeLevelUnlocks\.render/);
  assert.ok(dashboard.indexOf('if (!hasActiveMembership)') < dashboard.indexOf('loadEducationBadges()'));

  const edge = read('netlify/edge-functions/member-page.js');
  assert.match(edge, /'\/education\.html'/);
  assert.match(edge, /'\/dashboard\.html'/);

  const pages = walk(ROOT, []).filter((file) => file.endsWith('.html'));
  for (const file of pages) {
    const rel = path.relative(ROOT, file);
    const html = fs.readFileSync(file, 'utf8');
    const memberCard = rel === 'education.html' || rel === 'dashboard.html' || rel === path.join('unlocks', 'rookie.html');
    if (memberCard) continue;
    assert.equal(html.includes('level-unlocks.js'), false, rel);
    assert.equal(html.includes('directedira32a69'), false, rel);
  }
});
