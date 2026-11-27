// Misheard "ARIS" at the start of a Talk Mode utterance, plus the
// speech-to-text keyterm. No live transcription call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const EDGE = path.join(ROOT, 'netlify', 'edge-functions');

async function loadName() {
  return import(pathToFileURL(path.join(EDGE, 'lib', 'aris-heard-name.js')).href);
}

async function loadTranscribe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aris-heard-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(EDGE, 'aris-transcribe.js'), path.join(dir, 'aris-transcribe.mjs'));
  for (const file of fs.readdirSync(path.join(EDGE, 'lib'))) {
    if (file.endsWith('.js')) fs.copyFileSync(path.join(EDGE, 'lib', file), path.join(dir, 'lib', file));
  }
  return import(pathToFileURL(path.join(dir, 'aris-transcribe.mjs')).href + '?t=' + Math.random());
}

test('a clipped name at the start of an utterance becomes ARIS', async () => {
  const { normalizeHeardName } = await loadName();
  const cases = [
    ['Iris', 'ARIS'],
    ['Harris, what should I do', 'ARIS, what should I do'],
    ['Hey Aries can you run this', 'Hey ARIS can you run this'],
    ['Ris?', 'ARIS?'],
    ['Eris, is there rail service', 'ARIS, is there rail service'],
    ['um Arras how far is the station', 'um ARIS how far is the station'],
    ['Aris', 'ARIS'],
    ['ARIS what is my offer', 'ARIS what is my offer'],
    ['Harris County taxes', 'Harris County taxes'],
    ['The iris of the camera', 'The iris of the camera'],
    ['Tell Harris I called', 'Tell Harris I called'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeHeardName(input), expected, input);
  }
});

test('transcription hints ARIS and normalizes a misheard opening', async () => {
  const mod = await loadTranscribe();
  const previousFetch = globalThis.fetch;
  const previousNetlify = globalThis.Netlify;
  const previousMembership = globalThis.__forgeTestMembership;
  let form = null;
  globalThis.__forgeTestMembership = async () => ({ ok: true, status: 200, memberId: 'mem_test', active: true });
  globalThis.Netlify = { env: { get: (key) => (key === 'ELEVENLABS_API_KEY' ? 'test-key' : '') } };
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /speech-to-text/);
    form = init.body;
    assert.equal(init.headers['xi-api-key'], 'test-key');
    return new Response(JSON.stringify({ text: 'Iris [background noise] is there a rail line' }), { status: 200 });
  };
  try {
    const res = await mod.default(new Request('https://x/api/aris-transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Authorization: 'Bearer tok' },
      body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    }), {});
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.text, 'ARIS is there a rail line');
    assert.equal(form.get('model_id'), 'scribe_v2');
    assert.deepEqual(form.getAll('keyterms'), ['ARIS']);
    assert.equal(JSON.stringify(json).includes('test-key'), false);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Netlify = previousNetlify;
    if (previousMembership) globalThis.__forgeTestMembership = previousMembership;
    else delete globalThis.__forgeTestMembership;
  }
});
