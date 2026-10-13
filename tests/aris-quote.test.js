const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHandler, _limits } = require('../netlify/functions/aris-quote');

function setup(opts) {
  const o = opts || {};
  const sent = [];
  const handler = createHandler({
    env: { ANTHROPIC_API_KEY: 'test-key', ...(o.env || {}) },
    verifyMember: async (event) => {
      const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
      if (!/^Bearer\s+\S+/.test(h) || /Bearer\s+null$/.test(h)) { const e = new Error('Missing or malformed Authorization header'); e.statusCode = 401; throw e; }
      return 'mem_1';
    },
    fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body), headers: init.headers }); return { json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; },
  });
  const call = (body, auth) => handler({ httpMethod: 'POST', headers: auth === undefined ? { authorization: 'Bearer tok' } : (auth ? { authorization: auth } : {}), body: JSON.stringify(body) })
    .then(r => ({ status: r.statusCode, body: r.body ? (() => { try { return JSON.parse(r.body); } catch (e) { return r.body; } })() : null }));
  return { call, sent };
}

const MSG = { messages: [{ role: 'user', content: 'Give me a quote' }], system: 'You are ARIS.', max_tokens: 800 };

test('no login → 401 and no Anthropic call', async () => {
  const t = setup();
  const r = await t.call(MSG, null);
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'session_expired');
  assert.equal(t.sent.length, 0);
  assert.equal((await t.call(MSG, 'Bearer null')).status, 401);   // a page whose token never loaded
});

test('valid member → forwarded with the same response shape', async () => {
  const t = setup();
  const r = await t.call(MSG);
  assert.equal(r.status, 200);
  assert.equal(r.body.content[0].text, 'ok');
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].headers['x-api-key'], 'test-key');
  assert.equal(t.sent[0].body.system, 'You are ARIS.');
  assert.equal(t.sent[0].body.max_tokens, 800);
});

test('model is fixed server-side and max_tokens is capped', async () => {
  const t = setup();
  await t.call({ ...MSG, model: 'claude-opus-4-1', max_tokens: 64000 });
  assert.equal(t.sent[0].body.model, _limits.MODEL);
  assert.equal(t.sent[0].body.max_tokens, _limits.MAX_TOKENS_CAP);
  await t.call({ messages: MSG.messages });
  assert.equal(t.sent[1].body.max_tokens, _limits.DEFAULT_MAX_TOKENS);
});

test('only system and messages pass through; bad shapes are rejected', async () => {
  const t = setup();
  await t.call({ ...MSG, tools: [{ name: 'x' }], metadata: { a: 1 }, stream: true });
  assert.deepEqual(Object.keys(t.sent[0].body).sort(), ['max_tokens', 'messages', 'model', 'system']);
  assert.equal((await t.call({ messages: [] })).status, 400);
  assert.equal((await t.call({ messages: MSG.messages, system: { evil: 1 } })).status, 400);
  assert.equal((await t.call({ messages: MSG.messages, system: 'x'.repeat(40001) })).status, 400);
});

test('every page that calls aris-quote sends the member token', () => {
  const root = path.join(__dirname, '..');
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  let calls = 0;
  pages.forEach(p => {
    const s = fs.readFileSync(path.join(root, p), 'utf8');
    let i = s.indexOf("fetch('/api/aris-quote'");
    while (i >= 0) {
      calls += 1;
      const opts = s.slice(i, i + 300);   // method + headers come first in every call
      assert.ok(opts.includes("'Authorization': 'Bearer ' + memberToken"), `${p}: aris-quote call without the member token`);
      i = s.indexOf("fetch('/api/aris-quote'", i + 1);
    }
  });
  assert.equal(calls, 16);
});
