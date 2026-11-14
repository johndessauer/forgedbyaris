// Creative-finance video shells on education.html.
// Residential lessons render as Coming soon. Commercial lessons lock for
// Foundation and stay Coming soon for Empire. Commercial YouTube ids are
// applied only when the plan includes Empire.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'education.html'), 'utf8');

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
    for (const lesson of flatLessons(modules)) {
      assert.equal(lesson.youtubeId, undefined, key + ':' + lesson.n);
      assert.equal(bareDeal(lesson.title), null, lesson.title);
      assert.equal(bareDeal(lesson.description), null, lesson.description);
      if (commercial.includes(lesson.n)) {
        assert.equal(lesson.empire, true, key + ':' + lesson.n);
        flagged.push(key + ':' + lesson.n);
      } else {
        assert.equal(lesson.empire, undefined, key + ':' + lesson.n);
      }
    }
  }
  assert.deepEqual(flagged, [
    'lease-option:7', 'lease-option:8', 'subject-to:11', 'assumption:8',
  ]);

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

test('foundation sees residential lessons as coming soon and commercial lessons locked', () => {
  const sandbox = loadPaths();
  const api = sandbox.api;
  api.leaseOptionPath.render();
  api.subjectToPath.render();
  api.assumptionPath.render();

  const lease = sandbox.elements['lease-option-path-container'].innerHTML;
  const subject = sandbox.elements['subject-to-path-container'].innerHTML;
  const assumption = sandbox.elements['assumption-path-container'].innerHTML;

  assert.equal((lease.match(/path-row locked/g) || []).length, 2);
  assert.equal((lease.match(/>Coming soon</g) || []).length, 6);
  assert.match(lease, /0 of 6/);
  assert.match(lease, /data-path-locked="1"/);
  assert.match(lease, /Commercial lease options/);
  assert.match(lease, /Master lease options/);
  assert.equal(lease.includes('landlord consent'), false);
  assert.equal(lease.includes('<iframe'), false);
  assert.equal(lease.includes('youtube'), false);
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
  assert.match(opened, /path-soon-kicker">Coming soon/);
  assert.match(opened, /This video is not recorded yet/);
  assert.match(opened, /Separate the right to occupy/);
  assert.equal(opened.includes('<iframe'), false);

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
  assert.equal(sandbox.elements['lease-option-path-container'].innerHTML.includes('<iframe'), false);

  api.applyCreativeFinanceVideos({
    paths: { 'lease-option': [{ n: 7, youtubeId: 'SECRET_LEASE_7' }], assumption: [{ n: 8, youtubeId: 'SECRET_ASSUMPTION_8' }] },
  });
  assert.equal(api.leaseOptionPath.lesson(7).youtubeId, undefined);
  assert.equal(api.assumptionPath.lesson(8).youtubeId, undefined);

  const withResidentialId = JSON.parse(JSON.stringify(api.leaseOptionPath.cfg.modules));
  withResidentialId[0].lessons[0].youtubeId = 'RES_LEASE_1';
  api.leaseOptionPath.replaceModules(withResidentialId);
  api.leaseOptionPath.open(1, false);
  const playingResidential = sandbox.elements['lease-option-path-container'].innerHTML;
  const player = playingResidential.slice(playingResidential.indexOf('path-player'), playingResidential.indexOf('path-modules'));
  assert.match(player, /embed\/RES_LEASE_1/);
  assert.equal(player.includes('path-soon-kicker'), false);
  api.leaseOptionPath.replaceModules(api.FORGE_LEASE_OPTION_LESSONS);
});

test('empire sees commercial lessons as coming soon until a server id is merged', () => {
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
  assert.equal((lease.match(/>Coming soon</g) || []).length, 8);
  assert.equal((subject.match(/>Coming soon</g) || []).length, 11);
  assert.equal((assumption.match(/>Coming soon</g) || []).length, 8);
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
  assert.equal(api.leaseOptionPath.lesson(1).youtubeId, undefined);
  assert.equal(api.assumptionPath.lesson(8).youtubeId, 'SECRET_ASSUMPTION_8');

  api.leaseOptionPath.open(7, false);
  const playing = sandbox.elements['lease-option-path-container'].innerHTML;
  const player = playing.slice(playing.indexOf('path-player'), playing.indexOf('path-modules'));
  assert.match(player, /embed\/SECRET_LEASE_7/);
  assert.equal(player.includes('path-soon-kicker'), false);
  assert.match(player, /Mark complete/);
});
