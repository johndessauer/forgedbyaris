// Routing, fallback, and citation handoff for ARIS live research.
// No live model calls. The stream test stubs fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const EDGE = path.join(ROOT, 'netlify', 'edge-functions');

let gate = Promise.resolve();
function exclusive(fn) {
  const run = gate.then(fn, fn);
  gate = run.then(() => {}, () => {});
  return run;
}

async function loadLib() {
  return import(pathToFileURL(path.join(EDGE, 'lib', 'aris-research.js')).href);
}

async function loadStream() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aris-research-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(EDGE, 'aris-stream.js'), path.join(dir, 'aris-stream.mjs'));
  for (const file of fs.readdirSync(path.join(EDGE, 'lib'))) {
    if (file.endsWith('.js')) fs.copyFileSync(path.join(EDGE, 'lib', file), path.join(dir, 'lib', file));
  }
  globalThis.__forgeTestMembership = async () => ({ ok: true, status: 200, memberId: 'mem_test', active: true, empire: true });
  return import(pathToFileURL(path.join(dir, 'aris-stream.mjs')).href + '?t=' + Math.random());
}

const RAIL = 'Is there any rail line service in Crown Point, Indiana?';
const MAO = "What's my MAO if the ARV is $200,000 and repairs are $40,000?";

test('factual questions research, and coaching or math does not', async () => {
  const { classifyResearch, classifyMessages } = await loadLib();
  assert.equal(classifyResearch(RAIL), 'research');
  assert.equal(classifyResearch("What's the homestead exemption in Indiana right now?"), 'research');
  assert.equal(classifyResearch('Did the city rezone the West Lake corridor?'), 'research');
  assert.equal(classifyResearch('Who is the mayor of Gary?'), 'research');
  assert.equal(classifyResearch(MAO), 'skip');
  assert.equal(classifyResearch('How should I talk to this seller?'), 'skip');
  assert.equal(classifyResearch('What about the duplex?'), 'skip');
  assert.equal(classifyResearch('Is Crown Point a good market?'), 'skip');
  assert.equal(classifyResearch('Explain the 70% rule.'), 'skip');
  assert.equal(classifyMessages([
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{"ok":true}' }] },
  ]), 'skip');
  assert.equal(classifyMessages([
    { role: 'user', content: 'What about the duplex?' },
  ]), 'skip');
});

test('a failed search tells the coach not to invent or deflect', async () => {
  const { researchSystemBlock, parseResearchMessage, researchStatusEvent, RESEARCH_STATUS } = await loadLib();
  const block = researchSystemBlock({ ok: false, reason: 'timeout', findingsText: '', sources: [] });
  assert.match(block, /could not confirm/);
  assert.match(block, /Do not invent/);
  assert.match(block, /Do not tell the member to look it up/);
  const empty = parseResearchMessage({
    content: [{ type: 'text', text: 'Nothing solid found on the town site.' }],
    stop_reason: 'end_turn',
  });
  assert.equal(empty.ok, false);
  const sourced = parseResearchMessage({
    stop_reason: 'end_turn',
    content: [
      {
        type: 'web_search_tool_result',
        content: [{ type: 'web_search_result', title: 'NICTD', url: 'https://nictd.com/stations' }],
      },
      {
        type: 'text',
        text: 'Crown Point has no South Shore stop.',
        citations: [{ type: 'web_search_result_location', title: 'NICTD', url: 'https://nictd.com/stations' }],
      },
    ],
  });
  assert.equal(sourced.ok, true);
  assert.equal(sourced.sources[0].url, 'https://nictd.com/stations');
  const found = researchSystemBlock(sourced);
  assert.match(found, /\[NICTD\]\(https:\/\/nictd\.com\/stations\)/);
  assert.match(researchStatusEvent(), new RegExp(RESEARCH_STATUS));
});

test('research is off only when the env var says so', async () => {
  const { webResearchEnabled, researchRequestBody, RESEARCH_MAX_SEARCHES, RESEARCH_TOOL_TYPE } = await loadLib();
  assert.equal(webResearchEnabled(() => ''), true);
  assert.equal(webResearchEnabled((key) => (key === 'ARIS_WEB_RESEARCH' ? '0' : '')), false);
  const body = researchRequestBody({ model: 'claude-sonnet-4-6', question: RAIL });
  assert.equal(body.stream, false);
  assert.equal(body.tools[0].type, RESEARCH_TOOL_TYPE);
  assert.equal(body.tools[0].name, 'web_search');
  assert.equal(body.tools[0].max_uses, RESEARCH_MAX_SEARCHES);
});

test('a search timeout still streams a status line and a non-deflecting answer', () => exclusive(async () => {
  const mod = await loadStream();
  const previousFetch = globalThis.fetch;
  const previousNetlify = globalThis.Netlify;
  const calls = [];
  globalThis.Netlify = { env: { get: (key) => (key === 'ANTHROPIC_API_KEY' ? 'test-key' : '') } };
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (body && body.stream === false) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    return new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Next step."}}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  try {
    const res = await mod.default(new Request('https://x/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'coach', messages: [{ role: 'user', content: RAIL }] }),
    }), {});
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /Let me research that/);
    assert.match(text, /"status":"research"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.stream, false);
    assert.equal(calls[0].body.tools[0].name, 'web_search');
    assert.match(calls[1].body.system, /could not confirm/);
    assert.match(calls[1].body.system, /Do not tell the member to look it up/);
    assert.equal(calls[1].body.stream, true);
    assert.equal(JSON.stringify(calls).includes('test-key'), false);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Netlify = previousNetlify;
  }
}));

test('a sourced search is cited in the coach prompt and math is not searched', () => exclusive(async () => {
  const mod = await loadStream();
  const previousFetch = globalThis.fetch;
  const previousNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (key) => (key === 'ANTHROPIC_API_KEY' ? 'test-key' : '') } };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push(body);
    if (body && body.stream === false) {
      return new Response(JSON.stringify({
        stop_reason: 'end_turn',
        content: [{
          type: 'text',
          text: 'No South Shore stop in Crown Point. Nearest stops are Munster and Dyer.',
          citations: [{ type: 'web_search_result_location', title: 'NICTD', url: 'https://nictd.com/stations' }],
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n', { status: 200 });
  };
  try {
    const res = await mod.default(new Request('https://x/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'coach', messages: [{ role: 'user', content: RAIL }] }),
    }), {});
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Let me research that/);
    assert.match(calls[1].system, /\[NICTD\]\(https:\/\/nictd\.com\/stations\)/);
    assert.match(calls[1].system, /Never correct their pronunciation|LIVE RESEARCH FINDINGS/);

    calls.length = 0;
    await mod.default(new Request('https://x/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'coach', messages: [{ role: 'user', content: MAO }] }),
    }), {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].stream, true);
    assert.equal(calls[0].tools, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Netlify = previousNetlify;
  }
}));

test('the coach prompt forbids name correction and lookup deflections', () => {
  const src = fs.readFileSync(path.join(EDGE, 'aris-stream.js'), 'utf8');
  assert.match(src, /Never correct their pronunciation/);
  assert.match(src, /Never end by telling the member to go look a fact up/);
  assert.match(src, /runWebResearch/);
  const research = fs.readFileSync(path.join(EDGE, 'lib', 'aris-research.js'), 'utf8');
  assert.match(research, /web_search_20250305/);
  assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(src), false);
});
