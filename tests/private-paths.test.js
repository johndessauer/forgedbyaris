// The site must not publish the repo root. Source, tests, SQL, and internal
// notes 404. Pages, assets, vault templates, functions, and edge routes stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  PUBLIC_MARKDOWN,
  VAULT_EXTENSIONS,
  publishSite,
} = require('../scripts/publish-site');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'public') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

function redirectRules(toml) {
  return toml.split('[[redirects]]').slice(1).map((block) => {
    const from = block.match(/^\s*from\s*=\s*"([^"]+)"/m);
    const to = block.match(/^\s*to\s*=\s*"([^"]+)"/m);
    const status = block.match(/^\s*status\s*=\s*(\d+)/m);
    return {
      from: from && from[1],
      to: to && to[1],
      status: status ? Number(status[1]) : null,
      force: /^\s*force\s*=\s*true/m.test(block),
    };
  });
}

// Netlify splats match only at the end of a path segment (/netlify/*).
// A leading dot keeps /.netlify/functions/* on the function router.
function ruleMatches(from, pathname) {
  if (from.endsWith('/*')) return pathname.startsWith(from.slice(0, -1));
  return pathname === from;
}

function firstMatch(rules, pathname) {
  return rules.find((rule) => ruleMatches(rule.from, pathname));
}

const BLOCKED_FROMS = [
  '/netlify',
  '/netlify/*',
  '/tests',
  '/tests/*',
  '/scripts',
  '/scripts/*',
  '/supabase',
  '/supabase/*',
  '/node_modules',
  '/node_modules/*',
  '/.github',
  '/.github/*',
  '/docs/handoffs',
  '/docs/handoffs/*',
  '/package.json',
  '/package-lock.json',
  '/netlify.toml',
  '/deno.lock',
  '/documents.js',
];

const SAFE_PATHS = [
  '/',
  '/index.html',
  '/education',
  '/education.html',
  '/assets/js/level-unlocks.js',
  '/assets/styles.css',
  '/assets/whats-new.json',
  '/api/education-data',
  '/api/aris-stream',
  '/api/lab-debrief',
  '/.netlify/functions/education-data',
  '/.netlify/functions/aris-quote',
  '/docs/FORGE-Bill-of-Sale.docx',
  '/blog/how-to-wholesale-a-real-estate-deal.html',
  '/fwn/4-numbers-deal-sheet.pdf',
  '/robots.txt',
  '/sitemap.xml',
  '/webinar/join',
  '/book',
];

test('forced 404 rules block source paths without catching functions or pages', () => {
  const toml = read('netlify.toml');
  assert.match(toml, /command\s*=\s*"node scripts\/publish-site\.js"/);
  assert.match(toml, /publish\s*=\s*"public"/);
  assert.match(toml, /directory\s*=\s*"netlify\/functions"/);
  assert.match(toml, /included_files\s*=\s*\["netlify\/functions\/__fixtures__\/\*\*"\]/);

  const rules = redirectRules(toml);
  for (const from of BLOCKED_FROMS) {
    const rule = rules.find((item) => item.from === from);
    assert.ok(rule, 'missing redirect for ' + from);
    assert.equal(rule.status, 404, from);
    assert.equal(rule.force, true, from);
    assert.equal(rule.to, '/404.html', from);
  }

  for (const rule of rules.filter((item) => item.status === 404)) {
    assert.ok(rule.from.endsWith('/*') || !rule.from.includes('*'), rule.from);
    for (const pathname of SAFE_PATHS) {
      assert.equal(ruleMatches(rule.from, pathname), false, rule.from + ' matches ' + pathname);
    }
  }

  const leaks = [
    '/netlify/functions/_Lib/creative-finance-lessons.js',
    '/netlify/edge-functions/lib/speech-text.js',
    '/tests/creative-finance-lessons.test.js',
    '/scripts/check-syntax.js',
    '/scripts/test-sql.sql',
    '/package.json',
    '/schema.sql',
    '/docs/DUNNING-SETUP.md',
    '/docs/creative-finance-lessons.md',
    '/docs/handoffs/2026-10-12-comping-engine.md',
    '/CRM-SETUP-NOTES.md',
  ];
  for (const pathname of leaks) {
    const rule = firstMatch(rules, pathname);
    assert.ok(rule, pathname);
    assert.equal(rule.status, 404, pathname);
    assert.equal(rule.force, true, pathname);
  }

  const api = firstMatch(rules, '/api/education-data');
  assert.ok(api);
  assert.equal(api.status, 200);
  assert.equal(api.to, '/.netlify/functions/education-data');
  assert.equal(firstMatch(rules, '/.netlify/functions/education-data'), undefined);
  assert.equal(firstMatch(rules, '/assets/js/level-unlocks.js'), undefined);

  const privateFiles = walk(root).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return ext === '.sql' || ext === '.md';
  });
  assert.ok(privateFiles.length > 0);
  for (const file of privateFiles) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const pathname = '/' + rel;
    const rule = rules.find((item) => item.status === 404 && item.force && ruleMatches(item.from, pathname));
    if (PUBLIC_MARKDOWN.includes(rel)) {
      assert.equal(rule, undefined, rel + ' is public and must not 404');
    } else {
      assert.ok(rule, 'no forced 404 covers ' + pathname);
    }
  }
});

