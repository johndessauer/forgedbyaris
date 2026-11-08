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
  assert.ok(t.sent[0].body.system.startsWith('You are ARIS.'));
  assert.ok(t.sent[0].body.system.includes('United States dollars'));
  assert.ok(t.sent[0].body.system.includes('Do not convert'));
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

function parseMoney(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[$,]/g, '')) || 0;
}

// Same prompt Capital Radar builds in runStackSuggest. Labeled inputs only.
function capitalStackPrompt(fields) {
  const purchase = fields.purchase;
  const rehab = fields.rehab;
  const arv = fields.arv;
  const type = fields.type;
  const cash = fields.cash;
  const totalNeeded = parseMoney(purchase) + parseMoney(rehab);
  return 'You are ARIS inside FORGE. Return ONLY a valid JSON array, no markdown.\n\nDeal:\n- Type: ' + type + '\n- Purchase: ' + purchase + '\n- Rehab: ' + (rehab || '$0') + '\n- ARV: ' + arv + '\n- Cash: ' + (cash || '$0') + '\n- Total Needed: $' + totalNeeded.toLocaleString('en-US') + '\nMoney is US dollars unless the deal text explicitly names another currency. Do not convert or relabel an explicit non-US amount.\n\nReturn a JSON array of 2-4 capital stack layers. Each object:\n{"type":"Hard Money","amount":140000,"rate":12.0,"term":12,"points":2.0,"note":"one sentence why"}\n\nValid types: Hard Money, Private Money, Seller Financing, Subject-To, Seller Second, HELOC / Equity, Partner Equity, Cash / Own Funds, DSCR Loan, Conventional, Bridge Loan\nTotal amounts should approximate $' + totalNeeded.toLocaleString('en-US') + '\nReturn ONLY the JSON array.';
}

const STACK_CASES = [
  { label: 'labeled placeholders', purchase: '$150,000', rehab: '$40,000', arv: '$250,000', type: 'flip', cash: '$20,000', total: '$190,000' },
  { label: 'empty rehab and cash', purchase: '$150,000', rehab: '', arv: '$250,000', type: 'flip', cash: '', total: '$150,000' },
  { label: 'explicit zeros', purchase: '$0', rehab: '0', arv: '$0', type: 'rental', cash: '$0', total: '$0' },
  { label: 'plain digits', purchase: '185000', rehab: '25000', arv: '260000', type: 'brrrr', cash: '10000', total: '$210,000' },
];

test('capital stack numbers keep an authorized USD request', async () => {
  const t = setup();
  for (const fields of STACK_CASES) {
    const prompt = capitalStackPrompt(fields);
    const res = await t.call({
      model: 'claude-opus-4-1',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    assert.equal(res.status, 200, fields.label);
    assert.equal(res.body.content[0].text, 'ok', fields.label);
  }
  assert.equal(t.sent.length, STACK_CASES.length);
  STACK_CASES.forEach((fields, i) => {
    const body = t.sent[i].body;
    assert.equal(body.model, _limits.MODEL, fields.label);
    assert.equal(body.max_tokens, 500, fields.label);
    assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'system'], fields.label);
    assert.equal(body.messages.length, 1, fields.label);
    assert.equal(body.messages[0].role, 'user', fields.label);
    assert.match(body.messages[0].content, new RegExp('Total Needed: \\' + fields.total), fields.label);
    assert.match(body.system, /United States dollars/, fields.label);
    assert.match(body.system, /No non-US currency was requested/, fields.label);
    assert.doesNotMatch(body.system, /explicitly used CAD/, fields.label + ' must not read Cash as Canadian dollars');
  });
});

