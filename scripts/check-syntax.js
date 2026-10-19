#!/usr/bin/env node
// Syntax check (Build Brief §8.1). Run before every commit:  npm run check
//   - node --check on every netlify/functions/**/*.js and assets/js/*.js
//   - ESM parse of every netlify/edge-functions/*.js
//   - parse of every inline <script> block in the listed HTML pages
// Parses only; nothing is executed. Exits non-zero on the first failure set.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PAGES = ['property-search.html', 'deal-analyzer.html', 'comp-report.html', 'crm.html', 'profile.html'];
let failures = 0;
let checked = 0;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function nodeCheck(file, label) {
  checked += 1;
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (err) { failures += 1; console.error(`FAIL ${label}\n${String(err.stderr || err.message).trim()}\n`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-check-'));

// 1. CommonJS functions and browser assets
[...walk(path.join(ROOT, 'netlify/functions'), []), ...walk(path.join(ROOT, 'assets/js'), [])]
  .forEach(f => nodeCheck(f, path.relative(ROOT, f)));

// 2. Edge functions are ES modules — check them as .mjs
walk(path.join(ROOT, 'netlify/edge-functions'), []).forEach(f => {
  const copy = path.join(tmp, path.basename(f, '.js') + '.mjs');
  fs.copyFileSync(f, copy);
  nodeCheck(copy, path.relative(ROOT, f) + ' (ESM)');
});

// 3. Inline <script> blocks
HTML_PAGES.forEach(page => {
  const file = path.join(ROOT, page);
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m; let n = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs) || !m[2].trim()) continue;
    if (/type\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(attrs)) continue;
    n += 1;
    const line = html.slice(0, m.index).split('\n').length;
    const label = `${page} inline script #${n} (line ${line})`;
    if (/type\s*=\s*["']?module/i.test(attrs)) {
      const copy = path.join(tmp, `${path.basename(page, '.html')}-${n}.mjs`);
      fs.writeFileSync(copy, m[2]);
      nodeCheck(copy, label + ' (module)');
    } else {
      checked += 1;
      try { new vm.Script(m[2], { filename: label }); }
      catch (err) { failures += 1; console.error(`FAIL ${label}\n${err.message}\n`); }
    }
  }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Syntax check: ${checked} files/blocks checked, ${failures} failed.`);
process.exit(failures ? 1 : 0);
