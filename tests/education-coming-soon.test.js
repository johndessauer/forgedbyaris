const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'education.html'), 'utf8');

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('Could not extract ' + startMarker);
  return source.slice(start, end);
}

function loadModules() {
  const elements = { 'library-coming-soon': { innerHTML: '' } };
  const sandbox = {
    console,
    document: {
      getElementById(id) { return elements[id] || null; },
    },
  };
  const source = [
    'function escapeHtml(str) {',
    '  return String(str == null ? "" : str)',
    '    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
    '}',
    extractBetween(html, 'const LIBRARY_MODULES = ', 'const INCOME_TYPE_META'),
    'globalThis.api = { LIBRARY_MODULES, libraryModuleCard, renderLibraryModules };',
  ].join('\n');
  vm.runInNewContext(source, sandbox, { filename: 'education.html coming soon' });
  return { api: sandbox.api, elements };
}

test('coming soon library cards are disabled, tiered, and free of links', () => {
  const { api, elements } = loadModules();
  assert.equal(JSON.stringify(api.LIBRARY_MODULES.map((row) => row.title)), JSON.stringify([
    'Fix & Flip',
    'Mobile Home Parks',
    'Storage Units',
    'RV Parks',
  ]));
  assert.equal(JSON.stringify(api.LIBRARY_MODULES.map((row) => row.releaseLabel)), JSON.stringify([
    'December 2026',
    'January 2027',
    'February 2027',
    'March 2027',
  ]));
  assert.ok(api.LIBRARY_MODULES.every((row) => row.status === 'coming-soon' && row.lessons === 18));
  assert.equal(api.LIBRARY_MODULES[0].tier, 'foundation');
  assert.equal(api.LIBRARY_MODULES[0].empireLessonCount, 1);
  assert.ok(api.LIBRARY_MODULES.slice(1).every((row) => row.tier === 'empire'));

  api.renderLibraryModules();
  const markup = elements['library-coming-soon'].innerHTML;
  assert.match(markup, /Coming soon/);
  assert.match(markup, /Buy, rehab and sell flips with the 70% rule and a real cost stack/);
  assert.match(markup, /Underwrite, fund and run your first park/);
  assert.match(markup, /Buy and run self-storage with the live Self-Storage analyzer/);
  assert.match(markup, /Seasonality, hookups and stay-mix underwriting for RV parks/);
  assert.equal((markup.match(/class="module-card coming"/g) || []).length, 4);
  assert.equal((markup.match(/aria-disabled="true"/g) || []).length, 4);
  assert.equal((markup.match(/class="module-card-tier empire"/g) || []).length, 3);
  assert.match(markup, /1 Empire lesson/);
  assert.equal(markup.includes('<a'), false);
  assert.equal(markup.includes('iframe'), false);
  assert.equal(markup.includes('onclick'), false);
  assert.equal(markup.includes('href'), false);
  assert.equal(/lob|thanks\.io|stripe|youtube/i.test(markup), false);
});