test('explicit pounds in a stack prompt are kept and not relabeled', async () => {
  const t = setup();
  const prompt = capitalStackPrompt({ purchase: '£250,000', rehab: '', arv: '£400,000', type: 'flip', cash: '' });
  await t.call({ max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
  assert.match(t.sent[0].body.system, /explicitly used GBP/);
  assert.match(t.sent[0].body.system, /Do not convert/);
  assert.match(t.sent[0].body.messages[0].content, /£250,000/);
});

test('a currency-helper failure still forwards the authorized stack request', async () => {
  const sent = [];
  const handler = createHandler({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    verifyMember: async () => 'mem_1',
    analysisCurrencyInstruction() { throw new Error('detector blew up'); },
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { json: async () => ({ content: [{ type: 'text', text: '[{"type":"Cash / Own Funds","amount":0}]' }] }) };
    },
  });
  const prompt = capitalStackPrompt(STACK_CASES[2]);
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).content[0].text.includes('Cash / Own Funds'), true);
  assert.equal(sent.length, 1);
  assert.equal(Object.hasOwn(sent[0], 'system'), false);
  assert.equal(sent[0].messages[0].content, prompt);
});

test('provider failures stay server errors and do not drop the member check', async () => {
  async function run(fetchImpl) {
    const handler = createHandler({
      env: { ANTHROPIC_API_KEY: 'test-key' },
      verifyMember: async (event) => {
        const h = event.headers.authorization || '';
        if (!/^Bearer\s+\S+/.test(h) || /Bearer\s+null$/.test(h)) { const e = new Error('no'); e.statusCode = 401; throw e; }
        return 'mem_1';
      },
      fetch: fetchImpl,
    });
    const prompt = capitalStackPrompt(STACK_CASES[0]);
    return handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    });
  }
  const thrown = await run(async () => { throw new Error('network down'); });
  assert.equal(thrown.statusCode, 500);
  assert.equal(JSON.parse(thrown.body).error, 'Function error');
  const nonJson = await run(async () => ({ json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  assert.equal(nonJson.statusCode, 500);
  const providerJson = await run(async () => ({ json: async () => ({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }) }));
  assert.equal(providerJson.statusCode, 200);
  assert.equal(JSON.parse(providerJson.body).error.type, 'invalid_request_error');
  const noToken = createHandler({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    verifyMember: async () => { const e = new Error('no'); e.statusCode = 401; throw e; },
    fetch: async () => { throw new Error('should not call'); },
  });
  const denied = await noToken({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer null' },
    body: JSON.stringify({ max_tokens: 500, messages: [{ role: 'user', content: capitalStackPrompt(STACK_CASES[0]) }] }),
  });
  assert.equal(denied.statusCode, 401);
  assert.equal(JSON.parse(denied.body).error, 'session_expired');
});

test('quote currency rule matches the edge speech helper and is not a dynamic import', async () => {
  const { pathToFileURL } = require('url');
  const edge = await import(pathToFileURL(path.join(__dirname, '../netlify/edge-functions/lib/speech-text.js')).href);
  const local = require('../netlify/functions/_Lib/analysis-currency');
  for (const fields of STACK_CASES) {
    const prompt = capitalStackPrompt(fields);
    const messages = [{ role: 'user', content: prompt }];
    assert.equal(local.analysisCurrencyInstruction({ messages }), edge.analysisCurrencyInstruction({ messages }));
  }
  const src = fs.readFileSync(path.join(__dirname, '../netlify/functions/aris-quote.js'), 'utf8');
  assert.equal(src.includes('edge-functions/lib/speech-text'), false);
  assert.match(src, /require\('\.\/_Lib\/analysis-currency'\)/);
});

test('capital radar waits for a real member token and names a 401', () => {
  const page = fs.readFileSync(path.join(__dirname, '../capital-radar.html'), 'utf8');
  assert.match(page, /if \(!purchase \|\| !arv\)/);
  assert.match(page, /ensureMemberToken\(\)/);
  assert.match(page, /DOMContentLoaded/);
  assert.match(page, /html2canvas\.min\.js" defer/);
  assert.doesNotMatch(page, /throw new Error\('ARIS unavailable\. Try again\.'\)/);
  const fetchAt = page.indexOf("fetch('/api/aris-quote'");
  assert.ok(page.slice(fetchAt, fetchAt + 300).includes("'Authorization': 'Bearer ' + memberToken"));
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
