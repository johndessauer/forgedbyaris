// The ARIS comps wording stays OFF until COMPS_ARIS_LIVE=1 (Build Brief §6.3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

async function systemPromptFor(promptKey, flag) {
  const src = path.join(__dirname, '..', 'netlify', 'edge-functions', 'aris-stream.js');
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aris-')), 'aris-stream.mjs');
  fs.copyFileSync(src, copy);
  const env = { ANTHROPIC_API_KEY: 'test-key', COMPS_ARIS_LIVE: flag };
  globalThis.Netlify = { env: { get: k => env[k] } };
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response('data: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); };
  try {
    const mod = await import(pathToFileURL(copy).href + '?t=' + Math.random());
    await mod.default(new Request('https://x/', { method: 'POST', body: JSON.stringify({ promptKey, messages: [{ role: 'user', content: 'hi' }] }) }), {});
  } finally { globalThis.fetch = realFetch; }
  return sent && sent.system;
}

test('flag off (default): no comping-engine claims in any ARIS prompt', async () => {
  for (const key of ['coach', 'deal-analyzer', 'sales']) {
    const sys = await systemPromptFor(key, undefined);
    assert.ok(sys && sys.length > 1000, key);
    assert.ok(!sys.includes('COMPING ENGINE'), key);
  }
});

test('flag on: member prompts get the caveated description; the public widget may not run comps', async () => {
  const coach = await systemPromptFor('coach', '1');
  assert.ok(coach.includes('recorded sales within 1 mi / 90 days and RentCast valuations'));
  assert.ok(coach.includes('estimate, not an appraisal') && coach.includes('not verified sales') && coach.includes('coverage varies by market'));
  const da = await systemPromptFor('deal-analyzer', '1');
  assert.ok(da.includes('COMPING ENGINE (Empire feature, live)'));
  const sales = await systemPromptFor('sales', '1');
  assert.ok(sales.includes('must NOT run comps'));
  assert.ok(!sales.includes('Empire feature, live'));
});