test('no page links a markdown file, so none is intentionally public', () => {
  assert.deepEqual(PUBLIC_MARKDOWN, []);
  const pages = walk(root).filter((file) => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    return rel.endsWith('.html') || rel.startsWith('assets/');
  });
  const link = /(?:href|src)\s*=\s*["'][^"']*\.md/i;
  for (const file of pages) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(link.test(text), false, path.relative(root, file));
  }
});

test('publish output keeps pages, assets, and vault files', () => {
  const out = publishSite(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-public-')));
  for (const rel of [
    'index.html',
    'education.html',
    'assets/js/level-unlocks.js',
    'assets/whats-new.json',
    'robots.txt',
    'sitemap.xml',
    'fwn/4-numbers-deal-sheet.pdf',
    'blog/how-to-wholesale-a-real-estate-deal.html',
  ]) {
    assert.equal(fs.existsSync(path.join(out, rel)), true, rel);
  }
  assert.equal(
    fs.readFileSync(path.join(out, 'assets/js/level-unlocks.js'), 'utf8'),
    read('assets/js/level-unlocks.js')
  );

  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.html')) continue;
    assert.equal(fs.existsSync(path.join(out, name)), true, name);
  }

  for (const ext of VAULT_EXTENSIONS) {
    const source = walk(path.join(root, 'docs')).filter((file) => file.toLowerCase().endsWith(ext));
    const published = walk(path.join(out, 'docs')).filter((file) => file.toLowerCase().endsWith(ext));
    assert.equal(published.length, source.length, ext);
    assert.ok(source.length > 0 || ext === '.pdf', ext);
  }

  for (const rel of [
    'netlify/functions/_Lib/creative-finance-lessons.js',
    'netlify/edge-functions/lib/speech-text.js',
    'tests/creative-finance-lessons.test.js',
    'scripts/check-syntax.js',
    'scripts/test-sql.sql',
    'package.json',
    'package-lock.json',
    'netlify.toml',
    'deno.lock',
    'documents.js',
    'schema.sql',
    'add-education-level-awards.sql',
    'CRM-SETUP-NOTES.md',
    'FORGE_Weekly_Banners_and_Connect_Test_Plan_2026-11-06.md',
    'docs/DUNNING-SETUP.md',
    'docs/creative-finance-lessons.md',
    'docs/handoffs/2026-10-12-comping-engine.md',
    'netlify/functions/__fixtures__/rentcast/README.md',
  ]) {
    assert.equal(fs.existsSync(path.join(out, rel)), false, rel);
  }

  for (const file of walk(out)) {
    const rel = path.relative(out, file).split(path.sep).join('/');
    const ext = path.extname(file).toLowerCase();
    assert.equal(ext === '.sql', false, rel);
    assert.equal(ext === '.md' && !PUBLIC_MARKDOWN.includes(rel), false, rel);
    assert.equal(rel.startsWith('netlify/'), false, rel);
    assert.equal(rel.startsWith('tests/'), false, rel);
    assert.equal(rel.startsWith('scripts/'), false, rel);
    assert.equal(rel.startsWith('supabase/'), false, rel);
    assert.equal(rel.startsWith('node_modules/'), false, rel);
    assert.equal(rel.startsWith('.github/'), false, rel);
  }
});

test('vault notes 404 before the membership page; templates stay gated', async () => {
  const edge = path.join(root, 'netlify/edge-functions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-docs-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(edge, 'member-page.js'), path.join(dir, 'member-page.mjs'));
  fs.copyFileSync(path.join(edge, 'lib/membership.js'), path.join(dir, 'lib/membership.js'));
  const mod = await import(pathToFileURL(path.join(dir, 'member-page.mjs')).href);

  for (const pathname of [
    '/docs/DUNNING-SETUP.md',
    '/docs/creative-finance-lessons.md',
    '/docs/handoffs/2026-10-12-comping-engine.md',
  ]) {
    let served = false;
    const res = await mod.default(new Request('https://preview.example' + pathname, {
      headers: { cookie: 'forge_ms=jwt' },
    }), {
      next: async () => { served = true; return new Response('SECRET NOTE'); },
    });
    assert.equal(res.status, 404, pathname);
    assert.equal(served, false, pathname);
    assert.equal((await res.text()).includes('SECRET NOTE'), false, pathname);
  }

  let servedDoc = false;
  const doc = await mod.default(new Request('https://preview.example/docs/FORGE-Bill-of-Sale.docx'), {
    next: async () => { servedDoc = true; return new Response('DOC BYTES'); },
  });
  assert.equal(servedDoc, false);
  assert.match(await doc.text(), /Checking your membership/);
});
