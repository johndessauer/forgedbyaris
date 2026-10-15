// "This week at FORGE" note: injected into every ARIS mode, fails closed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

async function run(promptKey, env, noteFetch) {
  const src = path.join(__dirname, '..', 'netlify', 'edge-functions', 'aris-stream.js');
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aris-')), 'aris-stream.mjs');
  fs.copyFileSync(src, copy);
  const e = { ANTHROPIC_API_KEY: 'k', ...env };
  globalThis.Netlify = { env: { get: k => e[k] } };
  let sent = null; const noteUrls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('anthropic.com')) { sent = JSON.parse(init.body); return new Response('data: {}\n\n', { status: 200 }); }
    noteUrls.push(String(url)); return noteFetch(url);
  };
  try {
    const mod = await import(pathToFileURL(copy).href + '?t=' + Math.random());
    await mod.default(new Request('https://x/', { method: 'POST', body: JSON.stringify({ promptKey, messages: [{ role: 'user', content: 'hi' }] }) }), {});
  } finally { globalThis.fetch = realFetch; }
  return { sys: sent.system, noteUrls };
}

const NOTE = 'Week 1: Building Your Investor Foundation. Homework: schedule a REIA meeting.';
const ok = () => new Response(NOTE, { status: 200, headers: { 'content-type': 'text/plain' } });

test('note injected for every mode, Google Doc URL converted to txt export', async () => {
  for (const key of ['coach', 'deal-analyzer', 'sales']) {
    const { sys, noteUrls } = await run(key, { ARIS_WEEKLY_NOTE_URL: 'https://docs.google.com/document/d/abc_123/edit?usp=sharing' }, ok);
    assert.ok(sys.includes('THIS WEEK AT FORGE') && sys.includes(NOTE), key);
    assert.ok(sys.includes('Never invent homework'), key);
    assert.equal(noteUrls[0], 'https://docs.google.com/document/d/abc_123/export?format=txt');
  }
  const { sys } = await run('sales', { ARIS_WEEKLY_NOTE_URL: 'https://e/n.txt' }, ok);
  assert.ok(sys.includes('NOT a member'));
});

test('no env var, error, HTML (private doc) or throw -> prompt unchanged', async () => {
  const base = (await run('coach', {}, ok)).sys;
  assert.ok(!base.includes('THIS WEEK AT FORGE'));
  const cases = [
    () => new Response('nope', { status: 404 }),
    () => new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => { throw new Error('timeout'); },
    () => new Response('   ', { status: 200, headers: { 'content-type': 'text/plain' } }),
  ];
  for (const c of cases) {
    const { sys } = await run('coach', { ARIS_WEEKLY_NOTE_URL: 'https://e/n.txt' }, c);
    assert.equal(sys, base);
  }
});
