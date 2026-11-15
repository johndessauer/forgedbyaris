// Creative-finance videos on education.html.
// Residential lessons ship with a youtubeId and play for Foundation.
// Commercial lessons lock for Foundation. Their YouTube ids live in
// creative-finance-lessons.js and attach only when the plan includes Empire.
// A lesson with an id does not render Coming soon.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { CREATIVE_FINANCE_COMMERCIAL_VIDEOS } = require('../netlify/functions/_Lib/creative-finance-lessons');
const { creativeFinanceLessonPayload } = require('../netlify/functions/_Lib/membership');

const html = fs.readFileSync(path.join(__dirname, '..', 'education.html'), 'utf8');

const RESIDENTIAL_IDS = {
  'lease-option': ['ltfh6svNSL0', 'eakwtB2HPSA', '9qalING15IE', 's3pqRwLSL68', 'DMQxUACB7Mc', 'cx5u6O5BJhE'],
  'subject-to': ['5scJR3UPW-w', 'wsUBxL106OE', 'aDHO5DfHqCI', '1FORkSLEAko', '2hVuSK_cbZk', 'mvqGZfaLs20', '1ygXlGkp_MY', '1UV8UbccJE0', 'J1Z4eFZKZt8', 'KG_AAoZhuJg'],
  assumption: ['1ukqfafRcR0', 'w3qUZqdstb0', '1JcWrFzOD5c', 'UVQlVOncP0U', 'gZbjDoxeC-g', 'T5luxwbpOYc', '00b5x9Bf6ow'],
};
const COMMERCIAL_IDS = {
  'lease-option:7': 'od_uMZmmr3Q',
  'lease-option:8': 'JiVPxFBlLvM',
  'subject-to:11': 'F-m8Gigh90s',
  'assumption:8': 'S4Y8Xy9uIUo',
};

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not extract ${startMarker}`);
  return source.slice(start, end);
}

function bareDeal(text) {
  return String(text).replace(/real estate deals?/gi, '').match(/\bdeals?\b/i);
}

function loadPaths() {
  const elements = {};
  const clicks = [];
  const sandbox = {
    console,
    encodeURIComponent,
    modalCount: 0,
    clicks,
    elements,
    localStorage: {
      store: {},
      getItem(key) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null; },
      setItem(key, value) { this.store[key] = String(value); },
    },
    history: { replaceState() {} },
    window: {
      location: { hash: '' },
      addEventListener() {},
    },
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = { id, innerHTML: '', style: {}, scrollIntoView() {} };
        return elements[id];
      },
      addEventListener(type, fn) {
        if (type === 'click') clicks.push(fn);
      },
    },
  };
  const source = [
    'let membershipVerified = false;',
    'let hasEmpireAccess = false;',
    'function escapeHtml(str) {',
    '  return String(str == null ? "" : str)',
    '    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
    '}',
    'function coachingIframe(s) {',
    '  return \'<iframe src="https://www.youtube-nocookie.com/embed/\' + s.youtubeId + \'"></iframe>\';',
    '}',
    'function showEmpireLockModal() { globalThis.modalCount += 1; }',
    'function handleUnlockEmpireEducation() {}',
    'function switchEduSection() {}',
    extractBetween(html, 'const FORGE_LEASE_OPTION_LESSONS = ', 'function createLessonPath(cfg)'),
    extractBetween(html, 'function createLessonPath(cfg) {', 'const h2oPath = createLessonPath('),
    extractBetween(html, 'const leaseOptionPath = createLessonPath(', 'const PATH_LESSONS'),
    'function setHasEmpireAccess(value) { hasEmpireAccess = value; }',
    'function setMembershipVerified(value) { membershipVerified = value; }',
    'globalThis.api = {',
    '  leaseOptionPath, subjectToPath, assumptionPath, applyCreativeFinanceVideos,',
    '  FORGE_LEASE_OPTION_LESSONS, FORGE_SUBJECT_TO_LESSONS, FORGE_ASSUMPTION_LESSONS,',
    '  setHasEmpireAccess, setMembershipVerified,',
    '};',
  ].join('\n');
  vm.runInNewContext(source, sandbox, { filename: 'education.html creative finance' });
  sandbox.api.setMembershipVerified(true);
  return sandbox;
}

function flatLessons(modules) {
  return modules.flatMap((mod) => mod.lessons.map((lesson) => ({ ...lesson, moduleTitle: mod.title })));
}

function clickLocked(sandbox, sectionId) {
  const target = {
    dataset: { pathLocked: '1' },
    closest(sel) {
      if (sel === '#' + sectionId) return { id: sectionId };
      if (sel === '[data-path-locked]') return target;
      return null;
    },
  };
  for (const fn of sandbox.clicks) fn({ target });
}

test('creative finance copy follows the outline and does not say deals alone', () => {
  const sandbox = loadPaths();
  const api = sandbox.api;
  const paths = [
    ['lease-option', api.FORGE_LEASE_OPTION_LESSONS, [7, 8]],
    ['subject-to', api.FORGE_SUBJECT_TO_LESSONS, [11]],
    ['assumption', api.FORGE_ASSUMPTION_LESSONS, [8]],
  ];
  assert.equal(flatLessons(api.FORGE_LEASE_OPTION_LESSONS).length, 8);
  assert.equal(flatLessons(api.FORGE_SUBJECT_TO_LESSONS).length, 11);
  assert.equal(flatLessons(api.FORGE_ASSUMPTION_LESSONS).length, 8);

  const flagged = [];
  for (const [key, modules, commercial] of paths) {
    const lessons = flatLessons(modules);
    assert.deepEqual(
      [...lessons.filter((lesson) => !lesson.empire).map((lesson) => String(lesson.youtubeId))],
      RESIDENTIAL_IDS[key],
      key,
    );
    for (const lesson of lessons) {
      assert.equal(bareDeal(lesson.title), null, lesson.title);
      assert.equal(bareDeal(lesson.description), null, lesson.description);
      if (commercial.includes(lesson.n)) {
        assert.equal(lesson.youtubeId, undefined, key + ':' + lesson.n);
        assert.equal(lesson.empire, true, key + ':' + lesson.n);
        flagged.push(key + ':' + lesson.n);
      } else {
        assert.equal(lesson.youtubeId, RESIDENTIAL_IDS[key][lesson.n - 1], key + ':' + lesson.n);
        assert.equal(lesson.empire, undefined, key + ':' + lesson.n);
      }
    }
  }
  assert.deepEqual(flagged, [
    'lease-option:7', 'lease-option:8', 'subject-to:11', 'assumption:8',
  ]);
  assert.deepEqual(CREATIVE_FINANCE_COMMERCIAL_VIDEOS, COMMERCIAL_IDS);
  for (const id of Object.values(COMMERCIAL_IDS)) assert.equal(html.includes(id), false, id);

  const subjectText = flatLessons(api.FORGE_SUBJECT_TO_LESSONS).map((l) => l.title + ' ' + l.description).join('\n');
  assert.match(subjectText, /due-on-sale/);
  assert.match(subjectText, /Garn-St Germain Act of 1982/);
  assert.match(subjectText, /use of a trust/);
  assert.match(subjectText, /not a shield from due-on-sale/);

  const assumptionText = flatLessons(api.FORGE_ASSUMPTION_LESSONS).map((l) => l.title + ' ' + l.description).join('\n');
  assert.match(assumptionText, /VA loans are assumable/);

  const band = html.slice(html.indexOf('Creative Finance'), html.indexOf('More Video Lessons'));
  assert.equal((band.match(/Education only, not legal advice/g) || []).length, 3);
  assert.match(band, /due-on-sale clause, the Garn-St Germain Act of 1982, and the use of a trust/);
  assert.match(band, /VA loans are assumable/);
  assert.equal(bareDeal(band), null);
  assert.match(band, /real estate deals/);
});

test('foundation plays residential lessons and keeps commercial lessons locked', () => {
  const sandbox = loadPaths();
  const api = sandbox.api;
  api.leaseOptionPath.render();
  api.subjectToPath.render();
  api.assumptionPath.render();

  const lease = sandbox.elements['lease-option-path-container'].innerHTML;
  const subject = sandbox.elements['subject-to-path-container'].innerHTML;
  const assumption = sandbox.elements['assumption-path-container'].innerHTML;

  assert.equal((lease.match(/path-row locked/g) || []).length, 2);
  assert.equal((lease.match(/>Coming soon</g) || []).length, 0);
  assert.equal((subject.match(/>Coming soon</g) || []).length, 0);
  assert.equal((assumption.match(/>Coming soon</g) || []).length, 0);
  assert.deepEqual(RESIDENTIAL_IDS['lease-option'].filter((id) => lease.includes(id)), RESIDENTIAL_IDS['lease-option']);
  assert.deepEqual(RESIDENTIAL_IDS['subject-to'].filter((id) => subject.includes(id)), RESIDENTIAL_IDS['subject-to']);
  assert.deepEqual(RESIDENTIAL_IDS.assumption.filter((id) => assumption.includes(id)), RESIDENTIAL_IDS.assumption);
  for (const id of Object.values(COMMERCIAL_IDS)) {
    assert.equal(lease.includes(id) || subject.includes(id) || assumption.includes(id), false, id);
  }
  assert.match(lease, /0 of 6/);
  assert.match(lease, /data-path-locked="1"/);
  assert.match(lease, /Commercial lease options/);
  assert.match(lease, /Master lease options/);
  assert.equal(lease.includes('landlord consent'), false);
  assert.equal(lease.includes('<iframe'), false);
  assert.equal(lease.includes('youtube-nocookie'), false);
  assert.equal(lease.includes('path-soon-kicker'), false);

  assert.equal((subject.match(/path-row locked/g) || []).length, 1);
  assert.match(subject, /0 of 10/);
  assert.match(subject, /The due-on-sale clause/);
  assert.match(subject, /Garn-St Germain Act of 1982/);
  assert.match(subject, /not a shield from due-on-sale/);
  assert.match(subject, /Commercial debt/);
  assert.equal(subject.includes('five-unit-and-up'), false);

  assert.equal((assumption.match(/path-row locked/g) || []).length, 1);
  assert.match(assumption, /0 of 7/);
  assert.match(assumption, /Which loans can be assumed/);
  assert.match(assumption, /Agency, CMBS, and SBA assumptions/);
  assert.equal(assumption.includes('special servicer'), false);

  api.leaseOptionPath.open(1, false);
  const opened = sandbox.elements['lease-option-path-container'].innerHTML;
  const openedPlayer = opened.slice(opened.indexOf('path-player'), opened.indexOf('path-modules'));
  assert.match(openedPlayer, /embed\/ltfh6svNSL0/);
  assert.match(openedPlayer, /Separate the right to occupy/);
  assert.equal(openedPlayer.includes('path-soon-kicker'), false);
  assert.equal(openedPlayer.includes('Coming soon'), false);
  assert.match(openedPlayer, /Mark complete/);

  api.leaseOptionPath.open(7, false);
  assert.equal(sandbox.elements['lease-option-path-container'].innerHTML.includes('landlord consent'), false);

  api.subjectToPath.open(5, false);
  assert.match(sandbox.elements['subject-to-path-container'].innerHTML, /due-on-sale clause lets the lender/);
  api.subjectToPath.open(6, false);
  assert.match(sandbox.elements['subject-to-path-container'].innerHTML, /Garn-St Germain Act of 1982/);
  api.subjectToPath.open(7, false);
  assert.match(sandbox.elements['subject-to-path-container'].innerHTML, /use of a trust is not a shield/);
  api.subjectToPath.open(11, false);
  assert.equal(sandbox.elements['subject-to-path-container'].innerHTML.includes('five-unit-and-up'), false);

  api.assumptionPath.open(2, false);
  assert.match(sandbox.elements['assumption-path-container'].innerHTML, /VA loans are assumable with servicer credit approval/);
  api.assumptionPath.open(8, false);
  assert.equal(sandbox.elements['assumption-path-container'].innerHTML.includes('special servicer'), false);

  clickLocked(sandbox, 'view-lease-option-path');
  assert.equal(sandbox.modalCount, 1);
  const afterLockClick = sandbox.elements['lease-option-path-container'].innerHTML;
  assert.match(afterLockClick, /embed\/ltfh6svNSL0/);
  assert.equal(afterLockClick.includes('landlord consent'), false);
  assert.equal(afterLockClick.includes('od_uMZmmr3Q'), false);

  api.applyCreativeFinanceVideos(creativeFinanceLessonPayload({ empire: false }));
  api.applyCreativeFinanceVideos({
    paths: { 'lease-option': [{ n: 7, youtubeId: 'SECRET_LEASE_7' }], assumption: [{ n: 8, youtubeId: 'SECRET_ASSUMPTION_8' }] },
  });
  assert.equal(api.leaseOptionPath.lesson(7).youtubeId, undefined);
  assert.equal(api.assumptionPath.lesson(8).youtubeId, undefined);
  assert.equal(api.leaseOptionPath.lesson(1).youtubeId, 'ltfh6svNSL0');
  assert.equal(sandbox.elements['lease-option-path-container'].innerHTML.includes('SECRET_LEASE_7'), false);
});

test('empire plays commercial lessons once the server ids are merged', () => {
  const sandbox = loadPaths();
  const api = sandbox.api;
  api.setHasEmpireAccess(true);
  api.leaseOptionPath.render();
  api.subjectToPath.render();
  api.assumptionPath.render();

  const lease = sandbox.elements['lease-option-path-container'].innerHTML;
  const subject = sandbox.elements['subject-to-path-container'].innerHTML;
  const assumption = sandbox.elements['assumption-path-container'].innerHTML;
  assert.equal((lease.match(/path-row locked/g) || []).length, 0);
  assert.equal((subject.match(/path-row locked/g) || []).length, 0);
  assert.equal((assumption.match(/path-row locked/g) || []).length, 0);
  assert.equal((lease.match(/>Coming soon</g) || []).length, 2);
  assert.equal((subject.match(/>Coming soon</g) || []).length, 1);
  assert.equal((assumption.match(/>Coming soon</g) || []).length, 1);
  assert.match(lease, /ltfh6svNSL0/);
  assert.equal(lease.includes('od_uMZmmr3Q'), false);
  assert.match(lease, /0 of 8/);
  assert.match(subject, /0 of 11/);
  assert.match(assumption, /0 of 8/);
  assert.equal(lease.includes('data-path-locked'), false);

  api.leaseOptionPath.open(7, false);
  const commercialSoon = sandbox.elements['lease-option-path-container'].innerHTML;
  assert.match(commercialSoon, /path-soon-kicker">Coming soon/);
  assert.match(commercialSoon, /landlord consent/);
  assert.equal(commercialSoon.includes('<iframe'), false);

  api.assumptionPath.open(8, false);
  assert.match(sandbox.elements['assumption-path-container'].innerHTML, /special servicer/);
  assert.match(sandbox.elements['assumption-path-container'].innerHTML, /Coming soon/);

  api.applyCreativeFinanceVideos({
    paths: {
      'lease-option': [{ n: 7, youtubeId: 'SECRET_LEASE_7' }, { n: 1, youtubeId: 'SHOULD_NOT_ATTACH' }],
      assumption: [{ n: 8, youtubeId: 'SECRET_ASSUMPTION_8' }],
    },
  });
  assert.equal(api.leaseOptionPath.lesson(7).youtubeId, 'SECRET_LEASE_7');
  assert.equal(api.leaseOptionPath.lesson(1).youtubeId, 'ltfh6svNSL0');
  assert.equal(api.assumptionPath.lesson(8).youtubeId, 'SECRET_ASSUMPTION_8');

  api.leaseOptionPath.open(7, false);
  const playing = sandbox.elements['lease-option-path-container'].innerHTML;
  const player = playing.slice(playing.indexOf('path-player'), playing.indexOf('path-modules'));
  assert.match(player, /embed\/SECRET_LEASE_7/);
  assert.equal(player.includes('path-soon-kicker'), false);
  assert.match(player, /Mark complete/);

  api.applyCreativeFinanceVideos(creativeFinanceLessonPayload({ empire: true }));
  assert.equal(api.leaseOptionPath.lesson(7).youtubeId, 'od_uMZmmr3Q');
  assert.equal(api.leaseOptionPath.lesson(8).youtubeId, 'JiVPxFBlLvM');
  assert.equal(api.leaseOptionPath.lesson(1).youtubeId, 'ltfh6svNSL0');
  assert.equal(api.subjectToPath.lesson(11).youtubeId, 'F-m8Gigh90s');
  assert.equal(api.subjectToPath.lesson(1).youtubeId, '5scJR3UPW-w');
  assert.equal(api.assumptionPath.lesson(8).youtubeId, 'S4Y8Xy9uIUo');
  assert.equal(api.assumptionPath.lesson(1).youtubeId, '1ukqfafRcR0');
  api.leaseOptionPath.render();
  api.subjectToPath.render();
  api.assumptionPath.render();
  assert.equal((sandbox.elements['lease-option-path-container'].innerHTML.match(/>Coming soon</g) || []).length, 0);
  assert.equal((sandbox.elements['subject-to-path-container'].innerHTML.match(/>Coming soon</g) || []).length, 0);
  assert.equal((sandbox.elements['assumption-path-container'].innerHTML.match(/>Coming soon</g) || []).length, 0);
  const commercialPlayer = sandbox.elements['lease-option-path-container'].innerHTML;
  const commercialSlice = commercialPlayer.slice(commercialPlayer.indexOf('path-player'), commercialPlayer.indexOf('path-modules'));
  assert.match(commercialSlice, /embed\/od_uMZmmr3Q/);
  assert.equal(commercialSlice.includes('Coming soon'), false);
});

function loadModuleList() {
  const elements = {};
  const sandbox = {
    console,
    elements,
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = { id, innerHTML: '' };
        return elements[id];
      },
    },
  };
  const source = [
    'let hasEmpireAccess = false;',
    'let allModules = [];',
    'let currentIncomeFilter = "all";',
    'function escapeHtml(str) {',
    '  return String(str == null ? "" : str)',
    '    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
    '}',
    'function showEmpireLockModal() {}',
    'function openModule() {}',
    extractBetween(html, 'const EMPIRE_CATEGORIES = ', ';') + ';',
    extractBetween(html, 'const TIER_META = {', 'function renderTierBadges'),
    extractBetween(html, 'const NEW_LESSON_SLUGS = ', 'function showEmpireLockModal'),
    'function setState(next) {',
    '  if (Object.prototype.hasOwnProperty.call(next, "empire")) hasEmpireAccess = next.empire;',
    '  if (Object.prototype.hasOwnProperty.call(next, "modules")) allModules = next.modules;',
    '  if (Object.prototype.hasOwnProperty.call(next, "filter")) currentIncomeFilter = next.filter;',
    '}',
    'globalThis.api = { renderModuleList, topicHasProgress, setState };',
  ].join('\n');
  vm.runInNewContext(source, sandbox, { filename: 'education.html module list' });
  return sandbox;
}

test('new badge shows on untouched residential creative-finance topics only', () => {
  const sandbox = loadModuleList();
  const api = sandbox.api;
  const topics = [
    { id: 'lo', slug: 'lease-option-fundamentals', title: 'Lease Options', category: 'Lease Options', income_type: 'active', description: 'Two contracts.', progress: null },
    { id: 'st', slug: 'subject-to-fundamentals', title: 'Subject-To', category: 'Subject-To', income_type: 'active', description: 'The deed moves.', progress: {} },
    { id: 'la', slug: 'loan-assumption-fundamentals', title: 'Loan Assumption', category: 'Loan Assumption', income_type: 'passive', description: 'Who must approve.', progress: null },
    { id: 'wh', slug: 'wholesaling', title: 'Wholesaling', category: 'Wholesaling', income_type: 'active', description: 'Assign the contract.', progress: null },
  ];
  api.setState({ modules: topics, empire: false, filter: 'all' });
  api.renderModuleList();
  const list = sandbox.elements['module-list-container'].innerHTML;
  assert.equal((list.match(/class="coaching-pill module-card-new">New</g) || []).length, 3);
  assert.match(list, /Lease Options/);
  assert.match(list, /Not started/);
  const wholesaling = list.slice(list.indexOf('Wholesaling'));
  assert.equal(wholesaling.includes('module-card-new'), false);

  const attempted = topics.map((topic) => (
    topic.slug === 'lease-option-fundamentals'
      ? { ...topic, progress: { rookie: { passed: false, completed: true, quiz_score: 4, quiz_total: 12 } } }
      : topic
  ));
  api.setState({ modules: attempted });
  api.renderModuleList();
  const afterAttempt = sandbox.elements['module-list-container'].innerHTML;
  assert.equal((afterAttempt.match(/class="coaching-pill module-card-new">New</g) || []).length, 2);
  assert.equal(afterAttempt.includes('Lease Options</div>\n              <span class="coaching-pill module-card-new">New</span>'), false);

  const passed = topics.map((topic) => (
    topic.slug === 'subject-to-fundamentals'
      ? { ...topic, progress: { rookie: { passed: true, completed: true, quiz_score: 12, quiz_total: 12 } } }
      : topic.slug === 'loan-assumption-fundamentals'
        ? { ...topic, progress: { investor: { passed: false, quiz_score: 0, quiz_total: 12 } } }
        : topic
  ));
  api.setState({ modules: passed });
  api.renderModuleList();
  const afterProgress = sandbox.elements['module-list-container'].innerHTML;
  assert.equal((afterProgress.match(/class="coaching-pill module-card-new">New</g) || []).length, 1);
  assert.match(afterProgress, /Rookie passed/);
  assert.match(afterProgress, /lease-option-fundamentals|Lease Options/);
  const subjectCard = afterProgress.slice(afterProgress.indexOf('Subject-To'), afterProgress.indexOf('Loan Assumption'));
  assert.equal(subjectCard.includes('module-card-new'), false);

  api.setState({ filter: 'passive' });
  api.renderModuleList();
  const passive = sandbox.elements['module-list-container'].innerHTML;
  assert.match(passive, /Loan Assumption/);
  assert.equal(passive.includes('module-card-new'), false);
  assert.equal(passive.includes('Lease Options'), false);

  assert.equal(api.topicHasProgress(null), false);
  assert.equal(api.topicHasProgress({}), false);
  assert.equal(api.topicHasProgress({ rookie: null }), false);
  assert.equal(api.topicHasProgress({ rookie: { passed: true } }), true);
});
