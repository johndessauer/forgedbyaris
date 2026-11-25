// Netlify bundles these handlers as CommonJS. createRequire(import.meta.url)
// then throws on every request because import.meta.url is undefined.
// Bundle the same way and load the result.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ENTRIES = [
  'skip-trace.js',
  'skip-trace-credits.js',
  'skip-trace-stripe-webhook.js',
];

test('skip-trace handlers load after a CommonJS bundle', async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
  // Keep the bundle inside the repo so Node can resolve external packages
  // from node_modules. A file under /tmp cannot.
  const dir = fs.mkdtempSync(path.join(__dirname, '../.skip-trace-bundle-'));
  try {
    for (const name of ENTRIES) {
      const outfile = path.join(dir, name);
      await esbuild.build({
        entryPoints: [path.join(__dirname, '../netlify/functions', name)],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        outfile,
        external: ['@supabase/supabase-js', '@memberstack/admin', '@netlify/blobs'],
        logLevel: 'silent',
      });
      const source = fs.readFileSync(outfile, 'utf8');
      assert.equal(
        /createRequire\s*\(\s*import\.meta\.url\s*\)|createRequire\)\(import_meta\.url\)/.test(source),
        false,
        name + ' still calls createRequire(import.meta.url), which is undefined in a CommonJS bundle'
      );
      const loaded = require(outfile);
      assert.equal(typeof loaded.default, 'function', name + ' default export');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
