#!/usr/bin/env node
// Copies the public website into public/ so Netlify does not serve the repo.
//
// The Document Vault templates under docs/ (docx, xlsx, pdf) stay public and
// stay behind the member-page edge function. Markdown in this repo is
// internal (setup notes, lesson outlines, handoffs). No page links to a
// .md file. PUBLIC_MARKDOWN is the allowlist if that ever changes.
//
// Functions and edge functions are deployed from netlify/ in the base
// directory. They are not part of this copy.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Page trees. docs/ is copied separately so only vault templates go out.
const WEB_DIRS = ['assets', 'blog', 'fwn', 'unlocks', 'webinar'];

const ROOT_FILES = ['robots.txt', 'sitemap.xml'];

// Keep in sync with VAULT_DOCUMENT in netlify/edge-functions/member-page.js.
const VAULT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pdf']);

// Relative paths, forward slashes. Empty: nothing in the repo is a public note.
const PUBLIC_MARKDOWN = [];

// Directory names that are never website content, at any depth.
const PRIVATE_DIRS = new Set([
  'netlify',
  'tests',
  'scripts',
  'supabase',
  'sql',
  'node_modules',
  '.github',
  '.git',
  'handoffs',
]);

const PRIVATE_EXTENSIONS = new Set(['.sql', '.md', '.toml', '.sh', '.lock']);

const PRIVATE_FILENAMES = new Set([
  'package.json',
  'package-lock.json',
  'netlify.toml',
  'deno.lock',
  'documents.js',
  '.gitignore',
  '.DS_Store',
]);

function publishSite(outDir) {
  const out = resolveOut(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const name of fs.readdirSync(ROOT)) {
    const src = path.join(ROOT, name);
    if (!fs.statSync(src).isFile()) continue;
    if (name.endsWith('.html') || ROOT_FILES.includes(name)) {
      fs.copyFileSync(src, path.join(out, name));
    }
  }

  for (const dir of WEB_DIRS) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) continue;
    copyTree(src, path.join(out, dir), (filename) => {
      const ext = path.extname(filename).toLowerCase();
      return ext !== '.md' && ext !== '.sql';
    });
  }

  copyVault(path.join(ROOT, 'docs'), path.join(out, 'docs'), 'docs');

  for (const rel of PUBLIC_MARKDOWN) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      throw new Error('PUBLIC_MARKDOWN entry is missing: ' + rel);
    }
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  assertPublishedTree(out);
  return out;
}

function resolveOut(outDir) {
  const out = path.resolve(outDir || path.join(ROOT, 'public'));
  if (out === ROOT) throw new Error('refusing to publish onto the repo root');
  const rel = path.relative(ROOT, out);
  const insideRepo = rel === 'public' || rel.startsWith('public' + path.sep);
  const insideTmp = out.startsWith(osTmpPrefix());
  if (!insideRepo && !insideTmp) {
    throw new Error('publish directory must be public/ or a temp directory');
  }
  return out;
}

function osTmpPrefix() {
  const tmp = require('os').tmpdir();
  return tmp.endsWith(path.sep) ? tmp : tmp + path.sep;
}

function copyTree(srcDir, destDir, allowFile) {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || PRIVATE_DIRS.has(ent.name)) continue;
    const from = path.join(srcDir, ent.name);
    const to = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyTree(from, to, allowFile);
      continue;
    }
    if (!ent.isFile() || !allowFile(ent.name)) continue;
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function copyVault(srcDir, destDir, relDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'handoffs') continue;
    const from = path.join(srcDir, ent.name);
    const rel = relDir + '/' + ent.name;
    const to = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyVault(from, to, rel);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!VAULT_EXTENSIONS.has(path.extname(ent.name).toLowerCase())) continue;
    if (PUBLIC_MARKDOWN.includes(rel)) continue;
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function assertPublishedTree(out) {
  const leaks = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(out, full).split(path.sep).join('/');
      if (ent.isDirectory()) {
        if (PRIVATE_DIRS.has(ent.name)) leaks.push(rel + '/');
        walk(full);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      const publicNote = PUBLIC_MARKDOWN.includes(rel);
      if (PRIVATE_EXTENSIONS.has(ext) && !publicNote) leaks.push(rel);
      if (PRIVATE_FILENAMES.has(ent.name)) leaks.push(rel);
      const top = rel.split('/')[0];
      if (rel.indexOf('/') === -1) {
        const rootOk = ent.name.endsWith('.html')
          || ROOT_FILES.includes(ent.name)
          || publicNote;
        if (!rootOk) leaks.push(rel);
      } else if (!WEB_DIRS.includes(top) && top !== 'docs') {
        leaks.push(rel);
      }
    }
  }
  walk(out);
  if (leaks.length) {
    throw new Error('publish output contains non-web files:\n' + leaks.join('\n'));
  }
}

module.exports = {
  PUBLIC_MARKDOWN,
  ROOT_FILES,
  VAULT_EXTENSIONS,
  WEB_DIRS,
  PRIVATE_DIRS,
  PRIVATE_EXTENSIONS,
  PRIVATE_FILENAMES,
  publishSite,
};

if (require.main === module) {
  const out = publishSite(process.argv[2]);
  console.log('Published site to ' + out);
}
